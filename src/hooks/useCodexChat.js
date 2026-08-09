import { useCallback, useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  getCodexState, sendCodexMessage, stopCodex, resetCodex, onCodexEvent, ensureConnected, selectCodexSession,
  deleteCodexMessage, editCodexMessage,
} from '../services/companion'
import { fetchTTSAudio } from '../services/tts'
import { useStore, saveBlob, getBlob } from '../store'
import { DEFAULT_CODEX_SESSION_ID } from '../utils/codexProtocol'

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
    type: codexMsg.imageUrl ? 'image' : codexMsg.filePath ? 'file' : 'text',
    content: codexMsg.text || '',
    imageUrl: codexMsg.imageUrl,
    filePath: codexMsg.filePath,
    fileName: codexMsg.fileName,
    fileSize: codexMsg.fileSize,
    fileType: codexMsg.fileType,
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
  const lastFailedSendRef = useRef(null)
  // A one-shot stopped/error notice for ChatWindow.jsx to show as a brief
  // toast — a fresh object identity every time (even for a repeated
  // message), never persisted/replayed on refresh, and never folded into
  // `status` (which only ever holds idle/thinking/working for the input
  // control; it is not rendered as a text status badge).
  const [notice, setNotice] = useState(null)
  // Stopping is optimistic in the UI: the partial answer remains visible but
  // is frozen immediately, while the companion interrupt request catches up.
  // Late deltas/finalization for that same turn are ignored until the server
  // confirms codex_turn_end, so the pause button really stops output instead
  // of merely stopping the spinner.
  const stopRequestedRef = useRef(false)
  const activeTurnIdRef = useRef(null)
  const stoppedTurnIdRef = useRef(null)

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
  // useCodexChat is called unconditionally by the shared ChatWindow to obey
  // the Rules of Hooks.  Only a Codex session may select a per-conversation
  // Codex thread; ordinary/CC sessions must keep the legacy main id and an
  // empty prompt so merely viewing another window cannot create or mutate a
  // Codex thread.
  const isCodexSession = currentSession?.providerName === 'codex-vps'
  const codexSessionId = isCodexSession ? (currentSessionId || DEFAULT_CODEX_SESSION_ID) : DEFAULT_CODEX_SESSION_ID
  const codexPrompt = isCodexSession ? (currentSession?.systemPrompt || '') : ''
  const codexSessionIdRef = useRef(codexSessionId)
  codexSessionIdRef.current = codexSessionId
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
    const sessionId = codexSessionIdRef.current
    selectCodexSession(sessionId)
    try {
      const s = await getCodexState(sessionId)
      const history = s.history || []
      setMessages(history.map(toBubble))
      setStatus(s.status || 'idle')
      setOpenTurnId(s.openTurnId ?? null)
      activeTurnIdRef.current = s.openTurnId ?? null
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
      const eventSessionId = evt.sessionId || 'main'
      if (eventSessionId !== codexSessionIdRef.current) return
      switch (evt.type) {
        // Fires once per (re)connect — this is what restores history after a
        // refresh AND resumes seeing an in-progress task's status/turnId
        // after a disconnect/reconnect, since it's the server's own current
        // state, not something replayed from local storage.
        case 'codex_history_snapshot':
          setMessages(evt.codexHistory.map(toBubble))
          setStatus(stopRequestedRef.current ? 'idle' : evt.codexStatus)
          setOpenTurnId(stopRequestedRef.current ? null : evt.codexOpenTurnId)
          activeTurnIdRef.current = evt.codexOpenTurnId ?? null
          setLoaded(true)
          for (const m of evt.codexHistory) {
            if (m.kind === 'voice') resolveCodexVoiceMsg(m, false)
          }
          break
        case 'codex_msg': {
          const msgTurnId = evt.msg.turnId || null
          const isAssistantStream = evt.msg.from === 'codex'
          if (msgTurnId && isAssistantStream && evt.msg.streaming && !stopRequestedRef.current) {
            // The accepted-turn path does not emit codex_turn_busy (that
            // event is reserved for a rejected second send), so learn the
            // active turn from the first streamed assistant message too.
            activeTurnIdRef.current = msgTurnId
            setOpenTurnId(msgTurnId)
          }
          if (stopRequestedRef.current && isAssistantStream
            && (!stoppedTurnIdRef.current || !msgTurnId || msgTurnId === stoppedTurnIdRef.current)) {
            // Keep the partial bubble already on screen, but do not let a
            // trailing delta or the server's final streaming:false update
            // revive it after the user pressed stop.
            break
          }
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
        case 'codex_msg_deleted':
          setMessages((prev) => prev.filter((message) => message.id !== evt.id))
          break
        case 'codex_status':
          if (stopRequestedRef.current && evt.status !== 'idle') break
          setStatus(evt.status)
          break
        case 'codex_notice':
          setNotice({ kind: evt.kind, message: evt.message, ts: Date.now() })
          break
        case 'codex_turn_end':
          setOpenTurnId(null)
          if (!stoppedTurnIdRef.current || evt.turnId === stoppedTurnIdRef.current) {
            activeTurnIdRef.current = null
            stopRequestedRef.current = false
            stoppedTurnIdRef.current = null
          }
          break
        case 'codex_turn_busy':
          setOpenTurnId(evt.turnId)
          activeTurnIdRef.current = evt.turnId
          break
        case 'codex_reset':
          setMessages([])
          setStatus('idle')
          setOpenTurnId(null)
          activeTurnIdRef.current = null
          stopRequestedRef.current = false
          stoppedTurnIdRef.current = null
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
    const file = extra?.filePath ? { path: extra.filePath, name: extra.fileName, size: extra.fileSize, mimeType: extra.fileType } : undefined
    if (!text && !imageUrl && !file) return
    stopRequestedRef.current = false
    stoppedTurnIdRef.current = null
    setSendError(null)
    const ok = sendCodexMessage(text, imageUrl, { sessionId: codexSessionId, prompt: codexPrompt, file })
    if (!ok) {
      lastFailedSendRef.current = { kind: 'single', content, type: _type, extra }
      setSendError('未连接，请稍后重试')
    } else {
      lastFailedSendRef.current = null
    }
  }, [codexPrompt, codexSessionId])

  // Keep each Enter-split segment as its own visible user bubble while still
  // starting exactly one Codex turn (Codex only permits one active turn per
  // thread). The server persists/broadcasts the ordered segments separately
  // and joins them only for the model input.
  const sendMessageBatch = useCallback(async (contents) => {
    const trimmed = (contents || []).map(c => (c || '').trim()).filter(Boolean)
    if (trimmed.length === 0) return
    if (trimmed.length === 1) return sendMessage(trimmed[0], 'text')
    stopRequestedRef.current = false
    stoppedTurnIdRef.current = null
    setSendError(null)
    const ok = sendCodexMessage(trimmed.join('\n'), undefined, {
      sessionId: codexSessionId, prompt: codexPrompt, segments: trimmed,
    })
    if (!ok) {
      lastFailedSendRef.current = { kind: 'batch', contents: trimmed }
      setSendError('未连接，请稍后重试')
    } else {
      lastFailedSendRef.current = null
    }
  }, [codexPrompt, codexSessionId, sendMessage])

  const retryFailed = useCallback(async () => {
    const attempt = lastFailedSendRef.current
    if (!attempt) return
    if (attempt.kind === 'batch') await sendMessageBatch(attempt.contents)
    else await sendMessage(attempt.content, attempt.type, attempt.extra)
  }, [sendMessage, sendMessageBatch])

  const deleteMsg = useCallback(async (id) => {
    await deleteCodexMessage(codexSessionId, id)
    setMessages((prev) => prev.filter((message) => message.id !== id))
  }, [codexSessionId])

  const editMessage = useCallback(async (id, text) => {
    const result = await editCodexMessage(codexSessionId, id, text)
    updateMsg(id, { content: result?.text ?? text, edited: true, editedAt: Date.now() })
  }, [codexSessionId, updateMsg])

  const loadHistory = useCallback(() => { refresh() }, [refresh])

  const stopStreaming = useCallback(() => {
    const turnId = openTurnId || activeTurnIdRef.current
    stopRequestedRef.current = true
    stoppedTurnIdRef.current = turnId || null
    setStatus('idle')
    setOpenTurnId(null)
    setMessages(prev => prev.map(m => m.streaming ? { ...m, streaming: false } : m))
    stopCodex(codexSessionId).catch(() => {})
  }, [openTurnId, codexSessionId])

  const reset = useCallback(async () => {
    await resetCodex(codexSessionId)
  }, [codexSessionId])

  // A stateful Codex thread cannot genuinely regenerate an earlier answer;
  // display-history edit/delete is supported separately above, matching CC.
  const notSupported = useCallback(() => {
    throw new Error('Codex 常驻会话暂不支持该操作')
  }, [])

  const isLoading = status === 'thinking' || status === 'working'

  return {
    messages, sendMessage, sendMessageBatch, loadHistory, isLoading,
    regenerate: notSupported, regenerateRound: notSupported, retryFailed,
    deleteMsg, editMessage,
    stopStreaming,
    // Codex-only extras ChatWindow.jsx reads directly (not part of useChat()'s shape)
    status, openTurnId, loaded, sendError, reset, notice,
  }
}
