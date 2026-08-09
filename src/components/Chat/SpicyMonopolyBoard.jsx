import { useEffect, useRef, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { getSpicyVisualState } from '../../services/companion'

const FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']
const TILE_META = {
  start: ['🏁', '起点', '#ffe5a8'], task: ['🎯', '任务', '#ffd9e6'], truth: ['💬', '真心话', '#d8ecff'],
  chance: ['🎴', '机会', '#e2dcff'], mystery: ['❓', '未知', '#d8f5ea'], jail: ['🔒', '监狱', '#e2e5ec'], shop: ['🛒', '商店', '#fff0c8'],
}

function coord(index) {
  if (index <= 5) return { row: 6, col: index + 1 }
  if (index <= 10) return { row: 11 - index, col: 6 }
  if (index <= 15) return { row: 1, col: 16 - index }
  return { row: index - 15, col: 1 }
}

export default function SpicyMonopolyBoard({ theme, onClose, onRequestRoll, isLoading }) {
  const primary = theme?.primary || '#ff85b3'
  const [game, setGame] = useState(null)
  const [positions, setPositions] = useState({})
  const [diceFace, setDiceFace] = useState(null)
  const [rolling, setRolling] = useState(false)
  const [movingPlayer, setMovingPlayer] = useState('')
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState('')
  const initialized = useRef(false)
  const lastEventSeq = useRef(0)
  const positionsRef = useRef({})
  const timers = useRef([])

  const clearTimers = () => {
    timers.current.forEach(timer => clearTimeout(timer))
    timers.current = []
  }

  useEffect(() => {
    let alive = true
    const apply = (next) => {
      if (!alive) return
      if (!next) { setGame(null); return }
      const event = next.event || {}
      const names = Object.keys(next.positions || {})
      if (!initialized.current) {
        initialized.current = true
        lastEventSeq.current = event.seq || 0
        positionsRef.current = { ...(next.positions || {}) }
        setPositions(positionsRef.current)
        setDiceFace(event.dice || null)
        setGame(next)
        return
      }
      if (!event.seq || event.seq === lastEventSeq.current) {
        setGame(next)
        return
      }
      lastEventSeq.current = event.seq
      setRequested(false)
      setGame(next)
      const who = event.who
      const dice = Number(event.dice)
      if (!who || !Number.isInteger(dice) || dice < 1) {
        positionsRef.current = { ...(next.positions || {}) }
        setPositions(positionsRef.current)
        return
      }

      clearTimers()
      setRolling(true)
      setMovingPlayer('')
      let spins = 0
      const spin = () => {
        if (!alive) return
        setDiceFace((spins % 6) + 1)
        spins += 1
        if (spins < 9) timers.current.push(setTimeout(spin, 75))
        else {
          setDiceFace(dice)
          setRolling(false)
          setMovingPlayer(who)
          const finalPos = Number(next.positions?.[who] ?? 0)
          const startPos = Number(positionsRef.current?.[who] ?? ((finalPos - dice + 20) % 20))
          names.forEach(name => {
            if (name !== who) positionsRef.current[name] = next.positions[name]
          })
          let step = 0
          const move = () => {
            if (!alive) return
            step += 1
            positionsRef.current = { ...positionsRef.current, [who]: (startPos + step) % 20 }
            setPositions(positionsRef.current)
            if (step < dice) timers.current.push(setTimeout(move, 230))
            else {
              positionsRef.current = { ...(next.positions || {}) }
              setPositions(positionsRef.current)
              setMovingPlayer('')
            }
          }
          timers.current.push(setTimeout(move, 180))
        }
      }
      spin()
    }

    const load = async () => {
      try {
        const data = await getSpicyVisualState()
        apply(data.state)
        setError('')
      } catch (err) {
        if (alive) setError(err.message || '棋盘暂时连不上')
      }
    }
    load()
    const poll = setInterval(load, 700)
    return () => { alive = false; clearInterval(poll); clearTimers() }
  }, [])

  const names = Object.keys(game?.positions || {})
  const colors = ['#ff6f9f', '#668cff']
  const tokenAt = (index) => names.filter(name => Number(positions[name]) === index)
  const busy = rolling || !!movingPlayer || requested || isLoading

  return (
    <div className="fixed inset-0 z-[82] flex flex-col" style={{ background: 'radial-gradient(circle at 50% 35%, #fffdf4 0%, #fff4f8 48%, #eef4ff 100%)' }}>
      <style>{`@keyframes spicyDice{0%{transform:rotate(0) scale(.82)}50%{transform:rotate(190deg) scale(1.12)}100%{transform:rotate(360deg) scale(.82)}}@keyframes tokenHop{50%{transform:translateY(-7px) scale(1.1)}}.spicy-dice-roll{animation:spicyDice .36s linear infinite}.spicy-token-hop{animation:tokenHop .42s ease-in-out infinite}`}</style>
      <div className="flex items-center gap-3 px-4 pb-3" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)', borderBottom: '1px solid rgba(150,130,160,.16)' }}>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${primary}18`, color: primary }}><ChevronLeft size={20} /></button>
        <div className="font-semibold" style={{ color: '#655260' }}>涩涩大富翁</div>
        <div className="ml-auto text-xs" style={{ color: '#a28f9b' }}>动画棋盘 · 内容在聊天里</div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-5 flex flex-col items-center">
        <div className="relative grid gap-1.5 w-full" style={{ maxWidth: 470, aspectRatio: '1', gridTemplateColumns: 'repeat(6,minmax(0,1fr))', gridTemplateRows: 'repeat(6,minmax(0,1fr))' }}>
          {(game?.tiles || Array(20).fill('task')).map((type, index) => {
            const [emoji, label, bg] = TILE_META[type] || TILE_META.task
            const { row, col } = coord(index)
            return (
              <div key={index} className="relative rounded-xl flex flex-col items-center justify-center overflow-visible" style={{ gridRow: row, gridColumn: col, background: bg, border: '1px solid rgba(125,95,115,.10)', boxShadow: '0 3px 10px rgba(100,75,90,.08)' }}>
                <span style={{ fontSize: 'clamp(17px,5vw,28px)', lineHeight: 1 }}>{emoji}</span>
                <span className="hidden sm:block" style={{ fontSize: 9, color: '#8d7885', marginTop: 3 }}>{label}</span>
                <span style={{ position: 'absolute', top: 2, left: 4, fontSize: 8, color: '#a997a2' }}>{index}</span>
                <div className="absolute -bottom-1 right-0 flex">
                  {tokenAt(index).map(name => {
                    const playerIndex = names.indexOf(name)
                    return <span key={name} className={movingPlayer === name ? 'spicy-token-hop' : ''} title={name} style={{ width: 21, height: 21, marginLeft: -5, borderRadius: '50%', display: 'grid', placeItems: 'center', background: colors[playerIndex] || primary, color: 'white', fontSize: 10, fontWeight: 800, border: '2px solid white', boxShadow: '0 2px 5px rgba(0,0,0,.18)' }}>{name.slice(0, 1)}</span>
                  })}
                </div>
              </div>
            )
          })}

          <div className="rounded-3xl flex flex-col items-center justify-center text-center px-3" style={{ gridRow: '2 / 6', gridColumn: '2 / 6', background: 'rgba(255,255,255,.74)', border: '1px solid rgba(255,255,255,.9)', boxShadow: 'inset 0 0 35px rgba(255,190,215,.18), 0 10px 30px rgba(100,75,90,.08)' }}>
            {!game ? (
              <>
                <div style={{ fontSize: 42 }}>🎲</div>
                <div className="mt-2 text-sm font-semibold" style={{ color: '#765d6b' }}>还没有进行中的棋局</div>
                <div className="mt-1 text-xs" style={{ color: '#a08d98' }}>先回 CC 窗说“开始玩涩涩大富翁”</div>
              </>
            ) : (
              <>
                <div className={rolling ? 'spicy-dice-roll' : ''} style={{ fontSize: 'clamp(46px,14vw,76px)', lineHeight: 1, color: primary, filter: `drop-shadow(0 6px 12px ${primary}35)` }}>{diceFace ? FACES[diceFace - 1] : '◇'}</div>
                <div className="mt-2 text-sm font-bold" style={{ color: '#735866' }}>{rolling ? '骰子滚动中…' : movingPlayer ? `${movingPlayer} 前进中…` : `轮到 ${game.turn || '下一位'}`}</div>
                <div className="mt-1 text-xs" style={{ color: '#a08d98' }}>回合 {game.round || 0}/{game.total_rounds || '?'}</div>
                <button onClick={() => { setRequested(true); onRequestRoll?.(); timers.current.push(setTimeout(() => setRequested(false), 15000)) }} disabled={busy} className="mt-4 rounded-full px-6 py-2.5 text-white text-sm font-semibold disabled:opacity-50" style={{ border: 0, background: `linear-gradient(135deg, ${primary}, ${theme?.primaryDark || '#718ee8'})` }}>{busy ? '等 CC…' : '摇骰子'}</button>
              </>
            )}
          </div>
        </div>

        {game && <div className="w-full max-w-[470px] mt-4 grid grid-cols-2 gap-3">{names.map((name, index) => <div key={name} className="rounded-2xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,.72)', border: `1px solid ${colors[index]}22` }}><div className="text-sm font-semibold truncate" style={{ color: colors[index] }}>{name}</div><div className="text-xs mt-1" style={{ color: '#887684' }}>💰 {game.coins?.[name] ?? 0} · 第 {(game.laps?.[name] ?? 0) + 1} 圈 · 格 {positions[name] ?? 0}</div></div>)}</div>}
        {error && <div className="mt-3 text-xs" style={{ color: '#d96f78' }}>{error}</div>}
      </div>
    </div>
  )
}
