import { useEffect, useRef, useState } from 'react'
import { X, RotateCcw, Undo2, Flag, Phone } from 'lucide-react'
import {
  getGomokuState, newGomokuGame, makeGomokuMove, requestGomokuUndo, resignGomokuGame,
  onGomokuUpdate, onProactiveMessage, streamChatViaCompanion,
} from '../../services/companion'
import { fetchTTSAudio } from '../../services/tts'
import { saveBlob, useStore } from '../../store'
import MessageBubble from './MessageBubble'
import VoiceCall from '../Voice/VoiceCall'

const BOARD_SIZE = 15
let seq = 0
const genId = () => `gk-${Date.now()}-${++seq}`

// A standalone full-screen game view (fixed inset-0, own header/opponent/
// turn/restart/undo/resign/quit controls, own embedded text+voice chat) —
// NOT rendered inside MessageList, NOT chat bubbles, and none of its chat
// traffic ever touches the main conversation's IndexedDB/store (see the
// gomokuGameId-tagged proactive-message routing in App.jsx, which skips
// anything this screen owns). Closing it is not a route change — the
// persisted game just sits there server-side until reopened.
//
// Board/turn/legality/win-detection/undo-agreement all live server-side
// (channel-server.ts); this component only renders state and posts the
// user's own taps/messages. The opponent's moves and decisions are made by
// the real resident CC session via the gomoku_move/gomoku_undo_response MCP
// tools and arrive here purely as live broadcasts — there is no local
// move-picking logic anywhere in this file.
export default function GomokuBoard({ theme, aiName, aiAvatar, userAvatar, onClose }) {
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Embedded mini-chat — entirely local state, never saveMessage()'d, never
  // touches useStore's messages. Resets when this screen unmounts.
  const [chatMessages, setChatMessages] = useState([])
  const [chatInput, setChatInput] = useState('')
  const [chatBusy, setChatBusy] = useState(false)
  const [showCall, setShowCall] = useState(false)
  const callAudioRef = useRef(null)
  const chatLogRef = useRef(null)

  const s = useStore()
  const currentSession = s.sessions?.find(sess => sess.id === s.currentSessionId)
  const ttsApiKey = currentSession?.ttsApiKey || s.ttsApiKey
  const ttsGroupId = currentSession?.ttsGroupId || s.ttsGroupId
  const ttsVoiceId = currentSession?.ttsVoiceId || s.ttsVoiceId
  const ttsModel = currentSession?.ttsModel || s.ttsModel
  const hasTts = ttsApiKey && ttsGroupId

  useEffect(() => {
    let cancelled = false
    getGomokuState()
      .then(({ game }) => { if (!cancelled) setGame(game) })
      .catch(e => { if (!cancelled) setError(e.message || '加载棋局失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    const unsub = onGomokuUpdate(g => setGame(g))
    return () => { cancelled = true; unsub() }
  }, [])

  // Catches CC's reply/send_voice calls made *around* a move/undo/resign
  // decision (tagged gomokuGameId server-side) — these never touch the main
  // chat; this is their only destination.
  useEffect(() => {
    const unsub = onProactiveMessage(async (msg) => {
      if (!msg.gomokuGameId || msg.gomokuGameId !== game?.id) return
      await appendIncomingMessage(msg)
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id])

  useEffect(() => {
    chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight, behavior: 'smooth' })
  }, [chatMessages.length])

  // Shared by both the proactive listener above and the mini-chat's own
  // streamChatViaCompanion loop below — synthesizes voice with the same
  // fallback-to-text-on-failure/no-keys behavior used elsewhere, or just
  // appends plain text.
  const appendIncomingMessage = async ({ id, text, kind, voice, thinking, ts }) => {
    const reasoningFields = thinking ? { reasoning: thinking, reasoningStreaming: false } : {}
    if (kind === 'voice') {
      if (!hasTts) {
        setChatMessages(prev => [...prev, { id, role: 'assistant', type: 'text', content: text, voiceText: text, voiceFailed: true, timestamp: ts || Date.now(), streaming: false, ...reasoningFields }])
        return
      }
      try {
        const blob = await fetchTTSAudio(text, { apiKey: ttsApiKey, groupId: ttsGroupId, voiceId: voice || ttsVoiceId || 'English_Trustworthy_Man', model: ttsModel })
        let duration = 0
        try {
          const ab = await blob.arrayBuffer()
          const ac = new AudioContext()
          const decoded = await ac.decodeAudioData(ab)
          duration = Math.round(decoded.duration)
          ac.close()
        } catch {}
        const voiceBlobId = id + '-blob'
        await saveBlob(voiceBlobId, blob)
        setChatMessages(prev => [...prev, { id, role: 'assistant', type: 'voice', voiceBlobId, duration, content: '', voiceText: text, timestamp: ts || Date.now(), streaming: false, ...reasoningFields }])
      } catch (e) {
        setChatMessages(prev => [...prev, { id, role: 'assistant', type: 'text', content: text, voiceText: text, voiceFailed: true, timestamp: ts || Date.now(), streaming: false, ...reasoningFields }])
      }
      return
    }
    setChatMessages(prev => [...prev, { id, role: 'assistant', type: 'text', content: text, timestamp: ts || Date.now(), streaming: false, ...reasoningFields }])
  }

  const handleSendChat = async (rawText) => {
    const text = rawText.trim()
    if (!text || chatBusy) return
    setChatInput('')
    setChatMessages(prev => [...prev, { id: genId(), role: 'user', type: 'text', content: text, timestamp: Date.now(), streaming: false }])
    setChatBusy(true)

    let currentTextId = genId()
    let currentTextAdded = false
    let fullContent = ''
    let fullReasoning = ''

    const finalizeText = () => {
      if (currentTextAdded && fullContent.trim()) {
        setChatMessages(prev => prev.map(m => m.id === currentTextId ? { ...m, content: fullContent, streaming: false } : m))
      } else if (currentTextAdded) {
        setChatMessages(prev => prev.filter(m => m.id !== currentTextId))
      }
    }

    try {
      for await (const chunk of streamChatViaCompanion({ text })) {
        if (chunk.reasoningReplace !== undefined) fullReasoning = chunk.reasoningReplace
        else if (chunk.reasoning) fullReasoning += chunk.reasoning

        if (chunk.voice) {
          finalizeText()
          await appendIncomingMessage({ id: genId(), text: chunk.voice.text, kind: 'voice', voice: chunk.voice.voice, ts: Date.now() })
          currentTextId = genId()
          currentTextAdded = false
          fullContent = ''
          fullReasoning = ''
          continue
        }
        if (chunk.text) {
          fullContent += chunk.text
          if (!currentTextAdded) {
            setChatMessages(prev => [...prev, { id: currentTextId, role: 'assistant', type: 'text', content: '', timestamp: Date.now(), streaming: true }])
            currentTextAdded = true
          }
          const reasoningFields = fullReasoning ? { reasoning: fullReasoning, reasoningStreaming: false } : {}
          setChatMessages(prev => prev.map(m => m.id === currentTextId ? { ...m, content: fullContent, streaming: true, ...reasoningFields } : m))
        }
      }
      finalizeText()
    } catch (e) {
      setChatMessages(prev => [...prev, { id: genId(), role: 'assistant', type: 'text', content: `（消息发送失败：${e.message || '未知错误'}）`, timestamp: Date.now(), streaming: false }])
    } finally {
      setChatBusy(false)
    }
  }

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
    } catch {}
    callAudioRef.current = { el, ctx }
    setShowCall(true)
  }

  const handleCellClick = async (row, col) => {
    if (!game || game.status !== 'playing' || game.turn !== 'user' || game.board[row][col] !== 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const { game: updated } = await makeGomokuMove(row, col)
      setGame(updated)
    } catch (e) {
      setError(e.message || '落子失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleNewGame = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { game: fresh } = await newGomokuGame()
      setGame(fresh)
    } catch (e) {
      setError(e.message || '开始新对局失败')
    } finally {
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (busy || !game || game.moves.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const { mode, game: updated } = await requestGomokuUndo()
      if (updated) setGame(updated)
      if (mode === 'pending') setError('已请求悔棋，等待对方回应…')
    } catch (e) {
      setError(e.message || '悔棋请求失败')
    } finally {
      setBusy(false)
    }
  }

  const handleResign = async () => {
    if (busy || !game || game.status !== 'playing') return
    if (!window.confirm('确定要认输吗？')) return
    setBusy(true)
    setError(null)
    try {
      const { game: updated } = await resignGomokuGame()
      setGame(updated)
    } catch (e) {
      setError(e.message || '认输失败')
    } finally {
      setBusy(false)
    }
  }

  const primary = theme?.primary || '#ff85b3'
  const lastMove = game?.moves?.[game.moves.length - 1]
  const opponentName = aiName || 'AI'

  const turnText = loading ? '加载中…'
    : !game ? '点击"新开一局"落下第一子'
    : game.status === 'user_win' ? '🎉 你赢了！'
    : game.status === 'ai_win' ? (game.moves.length === 0 ? `${opponentName} 赢了` : `😮 ${opponentName} 赢了`)
    : game.status === 'draw' ? '平局'
    : game.turn === 'user' ? '轮到你落子'
    : `${opponentName} 思考中…`

  const gameOver = game && game.status !== 'playing'
  const boardLocked = !game || game.status !== 'playing' || game.turn !== 'user' || busy
  const canUndo = game && game.status === 'playing' && game.moves.length > 0 && !busy
  const canResign = game && game.status === 'playing' && !busy

  const avatarStyle = (active) => ({
    width: 40, height: 40, borderRadius: '50%', overflow: 'hidden',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
    background: 'rgba(255,255,255,0.55)',
    border: active ? `2.5px solid ${primary}` : '2px solid rgba(0,0,0,0.08)',
    boxShadow: active ? `0 0 0 3px ${primary}33` : 'none',
    transition: 'all 0.2s',
    flexShrink: 0,
  })

  const ctrlBtnStyle = (disabled) => ({
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 14px', borderRadius: 16, fontSize: 12.5, fontWeight: 500,
    background: 'rgba(255,255,255,0.55)', border: `1px solid ${primary}33`, color: '#8b5060',
    opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
  })

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 55, background: 'linear-gradient(165deg, #fce4ec 0%, #f8bbd0 30%, #ffeef5 70%, #fff0f6 100%)' }}>
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 flex-shrink-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)', paddingBottom: 6 }}>
        <button
          onClick={onClose}
          title="返回聊天"
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 34, height: 34, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}
        >
          <X size={17} />
        </button>
        <span className="font-semibold text-sm" style={{ color: '#8b5060' }}>五子棋对战</span>
        <button
          onClick={handleNewGame}
          disabled={busy}
          title="新开一局"
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 34, height: 34, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary, opacity: busy ? 0.5 : 1 }}
        >
          <RotateCcw size={15} />
        </button>
      </div>

      {/* Opponent panel */}
      <div className="flex items-center justify-center gap-3 px-4 flex-shrink-0" style={{ paddingBottom: 4 }}>
        <div className="flex flex-col items-center gap-0.5">
          <div style={avatarStyle(game?.status === 'playing' && game?.turn === 'user')}>
            {userAvatar ? <img src={userAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🐣'}
          </div>
          <span style={{ fontSize: 10, color: '#8b5060' }}>你（黑●）</span>
        </div>
        <span className="text-xs font-medium" style={{ color: '#c47a8a' }}>VS</span>
        <div className="flex flex-col items-center gap-0.5">
          <div style={avatarStyle(game?.status === 'playing' && game?.turn === 'ai')}>
            {aiAvatar ? <img src={aiAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸'}
          </div>
          <span style={{ fontSize: 10, color: '#8b5060' }}>对手{opponentName}（白○）</span>
        </div>
      </div>

      {/* Turn / result status */}
      <div className="text-center flex-shrink-0" style={{ paddingBottom: 6 }}>
        <span className="text-sm font-medium" style={{ color: gameOver ? primary : '#8b5060' }}>{turnText}</span>
        {error && <div className="text-xs mt-0.5" style={{ color: '#e07070' }}>{error}</div>}
      </div>

      {/* Board */}
      <div className="flex items-center justify-center px-4 flex-shrink-0" style={{ paddingBottom: 8 }}>
        {game && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
              width: 'min(78vw, 300px)',
              aspectRatio: '1',
              background: 'linear-gradient(155deg, #e8c088, #d9ac6c)',
              border: '3px solid #a67c4a',
              borderRadius: 6,
              boxShadow: '0 8px 24px rgba(139,80,96,0.25)',
              opacity: boardLocked && game.status === 'playing' ? 0.92 : 1,
            }}
          >
            {game.board.map((rowArr, r) => rowArr.map((cell, c) => {
              const isLast = lastMove && lastMove.row === r && lastMove.col === c
              const tappable = !boardLocked && cell === 0
              return (
                <button
                  key={`${r}-${c}`}
                  onClick={() => handleCellClick(r, c)}
                  disabled={!tappable}
                  style={{ position: 'relative', border: '0.5px solid rgba(90,60,30,0.35)', background: 'transparent', padding: 0, cursor: tappable ? 'pointer' : 'default' }}
                >
                  {cell !== 0 && (
                    <div style={{
                      position: 'absolute', inset: '9%', borderRadius: '50%',
                      background: cell === 1
                        ? 'radial-gradient(circle at 35% 28%, #666 0%, #111 70%, #000 100%)'
                        : 'radial-gradient(circle at 35% 28%, #fff 0%, #ddd 70%, #bbb 100%)',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.45)',
                    }} />
                  )}
                  {isLast && (
                    <div style={{ position: 'absolute', inset: '32%', borderRadius: '50%', border: `2px solid ${cell === 1 ? '#ff6a6a' : '#3a6ad0'}`, pointerEvents: 'none' }} />
                  )}
                </button>
              )
            }))}
          </div>
        )}
      </div>

      {/* Game controls: undo / resign */}
      <div className="flex items-center justify-center gap-3 flex-shrink-0" style={{ paddingBottom: 8 }}>
        <button onClick={handleUndo} disabled={!canUndo} style={ctrlBtnStyle(!canUndo)}>
          <Undo2 size={13} /> 悔棋
        </button>
        <button onClick={handleResign} disabled={!canResign} style={ctrlBtnStyle(!canResign)}>
          <Flag size={13} /> 认输
        </button>
      </div>

      {/* Embedded mini-chat with the opponent — local only, never touches
          the main conversation. */}
      <div className="flex-1 flex flex-col min-h-0 mx-3 mb-2 rounded-2xl overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.4)', border: `1px solid ${primary}22` }}>
        <div ref={chatLogRef} className="flex-1 overflow-y-auto px-2 pt-2" style={{ minHeight: 0 }}>
          {chatMessages.length === 0 && (
            <div className="text-center text-xs" style={{ color: '#c9a2ad', paddingTop: 8 }}>
              可以边下棋边和{opponentName}聊两句～
            </div>
          )}
          {chatMessages.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onLongPress={null}
              onRegenerate={null}
              onRegenerateRound={null}
              isLoading={chatBusy}
              userAvatar={userAvatar}
              aiAvatar={aiAvatar}
              theme={theme}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 px-2" style={{ padding: '6px 8px' }}>
          <button
            onClick={handleStartCall}
            title="语音通话"
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 34, height: 34, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}
          >
            <Phone size={15} />
          </button>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSendChat(chatInput) }}
            placeholder="跟对手说点什么…"
            style={{
              flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.7)', border: `1px solid ${primary}33`,
              borderRadius: 16, padding: '8px 12px', fontSize: 14, color: '#8b5060', outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => handleSendChat(chatInput)}
            disabled={chatBusy || !chatInput.trim()}
            style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: 16, fontSize: 13, fontWeight: 500,
              background: `linear-gradient(135deg, ${primary}, ${theme?.primaryDark || primary})`, color: '#fff', border: 'none',
              opacity: (chatBusy || !chatInput.trim()) ? 0.5 : 1,
            }}
          >
            发送
          </button>
        </div>
      </div>

      <div style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }} />

      {showCall && (
        <VoiceCall theme={theme} audioKit={callAudioRef.current} onClose={() => setShowCall(false)} />
      )}
    </div>
  )
}
