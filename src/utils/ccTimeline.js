import { messageIdentityKeys, messageServerIdentityKeys, normalizeMessageTimestamp } from './messageTimeline'
import { splitVpsReplyContent, vpsReplyFragmentId } from './vpsReplyChunks'

function wireId(wire) {
  return typeof wire?.id === 'string' && wire.id ? wire.id : null
}

function localIdentitySet(messages) {
  const ids = new Set()
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const id of messageServerIdentityKeys(message)) ids.add(id)
  }
  return ids
}

// A reconnect snapshot is transport recovery, not a second chat history
// database. Find the newest server wire already represented locally and only
// recover the tail after that anchor. Missing wires before the anchor are old
// gaps and must never jump into the middle of an open conversation.
export function selectCcSnapshotDelta(localMessages, snapshotItems) {
  const local = Array.isArray(localMessages) ? localMessages : []
  const snapshot = (Array.isArray(snapshotItems) ? snapshotItems : [])
    .filter(item => item?.type === 'msg' && wireId(item))
  if (!snapshot.length) return []

  const known = localIdentitySet(local)
  let anchorIndex = -1
  for (let index = 0; index < snapshot.length; index++) {
    if (known.has(snapshot[index].id)) anchorIndex = index
  }

  let candidates
  if (anchorIndex >= 0) {
    candidates = snapshot.slice(anchorIndex + 1)
  } else if (local.length > 0) {
    const latestLocalTimestamp = local.reduce((latest, message) => (
      Math.max(latest, normalizeMessageTimestamp(message?.timestamp ?? message?.ts, 0))
    ), 0)
    candidates = snapshot.filter(item => normalizeMessageTimestamp(item.ts, 0) > latestLocalTimestamp)
  } else {
    // A genuinely empty/new device needs one complete initial hydration. It
    // is still returned as one batch, never dozens of independent live events.
    candidates = snapshot
  }

  const deltaIds = new Set(candidates.filter(item => !known.has(item.id)).map(item => item.id))

  // Reasoning is durable server history too. A previous client-side save race
  // (or the retired five-turn pruning policy) may leave the reply bubble in
  // IndexedDB while its thinking field is absent. Such a known wire is not a
  // new message, but it still needs one merge pass so refresh can repair it.
  // For split replies, require the original first fragment to still exist;
  // this prevents a deliberately deleted first bubble from being recreated.
  const needsReasoningRepair = (wire) => {
    if (typeof wire?.thinking !== 'string' || !wire.thinking.trim()) return false
    const matches = local.filter(message => messageServerIdentityKeys(message).includes(wire.id))
    if (!matches.length) return false
    const partCount = splitVpsReplyContent(wire.text || '').length
    const firstFragmentId = vpsReplyFragmentId(wire.id, 0, partCount)
    const first = matches.find(message => messageIdentityKeys(message).includes(firstFragmentId))
    return Boolean(first && !(typeof first.reasoning === 'string' && first.reasoning.trim()))
  }

  return snapshot.filter(item => deltaIds.has(item.id) || needsReasoningRepair(item))
}

export function ccWireToTimelineMessages(wire, conversationId, options = {}) {
  if (wire?.type !== 'msg' || !wireId(wire)) return null
  const timestamp = normalizeMessageTimestamp(wire.ts)
  if (wire.from === 'user') {
    return [{
      id: wire.id,
      turnId: wire.turnId || wire.id,
      conversationId,
      role: 'user',
      type: 'text',
      content: wire.text || '',
      timestamp,
      streaming: false,
      source: options.source || 'cc-remote-user',
    }]
  }
  if (wire.from !== 'cc') return null

  const reasoningFields = wire.thinking
    ? { reasoning: wire.thinking, reasoningStreaming: false }
    : {}
  const focusFields = wire.focusSummary ? { focusSummary: wire.focusSummary } : {}
  // On the CC wire, turnId is the stable id of the user message that opened
  // this turn. `replyTo` is a separate semantic quote target and must not be
  // used for timeline placement.
  const turnFields = wire.turnId
    ? { turnId: wire.turnId, replyToTurnId: wire.turnId }
    : {}
  if (wire.bedtimeCard) {
    return [{
      id: wire.id,
      wireIds: [wire.id],
      serverWireIds: [wire.id],
      conversationId,
      role: 'assistant',
      type: 'text',
      content: wire.text || wire.bedtimeCard.english || '',
      bedtimeCard: wire.bedtimeCard,
      timestamp,
      streaming: false,
      source: 'cc-proactive',
      ...turnFields,
      ...reasoningFields,
    }]
  }
  if (wire.kind === 'voice') {
    return [{
      id: wire.id,
      conversationId,
      role: 'assistant',
      type: 'text',
      content: wire.text || '',
      voiceText: wire.text || '',
      voiceLoading: options.live === true,
      voiceFailed: options.live !== true,
      timestamp,
      streaming: false,
      source: 'cc-proactive',
      ...turnFields,
      ...reasoningFields,
      ...focusFields,
    }]
  }
  const parts = splitVpsReplyContent(wire.text || '')
  return parts.map((content, partIndex) => {
    const fragmentId = vpsReplyFragmentId(wire.id, partIndex, parts.length)
    return {
      id: fragmentId,
      wireIds: [fragmentId],
      serverWireIds: [wire.id],
      wirePartIndex: partIndex,
      wirePartCount: parts.length,
      conversationId,
      role: 'assistant',
      type: 'text',
      content,
      timestamp,
      streaming: false,
      source: 'cc-proactive',
      ...turnFields,
      ...(wire.musicAction && partIndex === parts.length - 1 ? { musicAction: wire.musicAction } : {}),
      ...(wire.focusSummary && partIndex === 0 ? focusFields : {}),
      ...(partIndex === 0 ? reasoningFields : {}),
    }
  })
}

export function ccWireToTimelineMessage(wire, conversationId, options = {}) {
  return ccWireToTimelineMessages(wire, conversationId, options)?.[0] || null
}
