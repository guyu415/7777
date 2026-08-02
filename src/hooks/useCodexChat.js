import { useCallback, useEffect, useState } from 'react'
import {
  getCodexState, sendCodexMessage, stopCodex, resetCodex, onCodexEvent, ensureConnected,
} from '../services/companion'

// Codex (codex-vps) — an entirely separate chat runtime from Claude Code.
// This hook only ever reads/writes Codex's own wire messages (codex_*) and
// REST endpoints (/codex/*); it never touches useChat.js's state, IndexedDB
// messages, or the Claude Code WS turn machinery, so the two can run fully
// concurrently without interfering with each other.

export const CODEX_STATUS_LABELS = {
  idle: '',
  thinking: '正在思考',
  working: '正在工作',
  done: '已完成',
  stopped: '已停止',
  error: '出错了',
}

// Maps the server's own CodexMsg shape into exactly what MessageBubble
// already knows how to render — no new bubble type, no fabricated fields.
// `reasoning` is Codex's own official reasoning SUMMARY text (see
// channel-server.ts — item/reasoning/summaryTextDelta only, never the raw
// hidden chain-of-thought), rendered via MessageBubble's existing
// collapsible thinking fold, same as Claude Code's.
function toBubble(codexMsg) {
  return {
    id: codexMsg.id,
    role: codexMsg.from === 'user' ? 'user' : 'assistant',
    type: codexMsg.imageUrl ? 'image' : 'text',
    content: codexMsg.text || '',
    imageUrl: codexMsg.imageUrl,
    timestamp: codexMsg.ts,
    streaming: !!codexMsg.streaming,
    reasoning: codexMsg.reasoning || undefined,
    reasoningStreaming: !!(codexMsg.streaming && codexMsg.reasoning),
  }
}

export function useCodexChat() {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle')
  const [openTurnId, setOpenTurnId] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [sendError, setSendError] = useState(null)

  useEffect(() => {
    ensureConnected()
    let cancelled = false
    getCodexState()
      .then((s) => {
        if (cancelled) return
        setMessages((s.history || []).map(toBubble))
        setStatus(s.status || 'idle')
        setOpenTurnId(s.openTurnId ?? null)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })

    const unsub = onCodexEvent((evt) => {
      switch (evt.type) {
        // Fires once per (re)connect — this is what restores history after a
        // refresh AND resumes seeing an in-progress task's status/turnId
        // after a disconnect/reconnect, since it's the server's own current
        // state, not something replayed from local storage.
        case 'codex_history_snapshot':
          setMessages(evt.codexHistory.map(toBubble))
          setStatus(evt.codexStatus)
          setOpenTurnId(evt.codexOpenTurnId)
          setLoaded(true)
          break
        case 'codex_msg':
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === evt.msg.id)
            const bubble = toBubble(evt.msg)
            if (idx === -1) return [...prev, bubble]
            const next = [...prev]
            next[idx] = bubble
            return next
          })
          break
        case 'codex_status':
          setStatus(evt.status)
          break
        case 'codex_turn_end':
          setOpenTurnId(null)
          break
        case 'codex_turn_busy':
          setOpenTurnId(evt.turnId)
          break
        case 'codex_reset':
          setMessages([])
          setStatus('idle')
          setOpenTurnId(null)
          break
        default:
          break
      }
    })
    return () => { cancelled = true; unsub() }
  }, [])

  const sendMessage = useCallback((text) => {
    const trimmed = (text || '').trim()
    if (!trimmed) return
    setSendError(null)
    const ok = sendCodexMessage(trimmed)
    if (!ok) setSendError('未连接，请稍后重试')
  }, [])

  const sendImage = useCallback(({ imageUrl }) => {
    if (!imageUrl) return
    setSendError(null)
    const ok = sendCodexMessage('', imageUrl)
    if (!ok) setSendError('未连接，请稍后重试')
  }, [])

  const stop = useCallback(() => {
    stopCodex().catch(() => {})
  }, [])

  const reset = useCallback(async () => {
    await resetCodex()
  }, [])

  const isLoading = status === 'thinking' || status === 'working'

  return {
    messages, status, statusLabel: CODEX_STATUS_LABELS[status] || '',
    isLoading, openTurnId, loaded, sendError,
    sendMessage, sendImage, stop, reset,
  }
}
