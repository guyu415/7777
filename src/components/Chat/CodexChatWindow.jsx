import { useRef, useState } from 'react'
import { Menu, Trash2 } from 'lucide-react'
import MessageList from './MessageList'
import MessageInput from './MessageInput'
import VoiceCall from '../Voice/VoiceCall'
import { useCodexChat } from '../../hooks/useCodexChat'
import { useStore } from '../../store'

// Codex's own fixed chat window — a genuinely separate runtime from Claude
// Code (see useCodexChat.js/companion.js's codex_* wire messages and
// channel-server.ts's fully independent Codex session/history/turn-state).
// Reuses MessageList/MessageBubble/MessageInput/VoiceCall exactly as-is
// (same components Claude Code's ChatWindow uses); this file only supplies
// Codex's own simpler header/state — no gomoku, letter cards, memory
// summaries, or regenerate (Codex's app-server protocol has no equivalent
// of any of those, same as how the existing Claude Code VPS window already
// omits regenerate/image-in-context for its own protocol reasons).
export default function CodexChatWindow({ theme }) {
  const { setCurrentView } = useStore()
  const {
    messages, statusLabel, isLoading, loaded, sendError,
    sendMessage, sendImage, stop, reset,
  } = useCodexChat()

  const [showCall, setShowCall] = useState(false)
  const callAudioRef = useRef(null)
  const [resetBusy, setResetBusy] = useState(false)
  const [resetError, setResetError] = useState(null)

  const primaryColor = theme?.primary || '#ff85b3'

  let lastAiId = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') { lastAiId = messages[i].id; break }
  }

  // Same audio-unlock trick ChatWindow.jsx uses for its own call button —
  // reused verbatim, not reinvented: a silent frame played from inside the
  // user's own click gesture so WebAudio can play freely once the real call
  // starts (iOS is strict about audio outside a direct gesture).
  const handleStartCall = () => {
    const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
    const el = new Audio(SILENT_WAV)
    el.play().catch(() => {})
    let ctx = null
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      ctx = new AC()
      ctx.resume().catch(() => {})
      const buf = ctx.createBuffer(1, 1, 22050)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start(0)
    } catch (e) {
      console.warn('[CODEX-CALL] AudioContext 创建失败:', e.message)
    }
    callAudioRef.current = { el, ctx }
    setShowCall(true)
  }

  const handleReset = async () => {
    if (resetBusy || isLoading) return
    const ok = window.confirm(
      '确定要清空当前对话吗？\n\n将同时清空当前页面消息、服务器记录，并重置 Codex 当前上下文，不影响 Claude Code。'
    )
    if (!ok) return
    setResetBusy(true)
    setResetError(null)
    try {
      await reset()
    } catch (e) {
      setResetError(e.message || '清空失败，请稍后重试')
    } finally {
      setResetBusy(false)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)', paddingBottom: 12,
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderBottom: `1px solid ${primaryColor}22`,
          flexShrink: 0,
        }}>
        <button
          onClick={() => setCurrentView('sessions')}
          title="会话列表"
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200"
          style={{ background: `${primaryColor}18`, color: primaryColor }}
        >
          <Menu size={16} />
        </button>
        <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-xl flex-shrink-0"
          style={{
            background: `${primaryColor}33`,
            border: '2px solid rgba(120,160,220,0.55)',
          }}>
          🤖
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-sm" style={{ color: primaryColor }}>Codex</div>
          <div style={{ fontSize: 12, color: '#8b5060', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {statusLabel || (loaded ? '在线' : '连接中…')}
          </div>
        </div>
        <button
          onClick={handleReset}
          disabled={resetBusy || isLoading}
          title="清空当前对话"
          className="flex items-center justify-center flex-shrink-0"
          style={{
            width: 34, height: 34, borderRadius: '50%', background: `${primaryColor}18`, border: 'none',
            color: primaryColor, opacity: (resetBusy || isLoading) ? 0.4 : 1,
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>

      {resetError && (
        <div className="px-4 pt-1.5 text-xs flex-shrink-0" style={{ color: '#e07070' }}>{resetError}</div>
      )}
      {sendError && (
        <div className="px-4 pt-1.5 text-xs flex-shrink-0" style={{ color: '#e07070' }}>{sendError}</div>
      )}

      <div className="flex-1 relative overflow-hidden">
        <MessageList
          messages={messages}
          sessionId="codex-vps"
          onLongPress={null}
          lastAiId={lastAiId}
          onRegenerate={null}
          onRegenerateRound={null}
          isLoading={isLoading}
          userAvatar=""
          aiAvatar=""
          theme={theme}
          emptyAiName="Codex"
          emptyHasApiKey={true}
          onEmptyConfigureClick={() => {}}
        />
      </div>

      <MessageInput
        onSend={sendMessage}
        onSendImage={sendImage}
        onStartCall={handleStartCall}
        isVpsProvider={false}
        isLoading={isLoading}
        onStop={stop}
        theme={theme}
      />

      {showCall && (
        <VoiceCall theme={theme} audioKit={callAudioRef.current} onClose={() => setShowCall(false)} />
      )}
    </div>
  )
}
