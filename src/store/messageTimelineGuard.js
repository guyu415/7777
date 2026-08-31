import { useStore } from './index'
import {
  appendTimelineMessage,
  canonicalizeTimeline,
  isRenderableTimelineMessage,
  isSuppressibleAssistantPlaceholder,
  messageIdentityKeys,
  normalizeTimelineMessage,
  reconcileTimelineSnapshot,
  updateTimelineMessage,
} from '../utils/messageTimeline'

// Every message source eventually touches the Zustand timeline except Codex's
// isolated runtime. Install one guard before React mounts so history loads,
// proactive history replay and live streaming all obey the same ordering /
// dedupe rules instead of each call site inventing its own merge semantics.
const INSTALL_KEY = '__eunoiaMessageTimelineGuardV2'

// A local delete must survive reconnect/history replay. Without a tombstone,
// deleting only removes the row from Zustand/IndexedDB; a stale server history
// snapshot can immediately add the same wire back and make the user delete it
// over and over. Keep identity tombstones locally for long enough that every
// normal cloud/VPS sync path has ample time to converge.
const TOMBSTONE_STORAGE_KEY = 'eunoia.messageTombstones.v1'
const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOMBSTONE_LIMIT = 4000

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

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true
  const pendingAssistantPlaceholders = new Map()
  const tombstones = loadTombstones()

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

  const addMessageTombstones = (message) => {
    if (!message) return
    const conversationId = message.conversationId || useStore.getState().currentSessionId || ''
    const expiresAt = Date.now() + TOMBSTONE_TTL_MS
    let changed = false
    for (const id of messageIdentityKeys(message)) {
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
    for (const id of messageIdentityKeys(message)) {
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
      const next = rawIncoming.length === 0
        ? []
        : incoming.length === 0
          ? current
          : reconcileTimelineSnapshot(current, incoming)
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
      messages: appendTimelineMessage(state.messages.filter(item => !isTombstoned(item)), normalized),
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
        messages: appendTimelineMessage(state.messages.filter(item => !isTombstoned(item)), next),
      }))
      return
    }

    const existing = useStore.getState().messages.find(message => message.id === id)
    if (!existing || isTombstoned(existing)) return
    useStore.setState((state) => ({
      messages: updateTimelineMessage(state.messages.filter(item => !isTombstoned(item)), id, updates),
    }))
  }

  const guardedDeleteMessage = (id) => {
    pendingAssistantPlaceholders.delete(id)
    const existing = useStore.getState().messages.find(message => message.id === id)
    if (existing) addMessageTombstones(existing)
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
      }
      return { messages: canonicalizeTimeline(state.messages.slice(0, index).filter(message => !isTombstoned(message))) }
    })
  }

  useStore.setState({
    setMessages: guardedSetMessages,
    addMessage: guardedAddMessage,
    updateMessage: guardedUpdateMessage,
    deleteMessage: guardedDeleteMessage,
    deleteMessagesFrom: guardedDeleteMessagesFrom,
  })
}
