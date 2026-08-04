import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings, X } from 'lucide-react'
import { useStore } from '../store'
import { getDesktopPetReaction } from '../services/desktopPet'

const PET_W = 88
const PET_H = 136
const ACTIONS = [
  { id: 'pet', label: '摸摸', mark: '♡' },
  { id: 'pinch', label: '捏脸', mark: 'ˋ' },
  { id: 'bonk', label: '锤他', mark: '!' },
  { id: 'lift', label: '拎起', mark: '？' },
]

function clampPosition(x, y) {
  const shellWidth = Math.min(window.innerWidth, 448)
  const shellLeft = Math.max(0, (window.innerWidth - shellWidth) / 2)
  return {
    x: Math.max(shellLeft + 4, Math.min(x, shellLeft + shellWidth - PET_W - 4)),
    y: Math.max(56, Math.min(y, window.innerHeight - PET_H - 28)),
  }
}

export default function DesktopPet({ theme }) {
  const {
    sessions, currentSessionId, desktopPet, updateDesktopPet,
    providers, selectedProviderId, apiKey, apiBaseUrl, model, workerUrl, useWorkerProxy,
  } = useStore()
  const [position, setPosition] = useState(() => clampPosition(
    Number.isFinite(desktopPet?.x) ? desktopPet.x : window.innerWidth - 102,
    Number.isFinite(desktopPet?.y) ? desktopPet.y : window.innerHeight - 300,
  ))
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [reaction, setReaction] = useState('')
  const [expression, setExpression] = useState('')
  const [motion, setMotion] = useState('')
  const [loading, setLoading] = useState(false)
  const drag = useRef(null)
  const abortRef = useRef(null)
  const reactionTimer = useRef(null)
  const lastLiftReaction = useRef(0)

  const selectedSessionId = desktopPet?.sessionId || currentSessionId || sessions?.[0]?.id
  const selectedSession = useMemo(
    () => sessions?.find((session) => session.id === selectedSessionId) || sessions?.[0],
    [sessions, selectedSessionId],
  )
  const scale = desktopPet?.scale || 1
  const globals = useMemo(() => ({
    providers, selectedProviderId, apiKey, apiBaseUrl, model, workerUrl, useWorkerProxy,
  }), [providers, selectedProviderId, apiKey, apiBaseUrl, model, workerUrl, useWorkerProxy])

  useEffect(() => {
    const fit = () => setPosition((current) => clampPosition(current.x, current.y))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => () => {
    abortRef.current?.abort()
    window.clearTimeout(reactionTimer.current)
  }, [])

  const reactTo = useCallback(async (action) => {
    if (loading) return
    setMenuOpen(false)
    setExpression(ACTIONS.find((item) => item.id === action)?.mark || '')
    setMotion(action)
    setReaction('…')
    setLoading(true)
    window.setTimeout(() => setMotion(''), 650)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 24000)
    try {
      const text = await getDesktopPetReaction({ action, session: selectedSession, globals, signal: controller.signal })
      setReaction(text)
    } catch (error) {
      setReaction(error?.name === 'AbortError' ? '反应太慢了' : '没连上')
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
      window.clearTimeout(reactionTimer.current)
      reactionTimer.current = window.setTimeout(() => {
        setReaction('')
        setExpression('')
      }, 6500)
    }
  }, [globals, loading, selectedSession])

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    }
  }

  const onPointerMove = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (Math.hypot(dx, dy) > 6) drag.current.moved = true
    if (drag.current.moved) {
      setMenuOpen(false)
      setMotion('lift')
      const next = clampPosition(drag.current.originX + dx, drag.current.originY + dy)
      drag.current.latest = next
      setPosition(next)
    }
  }

  const onPointerUp = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const wasMoved = drag.current.moved
    const finalPosition = drag.current.latest || position
    drag.current = null
    setMotion('')
    if (wasMoved) {
      updateDesktopPet({ x: finalPosition.x, y: finalPosition.y })
      // 拖着调整两三次位置不该每次都扣一次模型额度；八秒内只让它反应一次。
      if (Date.now() - lastLiftReaction.current > 8000) {
        lastLiftReaction.current = Date.now()
        reactTo('lift')
      }
    } else {
      setMenuOpen((open) => !open)
    }
  }

  const panelLeft = Math.max(10, Math.min(position.x - 85, window.innerWidth - 290))
  const actionsLeft = Math.max(8, Math.min(position.x - 115, window.innerWidth - 330))
  const identity = selectedSession?.aiName || selectedSession?.name || '未绑定'
  const modelName = selectedSession?.model || (selectedSession?.providerName?.includes('-vps') ? selectedSession.providerName.replace('-vps', '') : model) || '默认模型'

  return (
    <>
      <style>{`
        @keyframes pet-bob { 0%,100%{transform:translateY(0) scale(1)} 45%{transform:translateY(-8px) scale(1.03)} }
        @keyframes pet-squash { 0%,100%{transform:scale(1)} 35%{transform:scale(.88,1.08)} 70%{transform:scale(1.06,.94)} }
        @keyframes pet-bonk { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-10deg)} 45%{transform:rotate(11deg)} 70%{transform:rotate(-6deg)} }
        @keyframes pet-lift { 0%,100%{transform:rotate(0)} 35%{transform:rotate(-5deg)} 70%{transform:rotate(5deg)} }
        .desktop-pet.pet{animation:pet-bob .62s ease}.desktop-pet.pinch{animation:pet-squash .58s ease}
        .desktop-pet.bonk{animation:pet-bonk .52s ease}.desktop-pet.lift{animation:pet-lift .55s ease-in-out infinite}
      `}</style>

      {menuOpen && (
        <div
          className="fixed flex items-center gap-1.5 p-1.5 rounded-2xl"
          style={{ left: actionsLeft, top: Math.max(64, position.y - 52), zIndex: 121, background: 'rgba(255,255,255,.9)', boxShadow: '0 5px 22px rgba(54,35,48,.18)', backdropFilter: 'blur(12px)' }}
        >
          {ACTIONS.map((action) => (
            <button key={action.id} onClick={() => reactTo(action.id)} disabled={loading} className="px-2.5 py-2 rounded-xl text-xs whitespace-nowrap" style={{ color: theme.text, background: theme.primary + '15' }}>
              {action.label}
            </button>
          ))}
          <button onClick={() => { setSettingsOpen(true); setMenuOpen(false) }} className="w-8 h-8 grid place-items-center rounded-xl" style={{ color: theme.primary }} aria-label="桌宠设置"><Settings size={15} /></button>
        </div>
      )}

      {reaction && (
        <div
          className="fixed px-3 py-2 rounded-2xl text-sm font-medium whitespace-nowrap"
          style={{ left: Math.max(8, Math.min(position.x - 20, window.innerWidth - 150)), top: Math.max(54, position.y - 42), zIndex: 122, color: theme.text, background: 'rgba(255,255,255,.92)', boxShadow: '0 5px 20px rgba(54,35,48,.16)', backdropFilter: 'blur(10px)' }}
        >
          {reaction}
        </div>
      )}

      <div
        className={`desktop-pet ${motion}`}
        style={{ position: 'fixed', left: position.x, top: position.y, width: PET_W, height: PET_H, zIndex: 120, touchAction: 'none', cursor: drag.current?.moved ? 'grabbing' : 'grab', transformOrigin: '50% 25%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setMotion('') }}
        title="按住拖动，轻点互动"
      >
        {expression && <span className="absolute right-0 top-2 w-7 h-7 grid place-items-center rounded-full text-sm font-bold" style={{ zIndex: 2, color: theme.primary, background: 'rgba(255,255,255,.9)', boxShadow: '0 3px 10px rgba(0,0,0,.12)' }}>{expression}</span>}
        <img src="/pets/black-haired-pet.png" alt="黑发桌宠" draggable="false" style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale})`, transformOrigin: 'bottom center', filter: 'drop-shadow(0 5px 5px rgba(35,25,31,.22))', userSelect: 'none', WebkitUserDrag: 'none' }} />
      </div>

      {settingsOpen && (
        <div className="fixed rounded-3xl p-4" style={{ left: panelLeft, top: Math.max(70, Math.min(position.y - 80, window.innerHeight - 270)), width: 280, zIndex: 123, color: theme.text, background: 'rgba(255,255,255,.96)', boxShadow: '0 12px 40px rgba(43,29,38,.24)', backdropFilter: 'blur(18px)' }}>
          <div className="flex items-center justify-between mb-3">
            <div><div className="font-semibold">桌宠绑定</div><div className="text-[11px] opacity-55 mt-0.5">反应会读取所选私聊的人设与记忆</div></div>
            <button onClick={() => setSettingsOpen(false)} className="w-8 h-8 grid place-items-center rounded-full" style={{ background: theme.primary + '12' }}><X size={16} /></button>
          </div>
          <label className="text-xs opacity-65">它是谁</label>
          <select
            value={selectedSession?.id || ''}
            onChange={(event) => updateDesktopPet({ sessionId: event.target.value })}
            className="mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
            style={{ background: theme.primary + '12', color: theme.text }}
          >
            {(sessions || []).map((session) => <option key={session.id} value={session.id}>{session.aiName || session.name} · {session.model || session.providerName || '默认模型'}</option>)}
          </select>
          <div className="mt-3 p-2.5 rounded-xl text-xs leading-5" style={{ background: theme.primary + '0d' }}>
            <b>{identity}</b> · {modelName}<br />拖动就是拎起，轻点可摸、捏、锤。
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs opacity-65">大小</span>
            <div className="flex gap-1">
              {[.82, 1, 1.16].map((value, index) => <button key={value} onClick={() => updateDesktopPet({ scale: value })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: scale === value ? theme.primary : theme.primary + '12', color: scale === value ? 'white' : theme.text }}>{['小', '中', '大'][index]}</button>)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
