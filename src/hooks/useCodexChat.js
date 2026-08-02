import { useCallback, useEffect, useState } from 'react'
import {
  getCodexState, sendCodexMessage, stopCodex, resetCodex, onCodexEvent, ensureConnected,
} from '../services/companion'

// Codex (codex-vps) — an entirely separate chat runtime from Claude Code.
// This hook only ever reads/writes Codex's own wire messages (codex_*) and
// REST endpoints (/codex/*); it never touches useChat.js's state, IndexedDB
// messages, or the Claude Code WS turn machinery, so the two can run fully
// concurrently without interfering with each other.
//
// Returns the SAME shape useChat() does (messages/sendMessage/loadHistory/
// isLoading/regenerate/regenerateRound/deleteMsg/editMessage/stopStreaming)
// so the shared ChatWindow.jsx can use either hook interchangeably via one
// small runtime switch, instead of maintaining a second full page shell —
// see ChatWindow.jsx's own top-of-file comment.

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

  const refresh = useCallback(async () => {
    ensureConnected()
    try {
      const s = await getCodexState()
      setMessages((s.history || []).map(toBubble))
      setStatus(s.status || 'idle')
      setOpenTurnId(s.openTurnId ?? null)
    } catch {
      // best-effort — leave last-known state showing (e.g. companion not
      // logged in yet); the settings page's own two-layer status readout is
      // what surfaces that, not this hook
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    refresh()

    const unsub = onCodexEvent((evt) => {
      if (cancelled) return
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
  }, [refresh])

  // Single entry point for both a plain text send and an image(+caption)
  // send — mirrors useChat().sendMessage(content, type, extra)'s call shape
  // so ChatWindow.jsx can invoke either hook identically, but what actually
  // matters here is just whether extra.imageUrl is present: the backend's
  // codexSendUserTurn already builds ONE turn/start with both a text and an
  // image UserInput when both are given (see channel-server.ts), so a
  // caption typed alongside a picked image is delivered as a single real
  // Codex turn, never two separate sends.
  // async even though the body is synchronous — ChatWindow.jsx calls
  // useChat()'s sendMessage() and chains .catch() on the result; this must
  // return a real Promise too so that call site works unchanged for either
  // runtime.
  const sendMessage = useCallback(async (content, _type = 'text', extra = {}) => {
    const text = (content || '').trim()
    const imageUrl = extra?.imageUrl
    if (!text && !imageUrl) return
    setSendError(null)
    const ok = sendCodexMessage(text, imageUrl)
    if (!ok) setSendError('未连接，请稍后重试')
  }, [])

  const loadHistory = useCallback(() => { refresh() }, [refresh])

  const stopStreaming = useCallback(() => {
    stopCodex().catch(() => {})
  }, [])

  const reset = useCallback(async () => {
    await resetCodex()
  }, [])

  // No per-message edit/delete/regenerate backend for Codex (only real
  // send/stop/reset/history exist) — same honest "not supported" pattern
  // ChatWindow.jsx already uses for the Claude Code VPS session, reused
  // here rather than silently no-op-ing.
  const notSupported = useCallback(() => {
    throw new Error('Codex 常驻会话暂不支持该操作')
  }, [])

  const isLoading = status === 'thinking' || status === 'working'

  return {
    messages, sendMessage, loadHistory, isLoading,
    regenerate: notSupported, regenerateRound: notSupported,
    deleteMsg: notSupported, editMessage: notSupported,
    stopStreaming,
    // Codex-only extras ChatWindow.jsx reads directly (not part of useChat()'s shape)
    status, statusLabel: CODEX_STATUS_LABELS[status] || '', openTurnId, loaded, sendError, reset,
  }
}
