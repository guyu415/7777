import { useEffect, useRef, useState } from 'react'
import { X, RotateCcw, Undo2, Flag, Mic } from 'lucide-react'
import {
  getGomokuState, newGomokuGame, makeGomokuMove, requestGomokuUndo, resignGomokuGame,
  onGomokuUpdate, onTurnEnd, postGomokuChat,
} from '../../services/companion'
import { fetchTTSAudio } from '../../services/tts'
import { useStore } from '../../store'
import MessageBubble from './MessageBubble'

const BOARD_SIZE = 15
const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition

// A standalone full-screen game view (fixed inset-0, own header/opponent/
// turn/restart/undo/resign/quit controls, own in-game chat log + text input +
// press-and-hold voice) — NOT rendered inside MessageList, NOT chat bubbles.
//
// In-game chat is entirely server-persisted on the game itself
// (currentGame.messages in channel-server.ts, delivered via the SAME
// gomoku_update broadcast as board state) — never the main conversation's
// history/IndexedDB. Sending goes through POST /gomoku/chat (postGomokuChat);
// CC's reply/send_voice calls made during that turn are routed server-side
// straight into the game's messages log, so there is no client-side tagging
// or dedup race to get wrong — closing this screen and reopening it (or a
// full reload) just re-fetches the same persisted log via getGomokuState().
//
// Board/turn/legality/win-detection/undo-agreement/chat routing all live
// server-side; this component only renders state and posts the user's own
// taps/messages. The opponent's moves, decisions, and chat replies are made
// by the real resident CC session via the gomoku_move/gomoku_undo_response/
// reply/send_voice MCP tools and arrive here purely as live broadcasts —
// there is no local move-picking or reply-generating logic anywhere in this
// file.
export default function GomokuBoard({ theme, aiName, aiAvatar, userAvatar, onClose }) {
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const [chatInput, setChatInput] = useState('')
  const [sending, setSending] = useState(false)
  const [chatError, setChatError] = useState(null)
  const [recording, setRecording] = useState(false)
  const pendingInteractionRef = useRef(null)
  const recRef = useRef(null)
  const chatLogRef = useRef(null)
  // Ids of AI voice-kind messages already synthesized+played this session —
  // pre-seeded with whatever's already in history on mount so reopening a
  // game (or a reload) never replays old voice history, only genuinely new
  // arrivals from here on.
  const playedVoiceIdsRef = useRef(new Set())

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
      .then(({ game }) => {
        if (cancelled) return
        setGame(game)
        for (const m of game?.messages || []) playedVoiceIdsRef.current.add(m.id)
      })
      .catch(e => { if (!cancelled) setError(e.message || '加载棋局失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    const unsub = onGomokuUpdate(g => setGame(g))
    return () => { cancelled = true; unsub() }
  }, [])

  // Clears the send-in-flight state once the specific chat turn we're
  // waiting on actually finishes — not a fixed timeout, so it tracks reality
  // even if CC takes a while (or, rarely, doesn't call reply/send_voice at
  // all for a given turn).
  useEffect(() => {
    const unsub = onTurnEnd(turnId => {
      if (turnId && turnId === pendingInteractionRef.current) {
        pendingInteractionRef.current = null
        setSending(false)
      }
    })
    return unsub
  }, [])

  useEffect(() => {
    chatLogRef.current?.scrollTo({ top: chatLogRef.current.scrollHeight, behavior: 'smooth' })
  }, [game?.messages?.length])

  // Auto-play newly-arrived AI voice replies right here on the board page —
  // no full-screen call UI, board stays fully interactive throughout.
  useEffect(() => {
    const msgs = game?.messages || []
    for (const m of msgs) {
      if (m.from !== 'ai' || m.kind !== 'voice' || playedVoiceIdsRef.current.has(m.id)) continue
      playedVoiceIdsRef.current.add(m.id)
      if (!hasTts) continue
      fetchTTSAudio(m.text, { apiKey: ttsApiKey, groupId: ttsGroupId, voiceId: m.voice || ttsVoiceId || 'English_Trustworthy_Man', model: ttsModel })
        .then(blob => {
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audio.onended = () => URL.revokeObjectURL(url)
          audio.onerror = () => URL.revokeObjectURL(url)
          audio.play().catch(() => URL.revokeObjectURL(url))
        })
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.messages, hasTts])

  const handleSendChat = async (rawText, opts = {}) => {
    const text = (rawText || '').trim()
    if (!text || sending || !game) return
    setChatInput('')
    setChatError(null)
    setSending(true)
    try {
      const { interactionId } = await postGomokuChat(game.id, text, !!opts.voice)
      pendingInteractionRef.current = interactionId
    } catch (e) {
      setSending(false)
      setChatError(e.message || '发送失败，请重试')
    }
  }

  // Press-and-hold voice: real Web Speech API recording/STT (same mechanism
  // useVoiceCall.js uses for its own listen()), just start-on-press/
  // stop-on-release instead of continuous silence-detection. The transcript
  // goes through the exact same postGomokuChat() path as typed text — no new
  // voice-message/voice-bubble handling, no full-screen call UI, board never
  // leaves view.
  const startHold = () => {
    if (recording || sending || !game) return
    if (!SpeechRecognitionAPI) { setChatError('此浏览器不支持语音识别'); return }
    setChatError(null)
    let finalText = ''
    const rec = new SpeechRecognitionAPI()
    rec.lang = 'zh-CN'
    rec.interimResults = false
    rec.continuous = true
    rec.onresult = (e) => {
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript
      }
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setChatError('麦克风权限被拒绝，请在系统设置里允许')
    }
    rec.onend = () => {
      recRef.current = null
      setRecording(false)
      const text = finalText.trim()
      if (text) handleSendChat(text, { voice: true })
    }
    recRef.current = rec
    setRecording(true)
    try {
      rec.start()
    } catch {
      setRecording(false)
      recRef.current = null
    }
  }
  const endHold = () => {
    try { recRef.current?.stop() } catch {}
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
      playedVoiceIdsRef.current = new Set()
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

  const chatBubbles = (game?.messages || []).map(m => ({
    id: m.id,
    role: m.from === 'user' ? 'user' : 'assistant',
    type: 'text',
    content: m.text,
    timestamp: m.ts,
    streaming: false,
  }))

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

      {/* In-game chat log — persisted with the game (game.messages), never
          the main conversation. Scrollable, sits between the board and the
          input row. */}
      <div className="flex-1 flex flex-col min-h-0 mx-3 mb-2 rounded-2xl overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.4)', border: `1px solid ${primary}22` }}>
        <div ref={chatLogRef} className="flex-1 overflow-y-auto px-2 pt-2" style={{ minHeight: 0 }}>
          {chatBubbles.length === 0 && (
            <div className="text-center text-xs" style={{ color: '#c9a2ad', paddingTop: 8 }}>
              可以边下棋边和{opponentName}聊两句～
            </div>
          )}
          {chatBubbles.map(msg => (
            <MessageBubble
              key={msg.id}
              message={msg}
              onLongPress={null}
              onRegenerate={null}
              onRegenerateRound={null}
              isLoading={false}
              userAvatar={userAvatar}
              aiAvatar={aiAvatar}
              theme={theme}
            />
          ))}
          {chatError && <div className="text-xs text-center" style={{ color: '#e07070', padding: '4px 0' }}>{chatError}</div>}
        </div>
        <div className="flex items-center gap-2 px-2" style={{ padding: '6px 8px' }}>
          <button
            onPointerDown={startHold}
            onPointerUp={endHold}
            onPointerLeave={endHold}
            onPointerCancel={endHold}
            title="按住说话"
            disabled={sending}
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 34, height: 34, borderRadius: '50%', border: 'none',
              background: recording ? primary : `${primary}18`,
              color: recording ? '#fff' : primary,
              opacity: sending ? 0.5 : 1,
              touchAction: 'none',
            }}
          >
            <Mic size={15} />
          </button>
          <input
            value={chatInput}
            onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSendChat(chatInput) }}
            placeholder={recording ? '正在听你说…' : '跟对手说点什么…'}
            disabled={recording}
            style={{
              flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.7)', border: `1px solid ${primary}33`,
              borderRadius: 16, padding: '8px 12px', fontSize: 14, color: '#8b5060', outline: 'none', fontFamily: 'inherit',
            }}
          />
          <button
            onClick={() => handleSendChat(chatInput)}
            disabled={sending || !chatInput.trim()}
            style={{
              flexShrink: 0, padding: '8px 14px', borderRadius: 16, fontSize: 13, fontWeight: 500,
              background: `linear-gradient(135deg, ${primary}, ${theme?.primaryDark || primary})`, color: '#fff', border: 'none',
              opacity: (sending || !chatInput.trim()) ? 0.5 : 1,
            }}
          >
            发送
          </button>
        </div>
      </div>

      <div style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom, 0px))' }} />
    </div>
  )
}
