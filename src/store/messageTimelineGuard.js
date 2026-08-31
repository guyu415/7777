import { useStore } from './index'
import {
  appendTimelineMessage,
  canonicalizeTimeline,
  isRenderableTimelineMessage,
  isSuppressibleAssistantPlaceholder,
  normalizeTimelineMessage,
  reconcileTimelineSnapshot,
  updateTimelineMessage,
} from '../utils/messageTimeline'

// Every message source eventually touches the Zustand timeline except Codex's
// isolated runtime. Install one guard before React mounts so history loads,
// proactive history replay and live streaming all obey the same ordering /
// dedupe rules instead of each call site inventing its own merge semantics.
const INSTALL_KEY = '__eunoiaMessageTimelineGuardV1'

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true
  const pendingAssistantPlaceholders = new Map()

  const clearIrrelevantPending = (activeConversationId) => {
    for (const [id, message] of pendingAssistantPlaceholders) {
      if (activeConversationId && message.conversationId === activeConversationId) continue
      pendingAssistantPlaceholders.delete(id)
    }
  }

  const guardedSetMessages = (messages) => {
    useStore.setState((state) => {
      const incoming = Array.isArray(messages) ? messages : []
      const activeConversationId = incoming.find(message => message?.conversationId)?.conversationId
        || state.currentSessionId
      clearIrrelevantPending(activeConversationId)
      const next = incoming.length === 0
        ? []
        : reconcileTimelineSnapshot(state.messages, incoming)
      return { messages: next }
    })
  }

  const guardedAddMessage = (message) => {
    const normalized = normalizeTimelineMessage(message)
    if (!normalized) return
    if (isSuppressibleAssistantPlaceholder(normalized)) {
      pendingAssistantPlaceholders.set(normalized.id, normalized)
      return
    }
    useStore.setState((state) => ({
      messages: appendTimelineMessage(state.messages, normalized),
    }))
  }

  const guardedUpdateMessage = (id, updates) => {
    if (pendingAssistantPlaceholders.has(id)) {
      const pending = pendingAssistantPlaceholders.get(id)
      const next = normalizeTimelineMessage({ ...pending, ...updates }, pending.timestamp)
      if (isSuppressibleAssistantPlaceholder(next)) {
        pendingAssistantPlaceholders.set(id, next)
        return
      }
      pendingAssistantPlaceholders.delete(id)
      if (!isRenderableTimelineMessage(next)) return
      useStore.setState((state) => ({
        messages: appendTimelineMessage(state.messages, next),
      }))
      return
    }

    useStore.setState((state) => ({
      messages: updateTimelineMessage(state.messages, id, updates),
    }))
  }

  const guardedDeleteMessage = (id) => {
    pendingAssistantPlaceholders.delete(id)
    useStore.setState((state) => ({
      messages: state.messages.filter(message => message.id !== id),
    }))
  }

  const guardedDeleteMessagesFrom = (id) => {
    pendingAssistantPlaceholders.delete(id)
    useStore.setState((state) => {
      const index = state.messages.findIndex(message => message.id === id)
      if (index === -1) return {}
      const removed = state.messages.slice(index)
      for (const message of removed) pendingAssistantPlaceholders.delete(message.id)
      return { messages: canonicalizeTimeline(state.messages.slice(0, index)) }
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
