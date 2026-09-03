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
  const serverWireIds = uniqueStrings(message.serverWireIds)
  return {
    ...message,
    ...(id ? { id } : {}),
    ...(wireIds.length ? { wireIds } : {}),
    ...(serverWireIds.length ? { serverWireIds } : {}),
    timestamp: normalizeMessageTimestamp(message.timestamp ?? message.ts, fallbackTimestamp),
  }
}

export function messageIdentityKeys(message) {
  if (!message) return []
  return uniqueStrings([message.id, ...(Array.isArray(message.wireIds) ? message.wireIds : [])])
}

// Transport identity is deliberately separate from display identity. One CC
// wire message may render as several paragraph bubbles; those fragments must
// not dedupe each other, while reconnect anchoring and deletion still target
// their one shared server message.
export function messageServerIdentityKeys(message) {
  if (!message) return []
  const explicit = uniqueStrings(message.serverWireIds)
  return explicit.length ? explicit : messageIdentityKeys(message)
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
  if (message.bedtimeCard) return true
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

export function finalizePersistedTransient(message) {
  const normalized = normalizeTimelineMessage(message)
  if (!normalized) return null
  if (normalized.voiceLoading) {
    return {
      ...normalized,
      type: normalized.voiceBlobId ? 'voice' : 'text',
      content: normalized.voiceBlobId ? '' : (normalized.voiceText || normalized.content || ''),
      voiceLoading: false,
      ...(!normalized.voiceBlobId ? { voiceFailed: true } : {}),
      streaming: false,
      reasoningStreaming: false,
    }
  }
  if (normalized.streaming || normalized.reasoningStreaming) {
    return { ...normalized, streaming: false, reasoningStreaming: false }
  }
  return normalized
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
  // Translation is generated and persisted by the client, never by the
  // companion history wire. A reconnect snapshot must enrich the message,
  // not make the completed translation disappear from an open sheet.
  for (const key of ['reasoningTranslation', 'reasoningTranslationSourceHash', 'reasoningTranslationUpdatedAt']) {
    if (merged[key] === undefined) {
      if (existing[key] !== undefined) merged[key] = existing[key]
      else if (incoming[key] !== undefined) merged[key] = incoming[key]
    }
  }
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
  const mergedServerWireIds = uniqueStrings([
    ...(Array.isArray(existing.serverWireIds) ? existing.serverWireIds : []),
    ...(Array.isArray(incoming.serverWireIds) ? incoming.serverWireIds : []),
  ])
  if (mergedServerWireIds.length) merged.serverWireIds = mergedServerWireIds

  // Prefer the primary record's clock; both were normalized already.
  merged.timestamp = primary.timestamp
  return merged
}

function semanticSignature(message) {
  const text = normalizedComparableText(message)
  if (!text || message?.role !== 'assistant' || (message.type || 'text') !== 'text') return null
  return `${message.conversationId || ''}\u0000assistant\u0000${text}`
}

function timelineScopeKey(message) {
  return `${message?.conversationId || ''}\u0000`
}

// A server reply belongs to a turn, not to a wall-clock slot. Client and VPS
// clocks can differ, and several events can share one millisecond, so timestamp
// sorting alone is not a valid causal order. Keep each known reply group
// directly after the user message that opened its turn while retaining the
// group's existing arrival order.
export function enforceTurnReplyOrder(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return messages || []
  const parentKeys = new Set()
  for (const message of messages) {
    if (message?.role !== 'user' || !message.id) continue
    parentKeys.add(`${timelineScopeKey(message)}${message.id}`)
  }

  const repliesByParent = new Map()
  const attachedReplies = new Set()
  for (const message of messages) {
    if (message?.role !== 'assistant' || !message.replyToTurnId) continue
    const parentKey = `${timelineScopeKey(message)}${message.replyToTurnId}`
    if (!parentKeys.has(parentKey)) continue
    repliesByParent.set(parentKey, [...(repliesByParent.get(parentKey) || []), message])
    attachedReplies.add(message)
  }
  if (!attachedReplies.size) return messages

  const ordered = []
  for (const message of messages) {
    if (attachedReplies.has(message)) continue
    ordered.push(message)
    if (message?.role !== 'user' || !message.id) continue
    const parentKey = `${timelineScopeKey(message)}${message.id}`
    const replies = repliesByParent.get(parentKey)
    if (replies) ordered.push(...replies)
  }
  return ordered
}

export function canonicalizeTimeline(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) return []
  const now = normalizeMessageTimestamp(options.now, Date.now())
  const output = []
  const identityToIndex = new Map()
  const signatureToIndices = new Map()

  for (let inputIndex = 0; inputIndex < messages.length; inputIndex++) {
    const rawNormalized = normalizeTimelineMessage(messages[inputIndex], now + inputIndex)
    const normalized = options.finalizeTransient === true
      ? finalizePersistedTransient(rawNormalized)
      : rawNormalized
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
    if (matchIndex === -1 && options.healLegacyDuplicates === true) {
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
  return enforceTurnReplyOrder(output.map(item => item.message))
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
  // `finalizeTransient` applies only to rows read from persistence. A live
  // in-memory stream carried alongside a stale snapshot must stay live.
  const liveOptions = { ...options, finalizeTransient: false }
  const incoming = canonicalizeTimeline(snapshotMessages, options)
  if (incoming.length === 0) return canonicalizeTimeline(currentMessages, liveOptions)
  const current = canonicalizeTimeline(currentMessages, liveOptions)
  if (current.length === 0) return incoming

  const scopeProbe = incoming[0]
  const inScopeCurrent = current.filter(message => sameTimelineScope(message, scopeProbe))
  const latestIncomingTimestamp = incoming.reduce((max, message) => Math.max(max, message.timestamp), 0)
  const carry = inScopeCurrent.filter(message => {
    if (incoming.some(candidate => identityOverlap(candidate, message)
      || (options.healLegacyDuplicates === true && legacyCcDuplicate(candidate, message)))) return false
    // Preserve an in-flight bubble and anything that arrived after the snapshot
    // was taken. This is the stale-load race that otherwise makes a fresh
    // message disappear until the next reconnect.
    return message.streaming || message.voiceLoading || message.timestamp > latestIncomingTimestamp
  })

  return canonicalizeTimeline([...incoming, ...carry], liveOptions)
}

export function appendTimelineMessage(currentMessages, message, options = {}) {
  const current = Array.isArray(currentMessages) ? currentMessages : []
  const normalized = normalizeTimelineMessage(message)
  if (!normalized || !isRenderableTimelineMessage(normalized)) return current
  const index = current.findIndex(existing => identityOverlap(existing, normalized))
  if (index === -1) return [...current, normalized]
  const next = [...current]
  next[index] = mergeDuplicate(normalizeTimelineMessage(current[index]), normalized, false)
  return next
}

export function updateTimelineMessage(currentMessages, id, updates, options = {}) {
  if (!Array.isArray(currentMessages)) return []
  const index = currentMessages.findIndex(message => message?.id === id)
  if (index === -1) return currentMessages
  const next = [...currentMessages]
  const updated = normalizeTimelineMessage({ ...next[index], ...updates }, next[index].timestamp)
  if (!isRenderableTimelineMessage(updated)) return next.filter((_, itemIndex) => itemIndex !== index)
  next[index] = updated
  return next
}

// The single mutation vocabulary for a rendered one-to-one chat timeline.
// Transport hooks, history hydration and reconnect recovery all reduce into
// these events instead of each inventing its own append/sort/replace rules.
export function reduceMessageTimeline(currentMessages, event, options = {}) {
  const current = Array.isArray(currentMessages) ? currentMessages : []
  if (!event || typeof event !== 'object') return current

  switch (event.type) {
    case 'snapshot':
      return reconcileTimelineSnapshot(current, event.messages || [], {
        ...options,
        finalizeTransient: event.finalizeTransient === true,
      })
    case 'merge':
      return enforceTurnReplyOrder((Array.isArray(event.messages) ? event.messages : [])
        .reduce((timeline, message) => appendTimelineMessage(timeline, message, options), current))
    case 'upsert':
      return appendTimelineMessage(current, event.message, options)
    case 'patch':
      return updateTimelineMessage(current, event.id, event.updates || {}, options)
    case 'remove': {
      const ids = new Set(Array.isArray(event.ids) ? event.ids : [event.id])
      return current.filter(message => !ids.has(message?.id))
    }
    case 'reset':
      return []
    default:
      return current
  }
}
