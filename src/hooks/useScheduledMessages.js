import { useCallback } from 'react'
import { useStore, saveMessage } from '../store'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const CONV_ID = 'main'

export function useScheduledMessages() {
  const { workerUrl } = useStore()

  // Fetches unread proactive messages, saves them to IndexedDB, returns true if any found
  const fetchPendingMessages = useCallback(async () => {
    if (!workerUrl) return false
    const base = workerUrl.replace(/\/$/, '')
    try {
      const res = await fetch(`${base}/pending-messages`)
      if (!res.ok) return false
      const list = await res.json()
      const unread = list.filter(m => !m.read)
      if (unread.length === 0) return false

      // fire-and-forget
      fetch(`${base}/mark-read`, { method: 'POST' }).catch(() => {})

      for (const m of unread) {
        await saveMessage({
          id: genId(),
          conversationId: CONV_ID,
          role: 'assistant',
          type: 'text',
          content: m.content,
          timestamp: m.timestamp,
        })
      }
      return true
    } catch {
      return false
    }
  }, [workerUrl])

  const updateActiveTime = useCallback(() => {
    if (!workerUrl) return
    fetch(`${workerUrl.replace(/\/$/, '')}/user-active`, { method: 'POST' }).catch(() => {})
  }, [workerUrl])

  return { fetchPendingMessages, updateActiveTime }
}
