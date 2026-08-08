import { useCallback } from 'react'
import { useStore, saveMessage } from '../store'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function useScheduledMessages() {
  const { workerUrl, currentSessionId, sessions, apiProactiveEnabled } = useStore()
  const currentSession = sessions?.find(s => s.id === currentSessionId)
  // This hook belongs to the ordinary API proactive pipeline only.  In
  // particular, neither fixed VPS runtime may consume the API worker's
  // queue: Claude Code has its own server-side switch and Codex must never
  // receive an API-generated proactive bubble.
  const isOrdinarySession = currentSession?.providerName !== 'claude-code-vps'
    && currentSession?.providerName !== 'codex-vps'

  const fetchPendingMessages = useCallback(async () => {
    if (!workerUrl || !apiProactiveEnabled || !isOrdinarySession) return false
    const base = workerUrl.replace(/\/$/, '')
    const password = localStorage.getItem('auth.password')
    if (!password) return false
    const convId = currentSessionId || 'main'
    const key = `pending:${convId}`
    console.log('[PENDING] 拉取待发消息, key=', key, 'session=', convId)
    try {
      const res = await fetch(`${base}/sync/get?password=${encodeURIComponent(password)}&key=${encodeURIComponent(key)}`)
      if (!res.ok) {
        console.log('[PENDING] 拉取失败, status=', res.status)
        return false
      }
      const { value } = await res.json()
      const list = Array.isArray(value) ? value : []
      console.log('[PENDING] 拿到=', list)
      const unread = list.filter(m => !m.read)
      if (unread.length === 0) {
        console.log('[PENDING] 无未读消息')
        return false
      }

      // clear this session's pending queue (fire-and-forget)
      fetch(`${base}/sync/del`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, key }),
      }).catch(() => {})

      console.log('[PENDING] 插入', unread.length, '条主动消息到会话', convId)
      for (const m of unread) {
        await saveMessage({
          id: genId(),
          conversationId: convId,
          role: 'assistant',
          type: 'text',
          content: m.content,
          timestamp: m.timestamp,
          source: 'api-proactive',
        })
      }
      return true
    } catch (e) {
      console.log('[PENDING] 异常:', e.name, e.message)
      return false
    }
  }, [workerUrl, currentSessionId, apiProactiveEnabled, isOrdinarySession])

  const updateActiveTime = useCallback(() => {
    // CC/Codex activity must not update the ordinary API worker's global
    // activity clock.  Otherwise opening or using a VPS window changes the
    // timing of a completely different proactive pipeline.
    if (!workerUrl || !apiProactiveEnabled || !isOrdinarySession) return
    fetch(`${workerUrl.replace(/\/$/, '')}/user-active`, { method: 'POST' }).catch(() => {})
  }, [workerUrl, apiProactiveEnabled, isOrdinarySession])

  return { fetchPendingMessages, updateActiveTime }
}
