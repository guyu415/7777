import { useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { getDiceDuelState, onDiceDuelUpdate, rollDiceDuel } from '../../services/companion'

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']
const randomFace = () => Math.floor(Math.random() * 6) + 1

function resultText(round, aiName) {
  if (!round) return '你先扔，扔完就轮到对方'
  if (round.phase === 'waiting_opponent') return `等 ${aiName} 扔…`
  if (round.result === 'draw') return '一样大，平局！'
  return round.result === 'user_win' ? '你赢了！' : `${aiName} 赢了`
}

export default function DiceDuel({ theme, runtime, aiName, aiAvatar, userAvatar, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const opponentName = aiName || (runtime === 'codex' ? 'Codex' : 'CC')
  const [state, setState] = useState(null)
  const [userRolling, setUserRolling] = useState(false)
  const [opponentRolling, setOpponentRolling] = useState(false)
  const [userFace, setUserFace] = useState(null)
  const [opponentFace, setOpponentFace] = useState(null)
  const [error, setError] = useState('')
  const previousRoundRef = useRef(null)
  const latest = state?.rounds?.[state.rounds.length - 1]

  useEffect(() => {
    let alive = true
    getDiceDuelState(runtime)
      .then(data => {
        if (!alive) return
        setState(data.state)
        const round = data.state?.rounds?.at(-1)
        previousRoundRef.current = round
        setUserFace(round?.userRoll || null)
        setOpponentFace(round?.opponentRoll || null)
      })
      .catch(err => { if (alive) setError(err.message || '加载失败') })

    const off = onDiceDuelUpdate((nextState, nextRuntime) => {
      if (!alive || nextRuntime !== runtime) return
      const previous = previousRoundRef.current
      const next = nextState?.rounds?.at(-1)
      previousRoundRef.current = next
      setState(nextState)
      if (next && previous?.id === next.id && !previous.opponentRoll && next.opponentRoll) {
        setOpponentRolling(true)
        const timer = setInterval(() => setOpponentFace(randomFace()), 75)
        setTimeout(() => {
          clearInterval(timer)
          if (!alive) return
          setOpponentFace(next.opponentRoll)
          setOpponentRolling(false)
        }, 850)
      }
    })
    return () => { alive = false; off() }
  }, [runtime])

  const roll = async () => {
    if (userRolling || opponentRolling || latest?.phase === 'waiting_opponent') return
    setError('')
    setUserRolling(true)
    setOpponentFace(null)
    const timer = setInterval(() => setUserFace(randomFace()), 70)
    try {
      const data = await rollDiceDuel(runtime)
      const round = data.state?.rounds?.at(-1)
      previousRoundRef.current = round
      setState(data.state)
      await new Promise(resolve => setTimeout(resolve, 650))
      clearInterval(timer)
      setUserFace(round?.userRoll || null)
    } catch (err) {
      clearInterval(timer)
      setError(err.message || '骰子没扔出去')
    } finally {
      setUserRolling(false)
    }
  }

  const dice = (value, rolling) => (
    <div
      className={rolling ? 'dice-rolling' : ''}
      style={{ fontSize: 82, lineHeight: 1, color: primary, filter: `drop-shadow(0 6px 12px ${primary}35)` }}
    >
      {value ? FACES[value - 1] : '◇'}
    </div>
  )

  const waiting = latest?.phase === 'waiting_opponent'
  const showingResult = latest?.phase === 'complete' && !opponentRolling

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'linear-gradient(165deg, #fffafd 0%, #f4f8ff 100%)' }}>
      <style>{`@keyframes diceTumble{0%{transform:rotate(0) scale(.86)}35%{transform:rotate(130deg) scale(1.08)}70%{transform:rotate(255deg) scale(.94)}100%{transform:rotate(360deg) scale(1)}}.dice-rolling{animation:diceTumble .42s linear infinite}`}</style>
      <div className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)', borderBottom: '1px solid rgba(150,170,210,.18)' }}>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${primary}18`, color: primary }}><ChevronLeft size={20} /></button>
        <div className="font-semibold" style={{ color: '#4f5f7a' }}>骰子比大小</div>
        <div className="ml-auto text-xs" style={{ color: '#9aa7bd' }}>{runtime === 'codex' ? '和 Codex 玩' : '和 CC 玩'}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-7">
        <div className="w-full max-w-md mx-auto space-y-6">
          <div className="flex justify-end items-end gap-3">
            <div className="rounded-3xl rounded-br-md px-5 py-4 min-w-[126px] text-center" style={{ background: `${primary}18`, boxShadow: `0 8px 24px ${primary}18` }}>
              <div className="text-xs mb-2" style={{ color: '#8c7890' }}>你扔的</div>
              {dice(userFace, userRolling)}
            </div>
            <img src={userAvatar} alt="" className="w-11 h-11 rounded-full object-cover" />
          </div>

          {(latest || userRolling) && (
            <div className="flex justify-start items-end gap-3">
              <img src={aiAvatar} alt="" className="w-11 h-11 rounded-full object-cover" />
              <div className="rounded-3xl rounded-bl-md px-5 py-4 min-w-[126px] text-center" style={{ background: 'rgba(255,255,255,.9)', boxShadow: '0 8px 24px rgba(95,115,160,.10)' }}>
                <div className="text-xs mb-2" style={{ color: '#8c94a6' }}>{opponentName} 扔的</div>
                {dice(opponentFace, opponentRolling)}
              </div>
            </div>
          )}

          <div className="text-center pt-2">
            <div className="text-lg font-bold min-h-[28px]" style={{ color: primary }}>
              {userRolling ? '你的骰子滚动中…' : opponentRolling ? `${opponentName} 的骰子滚动中…` : resultText(latest, opponentName)}
            </div>
            <div className="mt-2 text-xs" style={{ color: '#9aa7bd' }}>
              你 {state?.userWins || 0} 胜 · {opponentName} {state?.opponentWins || 0} 胜 · 平 {state?.draws || 0}
            </div>
            {error && <div className="mt-3 text-xs" style={{ color: '#e07070' }}>{error}</div>}
          </div>

          <button
            onClick={roll}
            disabled={userRolling || opponentRolling || waiting}
            className="w-full py-3.5 rounded-full text-white font-semibold disabled:opacity-55"
            style={{ background: `linear-gradient(135deg, ${primary}, ${theme?.primaryDark || '#6e8fe8'})`, border: 0 }}
          >
            {userRolling ? '正在扔…' : waiting || opponentRolling ? `等 ${opponentName} 扔` : showingResult ? '再来一局' : '扔骰子'}
          </button>

          {state?.rounds?.length > 1 && (
            <div className="pt-2">
              <div className="text-xs font-semibold mb-2" style={{ color: '#8591aa' }}>最近几局</div>
              <div className="flex flex-wrap gap-2">
                {state.rounds.filter(round => round.phase === 'complete').slice(-8).reverse().map(round => (
                  <div key={round.id} className="px-3 py-2 rounded-xl text-sm" style={{ background: 'rgba(255,255,255,.72)', color: '#69758d' }}>
                    {FACES[round.userRoll - 1]} : {FACES[round.opponentRoll - 1]}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
