import { useStore } from './index'
import {
  isRenderableTimelineMessage,
  isSuppressibleAssistantPlaceholder,
  messageServerIdentityKeys,
  normalizeTimelineMessage,
  reduceMessageTimeline,
} from '../utils/messageTimeline'
import {
  ensureConnected,
  onCcMessageDeleted,
  sendDeleteNotice,
} from '../services/companion'

// The store itself owns ordering/dedupe through reduceMessageTimeline. This
// startup guard adds the persistence concerns that must survive reconnects:
// suppressed empty stream placeholders, delete tombstones and the reliable
// CC delete outbox. It does not define a second ordering model.
const INSTALL_KEY = '__eunoiaMessageTimelineGuardV3'

// A local delete must survive reconnect/history replay. Without a tombstone,
// deleting only removes the row from Zustand/IndexedDB; a stale server history
// snapshot can immediately add the same wire back and make the user delete it
// over and over. Keep identity tombstones locally for long enough that every
// normal cloud/VPS sync path has ample time to converge.
const TOMBSTONE_STORAGE_KEY = 'eunoia.messageTombstones.v1'
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOMBSTONE_LIMIT = 4000

// Server deletion is intentionally stronger than the local tombstone. The old
// path used sendDeleteNotice() as fire-and-forget: if Mobile Safari had a dead
// WebSocket when the user tapped Delete, the request vanished and the VPS kept
// the message forever. Persist a small outbox and retry until the server echoes
// msg_deleted for those ids. This is idempotent server-side.
const DELETE_OUTBOX_STORAGE_KEY = 'eunoia.ccDeleteOutbox.v1'
const DELETE_OUTBOX_TTL_MS = 30 * 24 * 60 * 60 * 1000
const DELETE_OUTBOX_LIMIT = 1000
const DELETE_RETRY_MS = 3000
const RECENT_DELETE_ACK_TTL_MS = 30 * 1000

function tombstoneKey(conversationId, id) {
  return `${conversationId || ''}\u0000${id}`
}

function loadTombstones() {
  const tombstones = new Map()
  const now = Date.now()
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(TOMBSTONE_STORAGE_KEY) || '[]')
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!item || typeof item.id !== 'string') continue
        const expiresAt = Number(item.expiresAt)
        if (!Number.isFinite(expiresAt) || expiresAt <= now) continue
        tombstones.set(tombstoneKey(item.conversationId, item.id), {
          conversationId: item.conversationId || '',
          id: item.id,
          expiresAt,
        })
      }
    }
  } catch {
    // Private mode / malformed legacy data must never break chat startup.
  }
  return tombstones
}

function normalizeDeleteOutboxItem(item) {
  if (!item || typeof item !== 'object') return null
  const ids = [...new Set((Array.isArray(item.ids) ? item.ids : [])
    .filter(id => typeof id === 'string' && id.trim())
    .map(id => id.trim()))]
  if (!ids.length) return null
  const createdAt = Number(item.createdAt) || Date.now()
  const expiresAt = Number(item.expiresAt) || (createdAt + DELETE_OUTBOX_TTL_MS)
  if (expiresAt <= Date.now()) return null
  return {
    conversationId: typeof item.conversationId === 'string' ? item.conversationId : '',
    ids,
    text: typeof item.text === 'string' ? item.text : '',
    createdAt,
    expiresAt,
    lastAttemptAt: Number(item.lastAttemptAt) || 0,
  }
}

function loadDeleteOutbox() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(DELETE_OUTBOX_STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeDeleteOutboxItem).filter(Boolean).slice(-DELETE_OUTBOX_LIMIT)
  } catch {
    return []
  }
}

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true
  const pendingAssistantPlaceholders = new Map()
  const tombstones = loadTombstones()
  let deleteOutbox = loadDeleteOutbox()
  const recentDeleteAcks = new Map()
  let deleteRetryTimer = null

  const persistTombstones = () => {
    const now = Date.now()
    const alive = [...tombstones.values()]
      .filter(item => item.expiresAt > now)
      .sort((a, b) => a.expiresAt - b.expiresAt)
      .slice(-TOMBSTONE_LIMIT)
    tombstones.clear()
    for (const item of alive) tombstones.set(tombstoneKey(item.conversationId, item.id), item)
    try {
      globalThis.localStorage?.setItem(TOMBSTONE_STORAGE_KEY, JSON.stringify(alive))
    } catch {
      // Best-effort only. The in-memory tombstone still protects this tab.
    }
  }

  const persistDeleteOutbox = () => {
    const now = Date.now()
    deleteOutbox = deleteOutbox
      .filter(item => item.ids.length > 0 && item.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(-DELETE_OUTBOX_LIMIT)
    try {
      globalThis.localStorage?.setItem(DELETE_OUTBOX_STORAGE_KEY, JSON.stringify(deleteOutbox))
    } catch {
      // Best-effort only. The in-memory outbox still retries in this tab.
    }
  }

  const pruneRecentDeleteAcks = () => {
    const cutoff = Date.now() - RECENT_DELETE_ACK_TTL_MS
    for (const [id, at] of recentDeleteAcks) {
      if (at < cutoff) recentDeleteAcks.delete(id)
    }
  }

  const scheduleDeleteRetry = () => {
    if (deleteRetryTimer || deleteOutbox.length === 0) return
    deleteRetryTimer = setTimeout(() => {
      deleteRetryTimer = null
      flushDeleteOutbox()
    }, DELETE_RETRY_MS)
  }

  const flushDeleteOutbox = () => {
    persistDeleteOutbox()
    if (deleteOutbox.length === 0) return

    ensureConnected()
    const now = Date.now()
    let changed = false
    for (const item of deleteOutbox) {
      if (now - item.lastAttemptAt < DELETE_RETRY_MS) continue
      // sendDeleteNotice is fire-and-forget internally. Keep the item in the
      // outbox regardless of this attempt; only msg_deleted removes it.
      sendDeleteNotice(item.text, item.ids)
      item.lastAttemptAt = now
      changed = true
    }
    if (changed) persistDeleteOutbox()
    scheduleDeleteRetry()
  }

  const isVpsConversation = (conversationId) => {
    const state = useStore.getState()
    const session = state.sessions?.find(session => session.id === conversationId)
    return session?.providerName === 'claude-code-vps'
  }

  const queueReliableServerDelete = (message) => {
    if (!message) return
    const conversationId = message.conversationId || useStore.getState().currentSessionId || ''
    if (!isVpsConversation(conversationId)) return

    pruneRecentDeleteAcks()
    const ids = messageServerIdentityKeys(message).filter(id => !recentDeleteAcks.has(id))
    if (!ids.length) return

    const idSet = new Set(ids)
    const existing = deleteOutbox.find(item =>
      item.conversationId === conversationId
      && item.ids.some(id => idSet.has(id)))
    if (existing) {
      existing.ids = [...new Set([...existing.ids, ...ids])]
      if (!existing.text) existing.text = message.voiceText || message.content || ''
      existing.expiresAt = Date.now() + DELETE_OUTBOX_TTL_MS
    } else {
      deleteOutbox.push({
        conversationId,
        ids,
        text: message.voiceText || message.content || '',
        createdAt: Date.now(),
        expiresAt: Date.now() + DELETE_OUTBOX_TTL_MS,
        lastAttemptAt: 0,
      })
    }
    persistDeleteOutbox()
    // Give useChat's existing immediate send a brief chance to receive its ack;
    // if it was offline/dead, this durable outbox takes over on the next tick.
    scheduleDeleteRetry()
  }

  onCcMessageDeleted((ackIds) => {
    if (!Array.isArray(ackIds) || ackIds.length === 0) return
    const now = Date.now()
    const ackSet = new Set(ackIds.filter(id => typeof id === 'string' && id))
    for (const id of ackSet) recentDeleteAcks.set(id, now)

    let changed = false
    deleteOutbox = deleteOutbox.map(item => {
      const remaining = item.ids.filter(id => !ackSet.has(id))
      if (remaining.length !== item.ids.length) changed = true
      return remaining.length ? { ...item, ids: remaining } : null
    }).filter(Boolean)

    if (changed) persistDeleteOutbox()
    if (deleteOutbox.length) scheduleDeleteRetry()
  })

  const addMessageTombstones = (message) => {
    if (!message) return
    const conversationId = message.conversationId || useStore.getState().currentSessionId || ''
    const expiresAt = Date.now() + TOMBSTONE_TTL_MS
    let changed = false
    for (const id of messageServerIdentityKeys(message)) {
      const key = tombstoneKey(conversationId, id)
      const previous = tombstones.get(key)
      if (!previous || previous.expiresAt < expiresAt) {
        tombstones.set(key, { conversationId, id, expiresAt })
        changed = true
      }
    }
    if (changed) persistTombstones()
  }

  const isTombstoned = (message) => {
    if (!message) return false
    const conversationId = message.conversationId || useStore.getState().currentSessionId || ''
    const now = Date.now()
    let expired = false
    for (const id of messageServerIdentityKeys(message)) {
      const key = tombstoneKey(conversationId, id)
      const item = tombstones.get(key)
      if (!item) continue
      if (item.expiresAt > now) return true
      tombstones.delete(key)
      expired = true
    }
    if (expired) persistTombstones()
    return false
  }

  const clearIrrelevantPending = (activeConversationId) => {
    for (const [id, message] of pendingAssistantPlaceholders) {
      if (activeConversationId && message.conversationId === activeConversationId) continue
      pendingAssistantPlaceholders.delete(id)
    }
  }

  const guardedSetMessages = (messages) => {
    useStore.setState((state) => {
      const rawIncoming = Array.isArray(messages) ? messages : []
      const activeConversationId = rawIncoming.find(message => message?.conversationId)?.conversationId
        || state.currentSessionId
      clearIrrelevantPending(activeConversationId)
      const incoming = rawIncoming.filter(message => !isTombstoned(message))
      const current = state.messages.filter(message => !isTombstoned(message))
      // If a stale snapshot consisted only of rows the user already deleted,
      // filtering it must not mean "clear the whole live timeline". Preserve
      // the current non-deleted rows instead. A genuinely empty setMessages([])
      // still means clear and continues to work as before.
      const next = rawIncoming.length > 0 && incoming.length === 0
        ? current
        : incoming.length === 0
          ? []
          : reduceMessageTimeline(current, { type: 'snapshot', messages: incoming, finalizeTransient: true })
      return { messages: next }
    })
  }

  const guardedAddMessage = (message) => {
    const normalized = normalizeTimelineMessage(message)
    if (!normalized || isTombstoned(normalized)) return
    if (isSuppressibleAssistantPlaceholder(normalized)) {
      pendingAssistantPlaceholders.set(normalized.id, normalized)
      return
    }
    useStore.setState((state) => ({
      messages: reduceMessageTimeline(state.messages.filter(item => !isTombstoned(item)), { type: 'upsert', message: normalized }),
    }))
  }

  const guardedMergeMessages = (messages) => {
    const incoming = (Array.isArray(messages) ? messages : [])
      .map(message => normalizeTimelineMessage(message))
      .filter(message => message && !isTombstoned(message) && isRenderableTimelineMessage(message))
    if (!incoming.length) return
    useStore.setState((state) => ({
      messages: reduceMessageTimeline(state.messages.filter(item => !isTombstoned(item)), { type: 'merge', messages: incoming }),
    }))
  }

  const guardedUpdateMessage = (id, updates) => {
    if (pendingAssistantPlaceholders.has(id)) {
      const pending = pendingAssistantPlaceholders.get(id)
      const next = normalizeTimelineMessage({ ...pending, ...updates }, pending.timestamp)
      if (isTombstoned(next)) {
        pendingAssistantPlaceholders.delete(id)
        return
      }
      if (isSuppressibleAssistantPlaceholder(next)) {
        pendingAssistantPlaceholders.set(id, next)
        return
      }
      pendingAssistantPlaceholders.delete(id)
      if (!isRenderableTimelineMessage(next)) return
      useStore.setState((state) => ({
        messages: reduceMessageTimeline(state.messages.filter(item => !isTombstoned(item)), { type: 'upsert', message: next }),
      }))
      return
    }

    const existing = useStore.getState().messages.find(message => message.id === id)
    if (!existing || isTombstoned(existing)) return
    useStore.setState((state) => ({
      messages: reduceMessageTimeline(state.messages.filter(item => !isTombstoned(item)), { type: 'patch', id, updates }),
    }))
  }

  const guardedDeleteMessage = (id) => {
    pendingAssistantPlaceholders.delete(id)
    const existing = useStore.getState().messages.find(message => message.id === id)
    if (existing) {
      addMessageTombstones(existing)
      queueReliableServerDelete(existing)
    }
    useStore.setState((state) => ({
      messages: state.messages.filter(message => message.id !== id && !isTombstoned(message)),
    }))
  }

  const guardedDeleteMessagesFrom = (id) => {
    pendingAssistantPlaceholders.delete(id)
    useStore.setState((state) => {
      const index = state.messages.findIndex(message => message.id === id)
      if (index === -1) return {}
      const removed = state.messages.slice(index)
      for (const message of removed) {
        pendingAssistantPlaceholders.delete(message.id)
        addMessageTombstones(message)
        queueReliableServerDelete(message)
      }
      return { messages: state.messages.slice(0, index).filter(message => !isTombstoned(message)) }
    })
  }

  useStore.setState({
    setMessages: guardedSetMessages,
    mergeMessages: guardedMergeMessages,
    addMessage: guardedAddMessage,
    updateMessage: guardedUpdateMessage,
    deleteMessage: guardedDeleteMessage,
    deleteMessagesFrom: guardedDeleteMessagesFrom,
  })

  // Resume deletes left behind by a previous background kill / refresh.
  if (deleteOutbox.length) scheduleDeleteRetry()
}
