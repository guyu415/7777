import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  getCodexState, sendCodexMessage, stopCodex, resetCodex, onCodexEvent, ensureConnected,
} from '../services/companion'
import { fetchTTSAudio } from '../services/tts'
import { useStore, saveBlob, getBlob } from '../store'

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

// Only the two IN-PROGRESS states get a header label — the server's own
// codexStatus is now structurally never anything else (see
// channel-server.ts's CodexStatus comment: 'done' resolves straight back to
// 'idle', so there is no "已完成" value to ever render, live or on refresh).
// stopped/error are delivered separately as a one-shot codex_notice (see
// below) and shown as a toast, never a lingering header pill.
export const CODEX_STATUS_LABELS = {
  idle: '',
  thinking: '正在思考',
  working: '正在工作',
}

// Maps the server's own CodexMsg shape into exactly what MessageBubble
// already knows how to render — no new bubble type, no fabricated fields.
// `reasoning` is Codex's own official reasoning SUMMARY text (see
// channel-server.ts — item/reasoning/summaryTextDelta only, never the raw
// hidden chain-of-thought), rendered via MessageBubble's existing
// collapsible thinking fold, same as Claude Code's. kind:'voice' messages
// start as a loading placeholder here — resolveCodexVoiceBubble (below)
// is what turns them into a real playable bubble (or a text/voiceFailed
// degrade), exactly mirroring useChat.js's deliverVpsVoice/finalize flow.
function toBubble(codexMsg) {
  if (codexMsg.kind === 'voice') {
    return {
      id: codexMsg.id,
      role: codexMsg.from === 'user' ? 'user' : 'assistant',
      type: 'text',
      content: '',
      timestamp: codexMsg.ts,
      streaming: false,
      voiceLoading: true,
    }
  }
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

// The IndexedDB blob key a given Codex voice message's audio lives under —
// deterministic from the server's own stable message id, so a plain page
// refresh (same browser — IndexedDB survives it) can find the SAME blob
// again without re-synthesizing, exactly matching "刷新后仍能播放". A
// different device/cleared storage simply won't find it — see
// resolveCodexVoiceBubble's own comment for the honest degrade in that case.
function codexVoiceBlobId(msgId) {
  return `codex-voice-${msgId}`
}

export function useCodexChat() {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle')
  const [openTurnId, setOpenTurnId] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [sendError, setSendError] = useState(null)
  // A one-shot stopped/error notice for ChatWindow.jsx to show as a brief
  // toast — a fresh object identity every time (even for a repeated
  // message), never persisted/replayed on refresh, and never folded into
  // `status` (which only ever holds idle/thinking/working — see
  // CODEX_STATUS_LABELS's own comment).
  const [notice, setNotice] = useState(null)

  // Same session-then-global TTS config fallback useChat.js uses — Codex's
  // voice reuses the CURRENT session's own configured voice, never a
  // Codex-specific voice system.
  const {
    sessions, currentSessionId, ttsApiKey, ttsGroupId, ttsVoiceId, ttsModel, aiVoiceEnabled,
  } = useStore(useShallow(s => ({
    sessions: s.sessions, currentSessionId: s.currentSessionId,
    ttsApiKey: s.ttsApiKey, ttsGroupId: s.ttsGroupId, ttsVoiceId: s.ttsVoiceId, ttsModel: s.ttsModel,
    aiVoiceEnabled: s.aiVoiceEnabled,
  })))
  const currentSession = sessions?.find(s => s.id === currentSessionId)
  const effectiveTtsApiKey = currentSession?.ttsApiKey || ttsApiKey
  const effectiveTtsGroupId = currentSession?.ttsGroupId || ttsGroupId
  const effectiveTtsVoiceId = currentSession?.ttsVoiceId || ttsVoiceId
  const effectiveTtsModel = currentSession?.ttsModel || 'speech-2.6-hd'
  // Read via a ref inside the async resolver below so it always sees the
  // LATEST config without needing to be a dependency of the WS-subscribing
  // effect (that effect must only run once per mount — see its own comment).
  const ttsConfigRef = useRef(null)
  ttsConfigRef.current = { effectiveTtsApiKey, effectiveTtsGroupId, effectiveTtsVoiceId, effectiveTtsModel, aiVoiceEnabled }

  const updateMsg = useCallback((id, updates) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = { ...next[idx], ...updates }
      return next
    })
  }, [])

  // Synthesizes (or, for a history-hydration pass, just looks up) the real
  // audio for one kind:'voice' CodexMsg, mirroring useChat.js's
  // deliverVpsVoice/finalize handling field-for-field (type/voiceBlobId/
  // duration/voiceText/voiceFailed/voiceLoading) so MessageBubble/
  // VoicePlayer/the favorite-voice action all work identically to Claude
  // Code's own voice bubbles — no Codex-specific voice UI anywhere.
  //
  // attemptSynthesis=true (a live, brand-new arrival): if no local blob
  // exists yet (the normal case — it's new), really calls the session's
  // configured TTS API. attemptSynthesis=false (bulk history hydration on
  // load/reconnect): only checks IndexedDB — a same-browser refresh finds
  // the blob synthesized earlier and plays it immediately; a genuinely
  // missing blob (different device/cleared storage) degrades to a real text
  // bubble with voiceFailed, rather than silently re-synthesizing the whole
  // history's audio on every load.
  const resolveCodexVoiceMsg = useCallback(async (codexMsg, attemptSynthesis) => {
    const blobId = codexVoiceBlobId(codexMsg.id)
    const existing = await getBlob(blobId).catch(() => null)
    if (existing) {
      let duration = 0
      try {
        const ab = await existing.arrayBuffer()
        const ac = new AudioContext()
        const decoded = await ac.decodeAudioData(ab)
        duration = Math.round(decoded.duration)
        ac.close()
      } catch {}
      updateMsg(codexMsg.id, { type: 'voice', voiceBlobId: blobId, duration, content: '', voiceText: codexMsg.text, voiceLoading: false })
      return
    }
    if (!attemptSynthesis) {
      // Same honest fallback as useChat.js's no-TTS-configured branch — a
      // real text bubble with the real text, clearly marked, never a
      // silent loss.
      updateMsg(codexMsg.id, { type: 'text', content: codexMsg.text, voiceText: codexMsg.text, voiceFailed: true, voiceLoading: false })
      return
    }
    const { effectiveTtsApiKey: apiKey, effectiveTtsGroupId: groupId, effectiveTtsVoiceId: voiceId, effectiveTtsModel: model, aiVoiceEnabled: enabled } = ttsConfigRef.current
    const hasTts = apiKey && groupId && enabled
    if (!hasTts) {
      updateMsg(codexMsg.id, { type: 'text', content: codexMsg.text, voiceText: codexMsg.text, voiceFailed: true, voiceLoading: false })
      return
    }
    try {
      const blob = await fetchTTSAudio(codexMsg.text, { apiKey, groupId, voiceId: codexMsg.voice || voiceId || 'English_Trustworthy_Man', model })
      let duration = 0
      try {
        const ab = await blob.arrayBuffer()
        const ac = new AudioContext()
        const decoded = await ac.decodeAudioData(ab)
        duration = Math.round(decoded.duration)
        ac.close()
      } catch {}
      await saveBlob(blobId, blob)
      updateMsg(codexMsg.id, { type: 'voice', voiceBlobId: blobId, duration, content: '', voiceText: codexMsg.text, voiceLoading: false })
    } catch (e) {
      console.error('[CODEX-VOICE] 合成失败:', e?.message)
      updateMsg(codexMsg.id, { type: 'text', content: codexMsg.text, voiceText: codexMsg.text, voiceFailed: true, voiceLoading: false })
    }
  }, [updateMsg])

  const refresh = useCallback(async () => {
    ensureConnected()
    try {
      const s = await getCodexState()
      const history = s.history || []
      setMessages(history.map(toBubble))
      setStatus(s.status || 'idle')
      setOpenTurnId(s.openTurnId ?? null)
      for (const m of history) {
        if (m.kind === 'voice') resolveCodexVoiceMsg(m, false)
      }
    } catch {
      // best-effort — leave last-known state showing (e.g. companion not
      // logged in yet); the settings page's own two-layer status readout is
      // what surfaces that, not this hook
    } finally {
      setLoaded(true)
    }
  }, [resolveCodexVoiceMsg])

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
          for (const m of evt.codexHistory) {
            if (m.kind === 'voice') resolveCodexVoiceMsg(m, false)
          }
          break
        case 'codex_msg': {
          setMessages((prev) => {
            const idx = prev.findIndex((m) => m.id === evt.msg.id)
            const bubble = toBubble(evt.msg)
            if (idx === -1) return [...prev, bubble]
            const next = [...prev]
            next[idx] = bubble
            return next
          })
          // A voice message always arrives complete (never streamed) — a
          // brand-new live one, so this is the "really synthesize it" path.
          if (evt.msg.kind === 'voice') resolveCodexVoiceMsg(evt.msg, true)
          break
        }
        case 'codex_status':
          setStatus(evt.status)
          break
        case 'codex_notice':
          setNotice({ kind: evt.kind, message: evt.message, ts: Date.now() })
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
    // Deliberately mount-only (refresh/resolveCodexVoiceMsg are stable via
    // useCallback) — re-subscribing on every TTS-setting change would tear
    // down and rebuild the WS listener mid-conversation for no reason; the
    // resolver always reads the latest settings via ttsConfigRef instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    status, statusLabel: CODEX_STATUS_LABELS[status] || '', openTurnId, loaded, sendError, reset, notice,
  }
}
