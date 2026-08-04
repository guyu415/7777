import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings, X, MessageCircle, Undo2, Upload } from 'lucide-react'
import { useStore } from '../store'
import {
  PET_ACTIONS, findAction, moodTier, effectiveMood,
  getDesktopPetReaction, getDesktopPetTextReply, recordDodgeLocally,
} from '../services/desktopPet'
import { compressImage } from '../utils/image'

const PET_W = 88
const PET_H = 136
const LONG_PRESS_MS = 550
const DEFAULT_PET_IMAGE = '/pets/black-haired-pet.png'

function clampPosition(x, y) {
  const shellWidth = Math.min(window.innerWidth, 448)
  const shellLeft = Math.max(0, (window.innerWidth - shellWidth) / 2)
  return {
    x: Math.max(shellLeft + 4, Math.min(x, shellLeft + shellWidth - PET_W - 4)),
    y: Math.max(56, Math.min(y, window.innerHeight - PET_H - 28)),
  }
}

// v1 场景感知：只在用户显式打开开关时，顺带带一句"当前在哪个视图 / 当前
// 聊天窗口最后一条消息"的粗粒度提示，不读取其它任何会话。默认关闭。更细的
// 信号（比如五子棋刚输了、群聊里被谁怼了）需要分别接到那几个游戏自己的状
// 态里，这里先不做，留到下一步。
function buildSceneHint(allowed, currentView, messages) {
  if (!allowed) return ''
  if (currentView === 'groupChat') return '用户现在开着一个群聊窗口。'
  if (currentView === 'chat') {
    const last = (messages || [])[messages.length - 1]
    if (last?.type === 'text' && last.content) {
      return `当前私聊窗口最后一条消息（${last.role === 'user' ? '用户自己发的' : '对方发的'}）：${last.content.slice(0, 60)}`
    }
  }
  return ''
}

export default function DesktopPet({ theme }) {
  const {
    sessions, currentSessionId, currentView, messages,
    desktopPet, updateDesktopPet, setCurrentSessionId, setCurrentView,
  } = useStore()

  const [position, setPosition] = useState(() => clampPosition(
    Number.isFinite(desktopPet?.x) ? desktopPet.x : window.innerWidth - 102,
    Number.isFinite(desktopPet?.y) ? desktopPet.y : window.innerHeight - 300,
  ))
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatText, setChatText] = useState('')
  const [reaction, setReaction] = useState('')
  const [expression, setExpression] = useState('')
  const [motion, setMotion] = useState('')
  const [loading, setLoading] = useState(false)
  const drag = useRef(null)
  const abortRef = useRef(null)
  const reactionTimer = useRef(null)
  const pressTimer = useRef(null)
  const longPressFired = useRef(false)
  const lastLiftReaction = useRef(0)
  const lastBonkAt = useRef(0)
  const fileInputRef = useRef(null)
  const chatInputRef = useRef(null)

  const selectedSession = useMemo(
    () => sessions?.find((s) => s.id === desktopPet?.sessionId) || null,
    [sessions, desktopPet?.sessionId],
  )
  const scale = desktopPet?.scale || 1
  const tier = moodTier(desktopPet)
  const mood = effectiveMood(desktopPet)

  // 绑定的会话被删了（或者数据还没恢复完），别把桌宠挂在一个不存在的会话上。
  useEffect(() => {
    if (desktopPet?.active && desktopPet.sessionId && sessions && !selectedSession) {
      updateDesktopPet({ active: false })
    }
  }, [desktopPet?.active, desktopPet?.sessionId, sessions, selectedSession, updateDesktopPet])

  useEffect(() => {
    const fit = () => setPosition((current) => clampPosition(current.x, current.y))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => () => {
    abortRef.current?.abort()
    window.clearTimeout(reactionTimer.current)
    window.clearTimeout(pressTimer.current)
  }, [])

  // 心情到"黏人"档时，切到别的 App/标签页会扒着屏幕边缘不肯走——回来后
  // 它还停在那，得自己把它拖回来。只在真正切走（page hidden）时触发一次。
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return
      if (!desktopPet?.active || moodTier(useStore.getState().desktopPet) !== 'clingy') return
      setPosition((current) => {
        const shellWidth = Math.min(window.innerWidth, 448)
        const shellLeft = Math.max(0, (window.innerWidth - shellWidth) / 2)
        const mid = shellLeft + shellWidth / 2
        const clungX = current.x < mid ? shellLeft - PET_W * 0.55 : shellLeft + shellWidth - PET_W * 0.45
        const next = { x: clungX, y: current.y }
        updateDesktopPet({ x: next.x, y: next.y })
        return next
      })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [desktopPet?.active, updateDesktopPet])

  const scheduleReactionClear = useCallback(() => {
    window.clearTimeout(reactionTimer.current)
    reactionTimer.current = window.setTimeout(() => {
      setReaction('')
      setExpression('')
    }, 6500)
  }, [])

  const sceneHint = useCallback(
    () => buildSceneHint(!!desktopPet?.allowSceneAwareness, currentView, messages),
    [desktopPet?.allowSceneAwareness, currentView, messages],
  )

  const reactTo = useCallback(async (actionId) => {
    if (loading || !selectedSession) return
    setMenuOpen(false)
    const actionDef = findAction(actionId)
    // 本地动画先立刻播，模型的反应字后补——摸一下不用僵着等它转圈。
    setExpression(actionDef.mark)
    setMotion(actionDef.motion)
    window.setTimeout(() => setMotion(''), 650)

    const now = Date.now()
    if (actionId === 'bonk') {
      if (tier === 'furious' && now - lastBonkAt.current < 4000) {
        // 已经很烦了，短时间内还在锤——直接躲开，不再花一次模型调用。
        lastBonkAt.current = now
        const line = await recordDodgeLocally(selectedSession, actionId)
        setReaction(line)
        scheduleReactionClear()
        return
      }
      lastBonkAt.current = now
    }

    setReaction('…')
    setLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 24000)
    try {
      const text = await getDesktopPetReaction({ action: actionId, session: selectedSession, signal: controller.signal, sceneHint: sceneHint() })
      setReaction(text)
    } catch (error) {
      setReaction(error?.name === 'AbortError' ? '反应太慢了' : '没连上')
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
      scheduleReactionClear()
    }
  }, [loading, selectedSession, tier, sceneHint, scheduleReactionClear])

  const carryBack = useCallback(() => {
    if (!selectedSession) return
    setMenuOpen(false); setSettingsOpen(false); setChatOpen(false)
    updateDesktopPet({ active: false })
    setCurrentSessionId(selectedSession.id)
    setCurrentView('chat')
  }, [selectedSession, updateDesktopPet, setCurrentSessionId, setCurrentView])

  const sendChat = useCallback(async () => {
    const text = chatText.trim()
    if (!text || loading || !selectedSession) return
    setChatText('')
    // 发送后立刻收起输入框，不常驻挡屏幕；回复照样走下面那个会自动淡出的气泡。
    setChatOpen(false)
    setMenuOpen(false)
    setMotion('pet')
    window.setTimeout(() => setMotion(''), 650)
    setReaction('…')
    setLoading(true)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const timeout = window.setTimeout(() => controller.abort(), 24000)
    try {
      const reply = await getDesktopPetTextReply({ text, session: selectedSession, signal: controller.signal, sceneHint: sceneHint() })
      setReaction(reply)
    } catch (error) {
      setReaction(error?.name === 'AbortError' ? '反应太慢了' : '没连上')
    } finally {
      window.clearTimeout(timeout)
      setLoading(false)
      scheduleReactionClear()
    }
  }, [chatText, loading, selectedSession, sceneHint, scheduleReactionClear])

  const onPointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    longPressFired.current = false
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: position.x,
      originY: position.y,
      moved: false,
    }
    window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => {
      if (drag.current && !drag.current.moved) {
        longPressFired.current = true
        navigator.vibrate?.(20)
        carryBack()
      }
    }, LONG_PRESS_MS)
  }

  const onPointerMove = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (Math.hypot(dx, dy) > 6) {
      drag.current.moved = true
      window.clearTimeout(pressTimer.current)
    }
    if (drag.current.moved) {
      setMenuOpen(false)
      setMotion('lift')
      const next = clampPosition(drag.current.originX + dx, drag.current.originY + dy)
      drag.current.latest = next
      setPosition(next)
    }
  }

  const onPointerUp = (event) => {
    window.clearTimeout(pressTimer.current)
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const wasMoved = drag.current.moved
    const wasLongPress = longPressFired.current
    const finalPosition = drag.current.latest || position
    drag.current = null
    setMotion('')
    if (wasLongPress) return // 已经在 carryBack 里处理过了
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

  const handleUploadImage = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const { dataUrl } = await compressImage(file, { maxDim: 420, quality: 0.85, keepGif: false })
      updateDesktopPet({ petImage: dataUrl })
    } catch {
      // 压缩/解码失败就静默放弃，形象保持原样
    }
  }

  if (!desktopPet?.active || !selectedSession) return null

  const MOOD_TIER_LABEL = {
    furious: '有点想躲你', annoyed: '有点不耐烦', clingy: '正黏人', warm: '心情不错', neutral: '平常',
  }
  const panelLeft = Math.max(10, Math.min(position.x - 85, window.innerWidth - 290))
  const actionsLeft = Math.max(8, Math.min(position.x - 130, window.innerWidth - 350))
  const identity = selectedSession.aiName || selectedSession.name || '桌宠'
  const modelName = selectedSession.model || (selectedSession.providerName?.includes('-vps') ? selectedSession.providerName.replace('-vps', '') : '') || '默认模型'
  const petImage = desktopPet.petImage || DEFAULT_PET_IMAGE
  const isClinging = position.x < 4 || position.x > window.innerWidth - PET_W - 4

  return (
    <>
      <style>{`
        @keyframes pet-bob { 0%,100%{transform:translateY(0) scale(1)} 45%{transform:translateY(-8px) scale(1.03)} }
        @keyframes pet-squash { 0%,100%{transform:scale(1)} 35%{transform:scale(.88,1.08)} 70%{transform:scale(1.06,.94)} }
        @keyframes pet-poke { 0%,100%{transform:translateX(0) rotate(0)} 30%{transform:translateX(-4px) rotate(-4deg)} 60%{transform:translateX(3px) rotate(3deg)} }
        @keyframes pet-bonk { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-10deg)} 45%{transform:rotate(11deg)} 70%{transform:rotate(-6deg)} }
        @keyframes pet-lift { 0%,100%{transform:rotate(0)} 35%{transform:rotate(-5deg)} 70%{transform:rotate(5deg)} }
        @keyframes pet-cling { 0%,100%{transform:rotate(0) translateY(0)} 50%{transform:rotate(-3deg) translateY(-2px)} }
        .desktop-pet.pet{animation:pet-bob .62s ease}.desktop-pet.pinch{animation:pet-squash .58s ease}
        .desktop-pet.poke{animation:pet-poke .5s ease}
        .desktop-pet.bonk{animation:pet-bonk .52s ease}.desktop-pet.lift{animation:pet-lift .55s ease-in-out infinite}
        .desktop-pet.clinging-idle{animation:pet-cling 2.4s ease-in-out infinite}
      `}</style>

      {menuOpen && (
        <div
          className="fixed flex items-center gap-1.5 p-1.5 rounded-2xl flex-wrap"
          style={{ left: actionsLeft, top: Math.max(64, position.y - 52), maxWidth: 300, zIndex: 121, background: 'rgba(255,255,255,.9)', boxShadow: '0 5px 22px rgba(54,35,48,.18)', backdropFilter: 'blur(12px)' }}
        >
          {PET_ACTIONS.map((action) => (
            <button key={action.id} onClick={() => reactTo(action.id)} disabled={loading} className="px-2.5 py-2 rounded-xl text-xs whitespace-nowrap" style={{ color: theme.text, background: theme.primary + '15' }}>
              {action.label}
            </button>
          ))}
          <button onClick={() => { setChatOpen(true); setMenuOpen(false); window.setTimeout(() => chatInputRef.current?.focus(), 30) }} className="w-8 h-8 grid place-items-center rounded-xl" style={{ color: theme.primary }} aria-label="跟它说两句"><MessageCircle size={15} /></button>
          <button onClick={carryBack} className="w-8 h-8 grid place-items-center rounded-xl" style={{ color: theme.primary }} aria-label="抱回原会话"><Undo2 size={15} /></button>
          <button onClick={() => { setSettingsOpen(true); setMenuOpen(false) }} className="w-8 h-8 grid place-items-center rounded-xl" style={{ color: theme.primary }} aria-label="桌宠设置"><Settings size={15} /></button>
        </div>
      )}

      {chatOpen && (
        <div
          className="fixed flex items-center gap-1.5 p-1.5 rounded-2xl"
          style={{ left: actionsLeft, top: Math.max(64, position.y - 52), width: 260, zIndex: 121, background: 'rgba(255,255,255,.94)', boxShadow: '0 5px 22px rgba(54,35,48,.18)', backdropFilter: 'blur(12px)' }}
        >
          <input
            ref={chatInputRef}
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); if (e.key === 'Escape') setChatOpen(false) }}
            placeholder="跟它说两句…"
            className="flex-1 min-w-0 rounded-xl px-3 py-2 text-sm outline-none"
            style={{ background: theme.primary + '12', color: theme.text }}
          />
          <button onClick={sendChat} disabled={!chatText.trim() || loading} className="px-3 py-2 rounded-xl text-xs flex-shrink-0" style={{ background: theme.primary, color: 'white', opacity: (!chatText.trim() || loading) ? 0.5 : 1 }}>发送</button>
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
        className={`desktop-pet ${motion} ${!motion && isClinging && tier === 'clingy' ? 'clinging-idle' : ''}`}
        style={{ position: 'fixed', left: position.x, top: position.y, width: PET_W, height: PET_H, zIndex: 120, touchAction: 'none', cursor: drag.current?.moved ? 'grabbing' : 'grab', transformOrigin: '50% 25%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setMotion(''); window.clearTimeout(pressTimer.current) }}
        title="轻点互动，按住拖动，长按抱回原会话"
      >
        {expression && <span className="absolute right-0 top-2 w-7 h-7 grid place-items-center rounded-full text-sm font-bold" style={{ zIndex: 2, color: theme.primary, background: 'rgba(255,255,255,.9)', boxShadow: '0 3px 10px rgba(0,0,0,.12)' }}>{expression}</span>}
        <img src={petImage} alt={identity} draggable="false" style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale})`, transformOrigin: 'bottom center', filter: 'drop-shadow(0 5px 5px rgba(35,25,31,.22))', userSelect: 'none', WebkitUserDrag: 'none' }} />
      </div>

      {settingsOpen && (
        <div className="fixed rounded-3xl p-4" style={{ left: panelLeft, top: Math.max(70, Math.min(position.y - 80, window.innerHeight - 340)), width: 280, maxHeight: '70vh', overflowY: 'auto', zIndex: 123, color: theme.text, background: 'rgba(255,255,255,.96)', boxShadow: '0 12px 40px rgba(43,29,38,.24)', backdropFilter: 'blur(18px)' }}>
          <div className="flex items-center justify-between mb-3">
            <div><div className="font-semibold">桌宠设置</div><div className="text-[11px] opacity-55 mt-0.5">它就是「{identity}」本体，不是分身</div></div>
            <button onClick={() => setSettingsOpen(false)} className="w-8 h-8 grid place-items-center rounded-full" style={{ background: theme.primary + '12' }}><X size={16} /></button>
          </div>

          <div className="p-2.5 rounded-xl text-xs leading-5" style={{ background: theme.primary + '0d' }}>
            <b>{identity}</b> · {modelName}<br />
            轻点互动，拖动移动，长按可以把它抱回「{identity}」的正式聊天窗口。
          </div>

          <div className="mt-3">
            <span className="text-xs opacity-65">桌宠形象</span>
            <div className="flex gap-2 mt-1.5">
              <button onClick={() => updateDesktopPet({ petImage: DEFAULT_PET_IMAGE })} className="w-11 h-11 rounded-xl overflow-hidden" style={{ border: petImage === DEFAULT_PET_IMAGE ? `2px solid ${theme.primary}` : '2px solid transparent', background: theme.primary + '12' }}>
                <img src={DEFAULT_PET_IMAGE} alt="默认形象" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
              {selectedSession.aiAvatar && (
                <button onClick={() => updateDesktopPet({ petImage: selectedSession.aiAvatar })} className="w-11 h-11 rounded-xl overflow-hidden" style={{ border: petImage === selectedSession.aiAvatar ? `2px solid ${theme.primary}` : '2px solid transparent', background: theme.primary + '12' }}>
                  <img src={selectedSession.aiAvatar} alt="它的头像" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()} className="w-11 h-11 rounded-xl grid place-items-center flex-shrink-0" style={{ background: theme.primary + '12', color: theme.primary }} aria-label="上传形象">
                <Upload size={16} />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleUploadImage} />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div><span className="text-xs opacity-65">让它看看当前屏幕</span><div className="text-[10px] opacity-45 mt-0.5">只给它当前窗口的粗略信息，不会读其它会话</div></div>
            <button
              onClick={() => updateDesktopPet({ allowSceneAwareness: !desktopPet.allowSceneAwareness })}
              className="px-3 py-1.5 rounded-lg text-xs flex-shrink-0"
              style={{ background: desktopPet.allowSceneAwareness ? theme.primary : theme.primary + '12', color: desktopPet.allowSceneAwareness ? 'white' : theme.text }}
            >
              {desktopPet.allowSceneAwareness ? '已允许' : '已关闭'}
            </button>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs opacity-65">大小</span>
            <div className="flex gap-1">
              {[.82, 1, 1.16].map((value, index) => <button key={value} onClick={() => updateDesktopPet({ scale: value })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: scale === value ? theme.primary : theme.primary + '12', color: scale === value ? 'white' : theme.text }}>{['小', '中', '大'][index]}</button>)}
            </div>
          </div>

          <div className="mt-3 text-[10px] opacity-45 leading-4">
            心情：好感 {mood.affection}/8 · 烦躁 {mood.annoyance}/8（{MOOD_TIER_LABEL[tier]}）
          </div>

          <button onClick={carryBack} className="mt-3 w-full py-2.5 rounded-xl text-sm font-medium" style={{ background: theme.primary + '15', color: theme.primary }}>
            放回「{identity}」身边继续正式聊天
          </button>
        </div>
      )}
    </>
  )
}
