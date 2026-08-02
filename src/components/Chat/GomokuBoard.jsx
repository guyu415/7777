import { useEffect, useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { getGomokuState, newGomokuGame, makeGomokuMove, onGomokuUpdate } from '../../services/companion'

const BOARD_SIZE = 15

// Full-board overlay inside the current chat view — never a route change.
// Board/turn/legality/win-detection all live server-side (channel-server.ts);
// this component only renders state and posts the user's own taps. The AI's
// side is placed by the real resident CC session via the gomoku_move MCP
// tool and arrives here purely as a live 'gomoku_update' broadcast — there
// is no local move-picking logic anywhere in this file.
export default function GomokuBoard({ theme, onClose }) {
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getGomokuState()
      .then(({ game }) => { if (!cancelled) setGame(game) })
      .catch(e => { if (!cancelled) setError(e.message || '加载棋局失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    const unsub = onGomokuUpdate(g => setGame(g))
    return () => { cancelled = true; unsub() }
  }, [])

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

  const primary = theme?.primary || '#ff85b3'
  const lastMove = game?.moves?.[game.moves.length - 1]

  const statusText = loading ? '加载中…'
    : !game ? '点击"重新开始"落下第一子'
    : game.status === 'user_win' ? '🎉 你赢了！'
    : game.status === 'ai_win' ? '😮 AI 赢了'
    : game.status === 'draw' ? '平局'
    : game.turn === 'user' ? '轮到你落子（黑●）'
    : 'AI 思考中…（白○）'

  const boardLocked = !game || game.status !== 'playing' || game.turn !== 'user' || busy

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 55, background: 'linear-gradient(165deg, #fce4ec 0%, #f8bbd0 30%, #ffeef5 70%, #fff0f6 100%)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4"
        style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)', paddingBottom: 10 }}>
        <button
          onClick={onClose}
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 36, height: 36, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}
        >
          <X size={18} />
        </button>
        <span className="font-semibold text-sm" style={{ color: '#8b5060' }}>五子棋</span>
        <button
          onClick={handleNewGame}
          disabled={busy}
          title="重新开始"
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 36, height: 36, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary, opacity: busy ? 0.5 : 1 }}
        >
          <RotateCcw size={16} />
        </button>
      </div>

      {/* Status line */}
      <div className="text-center" style={{ paddingBottom: 8 }}>
        <span className="text-sm font-medium" style={{ color: '#8b5060' }}>{statusText}</span>
        {error && <div className="text-xs mt-1" style={{ color: '#e07070' }}>{error}</div>}
      </div>

      {/* Board */}
      <div className="flex-1 flex items-center justify-center px-4" style={{ minHeight: 0 }}>
        {game && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${BOARD_SIZE}, 1fr)`,
              width: 'min(92vw, 360px)',
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
                  style={{
                    position: 'relative',
                    border: '0.5px solid rgba(90,60,30,0.35)',
                    background: 'transparent',
                    padding: 0,
                    cursor: tappable ? 'pointer' : 'default',
                  }}
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
                    <div style={{
                      position: 'absolute', inset: '32%', borderRadius: '50%',
                      border: `2px solid ${cell === 1 ? '#ff6a6a' : '#3a6ad0'}`,
                      pointerEvents: 'none',
                    }} />
                  )}
                </button>
              )
            }))}
          </div>
        )}
      </div>

      <div style={{ paddingBottom: 'max(24px, env(safe-area-inset-bottom, 0px) + 16px)' }} />
    </div>
  )
}
