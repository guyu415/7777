import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { getDiceDuelState, rollDiceDuel } from '../../services/companion'

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

function resultText(round, aiName) {
  if (!round) return '按一下，一起扔骰子'
  if (round.result === 'draw') return '平局，再来！'
  return round.result === 'user_win' ? '你赢了！' : `${aiName} 赢了`
}

export default function DiceDuel({ theme, runtime, aiName, aiAvatar, userAvatar, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const [state, setState] = useState(null)
  const [rolling, setRolling] = useState(false)
  const [error, setError] = useState('')
  const latest = state?.rounds?.[state.rounds.length - 1]

  useEffect(() => {
    let alive = true
    getDiceDuelState(runtime)
      .then(data => { if (alive) setState(data.state) })
      .catch(err => { if (alive) setError(err.message || '加载失败') })
    return () => { alive = false }
  }, [runtime])

  const roll = async () => {
    if (rolling) return
    setRolling(true)
    setError('')
    try {
      const data = await rollDiceDuel(runtime)
      setState(data.state)
    } catch (err) {
      setError(err.message || '骰子没扔出去')
    } finally {
      setRolling(false)
    }
  }

  const player = (name, avatar, value) => (
    <div className="flex-1 flex flex-col items-center gap-3 min-w-0">
      <img src={avatar} alt="" className="w-14 h-14 rounded-full object-cover" style={{ boxShadow: `0 4px 16px ${primary}33` }} />
      <div className="text-sm font-semibold truncate max-w-full" style={{ color: '#5c6680' }}>{name}</div>
      <div className={rolling ? 'animate-bounce' : ''} style={{ fontSize: 88, lineHeight: 1, color: primary, filter: `drop-shadow(0 6px 12px ${primary}33)` }}>
        {value ? FACES[value - 1] : '◇'}
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'linear-gradient(165deg, #fffafd 0%, #f4f8ff 100%)' }}>
      <div className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)', borderBottom: '1px solid rgba(150,170,210,.18)' }}>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${primary}18`, color: primary }}><ChevronLeft size={20} /></button>
        <div className="font-semibold" style={{ color: '#4f5f7a' }}>骰子比大小</div>
        <div className="ml-auto text-xs" style={{ color: '#9aa7bd' }}>{runtime === 'codex' ? 'Codex 局' : 'CC 局'}</div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8 flex flex-col items-center">
        <div className="w-full max-w-md rounded-3xl p-6" style={{ background: 'rgba(255,255,255,.78)', boxShadow: '0 16px 50px rgba(95,115,160,.12)' }}>
          <div className="flex items-start gap-5">
            {player('你', userAvatar, latest?.userRoll)}
            <div className="pt-24 text-sm font-bold" style={{ color: '#b0b8c8' }}>VS</div>
            {player(aiName || (runtime === 'codex' ? 'Codex' : 'CC'), aiAvatar, latest?.opponentRoll)}
          </div>
          <div className="text-center mt-6 text-lg font-bold" style={{ color: primary }}>{rolling ? '骰子滚动中…' : resultText(latest, aiName || '对方')}</div>
          <div className="text-center mt-2 text-xs" style={{ color: '#9aa7bd' }}>
            你 {state?.userWins || 0} 胜 · {aiName || '对方'} {state?.opponentWins || 0} 胜 · 平 {state?.draws || 0}
          </div>
          {error && <div className="text-center mt-3 text-xs" style={{ color: '#e07070' }}>{error}</div>}
          <button onClick={roll} disabled={rolling} className="w-full mt-6 py-3.5 rounded-full text-white font-semibold disabled:opacity-60" style={{ background: `linear-gradient(135deg, ${primary}, ${theme?.primaryDark || '#6e8fe8'})`, border: 0 }}>
            {rolling ? '正在扔…' : '一起扔骰子'}
          </button>
        </div>

        {state?.rounds?.length > 0 && (
          <div className="w-full max-w-md mt-6">
            <div className="text-xs font-semibold mb-2 px-1" style={{ color: '#8591aa' }}>最近结果</div>
            <div className="flex flex-wrap gap-2">
              {state.rounds.slice(-10).reverse().map(round => (
                <div key={round.id} className="px-3 py-2 rounded-xl text-sm" style={{ background: 'rgba(255,255,255,.72)', color: '#69758d' }}>
                  {FACES[round.userRoll - 1]} : {FACES[round.opponentRoll - 1]}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
