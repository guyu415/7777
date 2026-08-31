const SECOND_TIMESTAMP_CEILING = 100_000_000_000
const MICROSECOND_TIMESTAMP_FLOOR = 100_000_000_000_000
const LEGACY_CC_DUPLICATE_WINDOW_MS = 20_000

function finitePositive(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

export function normalizeMessageTimestamp(value, fallback = Date.now()) {
  let n = finitePositive(value)
  if (n !== null) {
    if (n < SECOND_TIMESTAMP_CEILING) n *= 1000
    else if (n >= MICROSECOND_TIMESTAMP_FLOOR) n = Math.floor(n / 1000)
    return Math.floor(n)
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }

  const fallbackNumber = finitePositive(fallback)
  return Math.floor(fallbackNumber ?? Date.now())
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()))]
}

export function normalizeTimelineMessage(message, fallbackTimestamp = Date.now()) {
  if (!message || typeof message !== 'object') return null
  const id = typeof message.id === 'string' ? message.id : message.id == null ? '' : String(message.id)
  const wireIds = uniqueStrings(message.wireIds)
  return {
    ...message,
    ...(id ? { id } : {}),
    ...(wireIds.length ? { wireIds } : {}),
    timestamp: normalizeMessageTimestamp(message.timestamp ?? message.ts, fallbackTimestamp),
  }
}

export function messageIdentityKeys(message) {
  if (!message) return []
  return uniqueStrings([message.id, ...(Array.isArray(message.wireIds) ? message.wireIds : [])])
}

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0
}

export function hasMessageContentPayload(message) {
  if (!message) return false
  if (hasText(message.content) || hasText(message.reasoning) || hasText(message.voiceText)) return true
  if (message.type === 'voice' || message.type === 'image' || message.type === 'file') return true
  if (message.voiceLoading || message.voiceBlobId || message.imageUrl || message.imageData || message.filePath || message.fileName) return true
  if (message.error || message.acStatus) return true
  if (Array.isArray(message.toolUses) && message.toolUses.length > 0) return true
  if (message.toolUse && typeof message.toolUse === 'object') return true
  return false
}

export function isRenderableTimelineMessage(message) {
  if (!message || typeof message !== 'object') return false
  // User-side empty attachment placeholders can still carry non-text payloads;
  // only suppress assistant text bubbles that have genuinely finished empty.
  if (message.role !== 'assistant' || (message.type && message.type !== 'text')) return true
  if (message.streaming || message.reasoningStreaming || message.voiceLoading) return true
  return hasMessageContentPayload(message)
}

export function isSuppressibleAssistantPlaceholder(message) {
  return Boolean(
    message
    && message.role === 'assistant'
    && (!message.type || message.type === 'text')
    && message.streaming
    && !message.reasoningStreaming
    && !hasMessageContentPayload(message)
  )
}

function normalizedComparableText(message) {
  return typeof message?.content === 'string' ? message.content.trim().replace(/\r\n/g, '\n') : ''
}

function isCcProactive(message) {
  return message?.source === 'cc-proactive'
}

function legacyCcDuplicate(a, b) {
  if (!a || !b) return false
  if (a.conversationId !== b.conversationId) return false
  if (a.role !== 'assistant' || b.role !== 'assistant') return false
  if ((a.type || 'text') !== 'text' || (b.type || 'text') !== 'text') return false
  if (isCcProactive(a) === isCcProactive(b)) return false
  const aText = normalizedComparableText(a)
  const bText = normalizedComparableText(b)
  if (!aText || aText !== bText) return false
  return Math.abs(a.timestamp - b.timestamp) <= LEGACY_CC_DUPLICATE_WINDOW_MS
}

function richness(message) {
  if (!message) return 0
  let score = 0
  const contentLength = normalizedComparableText(message).length
  if (contentLength) score += 10 + Math.min(contentLength, 2000) / 2000
  if (hasText(message.reasoning)) score += 4
  if (Array.isArray(message.toolUses) && message.toolUses.length) score += 4
  if (message.type === 'voice' || message.voiceBlobId) score += 8
  if (message.type === 'image' || message.imageUrl || message.imageData) score += 8
  if (message.type === 'file' || message.filePath) score += 8
  if (message.error) score += 5
  if (!message.streaming) score += 2
  if (!isCcProactive(message)) score += 1
  return score
}

function mergeDuplicate(existing, incoming, semanticLegacy = false) {
  let primary = existing
  let secondary = incoming

  if (semanticLegacy) {
    // A live CC bubble uses a local id and may carry richer local-only fields
    // (voice blob, reasoning, tool activity). Keep that bubble as the display
    // record and attach the replayed server id as a wire identity.
    if (isCcProactive(existing) && !isCcProactive(incoming)) {
      primary = incoming
      secondary = existing
    } else if (!isCcProactive(existing) && isCcProactive(incoming)) {
      primary = existing
      secondary = incoming
    } else if (richness(incoming) > richness(existing)) {
      primary = incoming
      secondary = existing
    }
  } else if (richness(incoming) > richness(existing)) {
    primary = incoming
    secondary = existing
  }

  const merged = { ...secondary, ...primary }
  // Never let a poorer replay erase a useful payload that only exists on the
  // other copy.
  if (!hasText(merged.content) && hasText(secondary.content)) merged.content = secondary.content
  if (!hasText(merged.reasoning) && hasText(secondary.reasoning)) merged.reasoning = secondary.reasoning
  if ((!Array.isArray(merged.toolUses) || merged.toolUses.length === 0) && Array.isArray(secondary.toolUses) && secondary.toolUses.length) {
    merged.toolUses = secondary.toolUses
  }

  const primaryId = primary.id || secondary.id
  if (primaryId) merged.id = primaryId
  const mergedWireIds = uniqueStrings([
    ...(Array.isArray(existing.wireIds) ? existing.wireIds : []),
    ...(Array.isArray(incoming.wireIds) ? incoming.wireIds : []),
    ...(existing.id && existing.id !== primaryId ? [existing.id] : []),
    ...(incoming.id && incoming.id !== primaryId ? [incoming.id] : []),
  ])
  if (mergedWireIds.length) merged.wireIds = mergedWireIds

  // Prefer the primary record's clock; both were normalized already.
  merged.timestamp = primary.timestamp
  return merged
}

function semanticSignature(message) {
  const text = normalizedComparableText(message)
  if (!text || message?.role !== 'assistant' || (message.type || 'text') !== 'text') return null
  return `${message.conversationId || ''}\u0000assistant\u0000${text}`
}

export function canonicalizeTimeline(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return []
  const now = normalizeMessageTimestamp(options.now, Date.now())
  const output = []
  const identityToIndex = new Map()
  const signatureToIndices = new Map()

  for (let inputIndex = 0; inputIndex < messages.length; inputIndex++) {
    const normalized = normalizeTimelineMessage(messages[inputIndex], now + inputIndex)
    if (!normalized || !isRenderableTimelineMessage(normalized)) continue

    const keys = messageIdentityKeys(normalized)
    let matchIndex = -1
    for (const key of keys) {
      if (identityToIndex.has(key)) {
        matchIndex = identityToIndex.get(key)
        break
      }
    }

    let semanticLegacy = false
    if (matchIndex === -1) {
      const signature = semanticSignature(normalized)
      const candidates = signature ? (signatureToIndices.get(signature) || []) : []
      for (let i = candidates.length - 1; i >= 0; i--) {
        const candidateIndex = candidates[i]
        if (legacyCcDuplicate(output[candidateIndex]?.message, normalized)) {
          matchIndex = candidateIndex
          semanticLegacy = true
          break
        }
      }
    }

    if (matchIndex !== -1) {
      const previous = output[matchIndex]
      const merged = mergeDuplicate(previous.message, normalized, semanticLegacy)
      output[matchIndex] = { message: merged, order: previous.order }
      for (const key of messageIdentityKeys(merged)) identityToIndex.set(key, matchIndex)
      const signature = semanticSignature(merged)
      if (signature) {
        const indices = signatureToIndices.get(signature) || []
        if (!indices.includes(matchIndex)) signatureToIndices.set(signature, [...indices, matchIndex])
      }
      continue
    }

    const index = output.length
    output.push({ message: normalized, order: inputIndex })
    for (const key of keys) identityToIndex.set(key, index)
    const signature = semanticSignature(normalized)
    if (signature) signatureToIndices.set(signature, [...(signatureToIndices.get(signature) || []), index])
  }

  output.sort((a, b) => a.message.timestamp - b.message.timestamp || a.order - b.order)
  return output.map(item => item.message)
}

function identityOverlap(a, b) {
  const keys = new Set(messageIdentityKeys(a))
  return messageIdentityKeys(b).some(key => keys.has(key))
}

function sameTimelineScope(a, b) {
  if (!a || !b) return false
  if (a.conversationId || b.conversationId) return a.conversationId === b.conversationId
  return true
}

export function reconcileTimelineSnapshot(currentMessages, snapshotMessages, options = {}) {
  if (!Array.isArray(snapshotMessages) || snapshotMessages.length === 0) return []
  const incoming = canonicalizeTimeline(snapshotMessages, options)
  if (incoming.length === 0) return []
  const current = canonicalizeTimeline(currentMessages, options)
  if (current.length === 0) return incoming

  const scopeProbe = incoming[0]
  const inScopeCurrent = current.filter(message => sameTimelineScope(message, scopeProbe))
  const latestIncomingTimestamp = incoming.reduce((max, message) => Math.max(max, message.timestamp), 0)
  const carry = inScopeCurrent.filter(message => {
    if (incoming.some(candidate => identityOverlap(candidate, message) || legacyCcDuplicate(candidate, message))) return false
    // Preserve an in-flight bubble and anything that arrived after the snapshot
    // was taken. This is the stale-load race that otherwise makes a fresh
    // message disappear until the next reconnect.
    return message.streaming || message.voiceLoading || message.timestamp > latestIncomingTimestamp
  })

  return canonicalizeTimeline([...incoming, ...carry], options)
}

export function appendTimelineMessage(currentMessages, message, options = {}) {
  return canonicalizeTimeline([...(Array.isArray(currentMessages) ? currentMessages : []), message], options)
}

export function updateTimelineMessage(currentMessages, id, updates, options = {}) {
  if (!Array.isArray(currentMessages)) return []
  const index = currentMessages.findIndex(message => message?.id === id)
  if (index === -1) return currentMessages
  const next = [...currentMessages]
  next[index] = { ...next[index], ...updates }
  return canonicalizeTimeline(next, options)
}
