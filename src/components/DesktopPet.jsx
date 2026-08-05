import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings, X, MessageCircle, Undo2, Upload, MoreHorizontal } from 'lucide-react'
import { useStore, getBlob } from '../store'
import { useChat } from '../hooks/useChat'
import { useCodexChat } from '../hooks/useCodexChat'
import {
  findGesture, emptyGestureCounts, totalGestureCount,
  buildGestureReport, describeGestureCounts, playGestureSfx, playLightTapSfx,
} from '../services/desktopPet'
import { compressImage } from '../utils/image'
import { fetchTTSAudio } from '../services/tts'

const PET_W = 88
const PET_H = 136
const LONG_PRESS_MS = 500
const RAPID_TAP_MS = 420
const RAPID_TAP_BURST = 3 // 快速连点攒够几下才算一次"锤"
const PINCH_CLOSE_PX = 18
const DEFAULT_PET_IMAGE = '/pets/black-haired-pet.png'
const SWING_DEADZONE_PX = 4 // 判定方向反转前的抖动容差
const SWING_MIN_AMPLITUDE_PX = 24 // 单次摆幅至少要达到这个距离才算数
const SWING_MIN_SPEED_PX_MS = 0.15 // 单次摆动的最低速度（px/ms），挡住"缓慢挪动时顺手回摆一下"

function clampPosition(x, y) {
  const shellWidth = Math.min(window.innerWidth, 448)
  const shellLeft = Math.max(0, (window.innerWidth - shellWidth) / 2)
  return {
    x: Math.max(shellLeft + 4, Math.min(x, shellLeft + shellWidth - PET_W - 4)),
    y: Math.max(56, Math.min(y, window.innerHeight - PET_H - 28)),
  }
}

// 桌宠本质上就是当前会话的一个缩小版聊天窗——只在真正被打开（active）时
// 才挂载下面这个会调用 useChat()/useCodexChat() 的组件，避免桌宠收起来时
// 也常驻订阅一条 companion WebSocket。
export default function DesktopPet({ theme }) {
  const active = useStore((s) => s.desktopPet.active)
  if (!active) return null
  return <DesktopPetWindow theme={theme} />
}

function DesktopPetWindow({ theme }) {
  const { sessions, currentSessionId, desktopPet, updateDesktopPet, setCurrentView } = useStore()
  const cc = useChat()
  const codex = useCodexChat()

  const currentSession = useMemo(
    () => sessions?.find((s) => s.id === currentSessionId),
    [sessions, currentSessionId],
  )
  const isCodexSession = currentSession?.providerName === 'codex-vps'
  const chat = isCodexSession ? codex : cc
  const { sendMessage, isLoading, loadHistory, messages } = chat

  // 桌宠打字/手势汇总走的是和主聊天窗一样的 sendMessage()——真实链路自己
  // 负责把消息读进/写进这同一条会话的历史；这里只需要保证历史已经加载。
  useEffect(() => { loadHistory() }, [currentSessionId, loadHistory])

  const [position, setPosition] = useState(() => clampPosition(
    Number.isFinite(desktopPet?.x) ? desktopPet.x : window.innerWidth - 102,
    Number.isFinite(desktopPet?.y) ? desktopPet.y : window.innerHeight - 300,
  ))
  const [gestureFlash, setGestureFlash] = useState('')
  const [motion, setMotion] = useState('')
  const [toolbarOpen, setToolbarOpen] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatText, setChatText] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  const [replyBubble, setReplyBubble] = useState('')
  const [pendingCount, setPendingCount] = useState(0)

  const drag = useRef(null)
  const pressTimer = useRef(null)
  const longPressFired = useRef(false)
  const touchPinch = useRef(null) // { startDist, fired }
  const isPinchingRef = useRef(false)
  const lastTapAt = useRef(0)
  const rapidStreak = useRef(0)
  const gestureCounts = useRef(emptyGestureCounts())
  const flashTimer = useRef(null)
  const replyTimer = useRef(null)
  const chatInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const mountedAt = useRef(Date.now())
  const lastShownReplyId = useRef(null)
  // 主聊天窗口跟桌宠共用同一个 useChat 会话/messages 数组——只有靠这个标记
  // 才能分清"新回复是桌宠自己发的话引出来的"还是"用户在主对话框里聊天顺带
  // 冒出来的"，桌宠语音只该在前一种情况下响，见 sendChat 和下面的回复气泡
  // effect。
  const petTriggeredRef = useRef(false)

  const batchSize = desktopPet.batchSize || 5
  const scale = desktopPet.scale || 1
  const petImage = desktopPet.petImage || DEFAULT_PET_IMAGE
  const identity = currentSession?.aiName || currentSession?.name || 'AI'
  const sfxOn = !!desktopPet.sfxEnabled
  const voiceReply = desktopPet.replyMode === 'voice'

  useEffect(() => {
    const fit = () => setPosition((current) => clampPosition(current.x, current.y))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  useEffect(() => () => {
    window.clearTimeout(pressTimer.current)
    window.clearTimeout(flashTimer.current)
    window.clearTimeout(replyTimer.current)
  }, [])

  const playExistingVoice = useCallback(async (blobId) => {
    try {
      const blob = await getBlob(blobId)
      if (!blob) return
      const audio = new Audio(URL.createObjectURL(blob))
      audio.play().catch(() => {})
    } catch {
      // 播放失败就算了，气泡兜底会转成文字
    }
  }, [])

  // 复用会话自己已经配置好的 TTS 凭据——和主聊天窗的语音合成走同一个
  // fetchTTSAudio 调用，只是这里是桌宠自己独立触发的一次合成播放，不经过
  // useChat 内部那套"按频率概率决定要不要发语音"的逻辑，也不影响会话本身
  // 的 aiVoiceEnabled/voiceFrequency 设置。
  const synthesizeAndPlay = useCallback(async (text) => {
    const s = useStore.getState()
    const ttsApiKey = currentSession?.ttsApiKey || s.ttsApiKey
    const ttsGroupId = currentSession?.ttsGroupId || s.ttsGroupId
    const ttsVoiceId = currentSession?.ttsVoiceId || s.ttsVoiceId
    const ttsModel = currentSession?.ttsModel || 'speech-2.6-hd'
    if (!ttsApiKey || !ttsGroupId) return false
    try {
      const blob = await fetchTTSAudio(text, { apiKey: ttsApiKey, groupId: ttsGroupId, voiceId: ttsVoiceId || 'English_Trustworthy_Man', model: ttsModel })
      const audio = new Audio(URL.createObjectURL(blob))
      audio.play().catch(() => {})
      return true
    } catch (e) {
      console.warn('[PET] 语音合成失败:', e?.message)
      return false
    }
  }, [currentSession])

  // 只展示"桌宠开着之后新产生"的回复——已加载的历史最后一条不算，避免
  // 一打开桌宠就把某条旧消息当成刚发生的反应弹出来。回复方式选语音时走
  // TTS 播放（气泡只显示一个🔊），选文字（默认）就照常显示气泡文字。
  useEffect(() => {
    const last = messages?.[messages.length - 1]
    if (!last || last.role !== 'assistant' || last.streaming) return
    if ((last.timestamp || 0) < mountedAt.current) return
    if (last.id === lastShownReplyId.current) return
    lastShownReplyId.current = last.id

    const isVoiceMsg = last.type === 'voice'
    const plainText = (isVoiceMsg ? (last.voiceText || '') : (last.content || '')).replace(/<i>[\s\S]*?<\/i>/g, '').trim()

    const showBubble = (text, fadeMs) => {
      setReplyBubble(text)
      window.clearTimeout(replyTimer.current)
      replyTimer.current = window.setTimeout(() => setReplyBubble(''), fadeMs)
    }

    // 消费一次就复位，不管这条回复最终是不是真的走了语音——下一条回复
    // 默认又是"不是桌宠触发的"，除非 sendChat 再次置位。
    const isPetTriggered = petTriggeredRef.current
    petTriggeredRef.current = false

    if (voiceReply && isPetTriggered) {
      if (isVoiceMsg && last.voiceBlobId) {
        playExistingVoice(last.voiceBlobId)
        showBubble('🔊', 4000)
        return
      }
      if (plainText) {
        synthesizeAndPlay(plainText).then((ok) => {
          showBubble(ok ? '🔊' : (plainText.length > 60 ? `${plainText.slice(0, 60)}…` : plainText), ok ? 4000 : 7000)
        })
        return
      }
    }

    if (!plainText) return
    showBubble(plainText.length > 60 ? `${plainText.slice(0, 60)}…` : plainText, 7000)
  }, [messages, voiceReply, playExistingVoice, synthesizeAndPlay])

  // 手势本身立即播放本地动效 + 短音效 + 一闪而过的文字反馈（现场反馈），
  // 是否要真的问一次模型是另一件独立的事——见下面 reportGestures。
  const playLocalMotion = useCallback((gestureId) => {
    const g = findGesture(gestureId)
    setGestureFlash(g.feedback)
    window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setGestureFlash(''), 700)
    setMotion(g.motion)
    window.setTimeout(() => setMotion(''), 650)
    navigator.vibrate?.(gestureId === 'bonk' ? 14 : 8)
    playGestureSfx(gestureId, sfxOn)
  }, [sfxOn])

  const reportGestures = useCallback(async () => {
    const counts = gestureCounts.current
    const report = buildGestureReport(counts)
    gestureCounts.current = emptyGestureCounts()
    setPendingCount(0)
    if (!report) return
    try {
      await sendMessage(report, 'text')
    } catch (e) {
      console.warn('[PET] 手势汇总发送失败:', e?.message)
    }
  }, [sendMessage])

  // 单次手势只累加本地计数 + 播本地动效；攒够 batchSize 次才真的触发一次
  // 请求（带完整人设与上下文的真实链路），中间几次完全不联网。
  const triggerGesture = useCallback((gestureId) => {
    playLocalMotion(gestureId)
    gestureCounts.current[gestureId] = (gestureCounts.current[gestureId] || 0) + 1
    const total = totalGestureCount(gestureCounts.current)
    if (total >= batchSize) {
      reportGestures()
    } else {
      setPendingCount(total)
    }
  }, [playLocalMotion, batchSize, reportGestures])

  // 轻反馈——快速连点还没攒够 RAPID_TAP_BURST 阈值的那几下，给个更轻的
  // 提示（小抖动 + 更轻的"滴"声），不算一次正式手势、不计数、不出文字。
  const lightTapPulse = useCallback(() => {
    navigator.vibrate?.(4)
    playLightTapSfx(sfxOn)
    setMotion('light-pulse')
    window.setTimeout(() => setMotion(''), 160)
  }, [sfxOn])

  // 单次点击=摸；短时间内连续点击攒到第 RAPID_TAP_BURST 下才真正判定成
  // 一次"锤"——前面几下只给轻反馈，让人清楚感觉到自己点到第几下，而不是
  // 从第二下就突然变成锤。
  const handleTap = useCallback(() => {
    const now = Date.now()
    const rapid = now - lastTapAt.current < RAPID_TAP_MS
    lastTapAt.current = now
    if (!rapid) {
      rapidStreak.current = 1
      triggerGesture('pet')
      return
    }
    rapidStreak.current += 1
    if (rapidStreak.current >= RAPID_TAP_BURST) {
      rapidStreak.current = 0
      triggerGesture('bonk')
    } else {
      lightTapPulse()
    }
  }, [triggerGesture, lightTapPulse])

  const requestClose = useCallback(() => {
    setChatOpen(false); setSettingsOpen(false); setToolbarOpen(false)
    if (totalGestureCount(gestureCounts.current) > 0) {
      setLeaveConfirmOpen(true)
    } else {
      updateDesktopPet({ active: false })
      setCurrentView('chat')
    }
  }, [updateDesktopPet, setCurrentView])

  const closeNow = useCallback(() => {
    setLeaveConfirmOpen(false)
    updateDesktopPet({ active: false })
    setCurrentView('chat')
  }, [updateDesktopPet, setCurrentView])

  const confirmBringAlong = useCallback(async () => {
    await reportGestures()
    closeNow()
  }, [reportGestures, closeNow])

  const confirmDiscard = useCallback(() => {
    gestureCounts.current = emptyGestureCounts()
    setPendingCount(0)
    closeNow()
  }, [closeNow])

  const sendChat = useCallback(async () => {
    const text = chatText.trim()
    if (!text || isLoading) return
    setChatText('')
    // 发送后立刻收起输入框，不常驻挡屏幕；回复走上面那个"新回复"气泡。
    setChatOpen(false)
    petTriggeredRef.current = true
    try {
      await sendMessage(text, 'text')
    } catch (e) {
      console.warn('[PET] 发送失败:', e?.message)
    }
  }, [chatText, isLoading, sendMessage])

  // ── 手势识别：轻点=摸／快速连点=锤／长按或双指捏=捏脸／拖起后左右往复摆动=拎起来晃 ──

  const onPointerDown = (event) => {
    if (isPinchingRef.current) return
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
      // 摆动判定：swingDir 记录当前这一段的水平方向（0=还没定下来），
      // segStartX/segStartTime 是这一段的起点，extremumX 是目前为止在这个
      // 方向上走到的最远处——一旦从 extremumX 往回退超过死区，就认为方向
      // 反转了一次，检查这一段的摆幅和速度是否达标。
      swingDir: 0,
      segStartX: event.clientX,
      segStartTime: event.timeStamp,
      extremumX: event.clientX,
    }
    window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => {
      if (drag.current && !drag.current.moved) {
        longPressFired.current = true
        triggerGesture('pinch')
      }
    }, LONG_PRESS_MS)
  }

  // 单纯换个位置（哪怕挪得快）只会往一个方向走，swingDir 只会被设一次、
  // 永远不会触发下面的反转分支，所以不计数；只有拖起来之后真的左右来回
  // 摆，且每一次摆幅、速度都过阈值,才会记一次"拎起来晃"。垂直方向的移动
  // 完全不影响这里的判定。
  const detectSwing = useCallback((x, t) => {
    const d = drag.current
    if (!d) return
    if (d.swingDir === 0) {
      if (x - d.segStartX > SWING_DEADZONE_PX) { d.swingDir = 1; d.extremumX = x }
      else if (d.segStartX - x > SWING_DEADZONE_PX) { d.swingDir = -1; d.extremumX = x }
      return
    }
    if (d.swingDir === 1) {
      if (x > d.extremumX) { d.extremumX = x; return }
      if (d.extremumX - x <= SWING_DEADZONE_PX) return
      const amplitude = d.extremumX - d.segStartX
      const duration = Math.max(1, t - d.segStartTime)
      if (amplitude >= SWING_MIN_AMPLITUDE_PX && amplitude / duration >= SWING_MIN_SPEED_PX_MS) {
        triggerGesture('lift')
      }
      d.segStartX = d.extremumX
      d.segStartTime = t
      d.swingDir = -1
      d.extremumX = x
      return
    }
    // swingDir === -1
    if (x < d.extremumX) { d.extremumX = x; return }
    if (x - d.extremumX <= SWING_DEADZONE_PX) return
    const amplitude = d.segStartX - d.extremumX
    const duration = Math.max(1, t - d.segStartTime)
    if (amplitude >= SWING_MIN_AMPLITUDE_PX && amplitude / duration >= SWING_MIN_SPEED_PX_MS) {
      triggerGesture('lift')
    }
    d.segStartX = d.extremumX
    d.segStartTime = t
    d.swingDir = 1
    d.extremumX = x
  }, [triggerGesture])

  const onPointerMove = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (Math.hypot(dx, dy) > 6) {
      drag.current.moved = true
      window.clearTimeout(pressTimer.current)
    }
    if (drag.current.moved) {
      setMotion('lift')
      detectSwing(event.clientX, event.timeStamp)
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
    if (wasLongPress) return // 捏脸已经在长按计时器里触发过了
    if (wasMoved) {
      // 单纯挪位置不算互动，只落位；真正的"拎起来晃"手势已经在拖动过程中
      // 由 detectSwing 实时判定并触发了，这里不再重复计一次。
      updateDesktopPet({ x: finalPosition.x, y: finalPosition.y })
    } else {
      handleTap()
    }
  }

  // 双指捏合——原生 touch 事件，和上面的指针手势并行；一旦检测到第二根手
  // 指落下就接管，取消可能已经在跑的单指长按/拖动判定，避免重复触发。
  const onTouchStart = (event) => {
    if (event.touches.length === 2) {
      window.clearTimeout(pressTimer.current)
      drag.current = null
      isPinchingRef.current = true
      const [a, b] = event.touches
      touchPinch.current = {
        startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
        fired: false,
      }
    }
  }

  const onTouchMove = (event) => {
    if (event.touches.length === 2 && touchPinch.current && !touchPinch.current.fired) {
      const [a, b] = event.touches
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
      if (touchPinch.current.startDist - dist > PINCH_CLOSE_PX) {
        touchPinch.current.fired = true
        triggerGesture('pinch')
      }
    }
  }

  const onTouchEnd = (event) => {
    if (event.touches.length < 2) {
      touchPinch.current = null
      // 手指陆续抬起时还会补一拍单指 pointer 事件，短暂延迟后再放行，
      // 避免那一拍被误判成一次点击/拖动。
      window.setTimeout(() => { isPinchingRef.current = false }, 250)
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

  const panelLeft = Math.max(10, Math.min(position.x - 85, window.innerWidth - 290))
  const gestureSummaryPlain = describeGestureCounts(gestureCounts.current)

  // 菜单入口合并进右上角角标——不再有常驻的底部工具条。角标本身始终可点：
  // 有待汇报手势时显示数字，没有时显示一个小“更多”图标；点一下在角标旁
  // 展开菜单（说两句/设置/返回），再点一下收起。
  const badgeSize = 20
  const badgeLeft = position.x + PET_W * 0.66
  const badgeTop = position.y + PET_H * 0.08
  const menuWidth = 118
  const menuLeft = Math.max(8, Math.min(badgeLeft + badgeSize - menuWidth, window.innerWidth - menuWidth - 8))
  const menuTop = badgeTop + badgeSize + 6

  // 回复气泡（"…"/单字反应/语音🔊/长回复摘录都走这一个气泡）——横向以桌宠
  // 中线为基准居中，不再是原来那种以桌宠左侧为锚点、盒子整体往右怼的算法
  // （短反应字符一少，视觉上就飘到离人物很远的地方去了）。
  const bubbleWidth = 210
  const bubbleLeft = Math.max(8, Math.min(position.x + PET_W / 2 - bubbleWidth / 2, window.innerWidth - bubbleWidth - 8))
  const bubbleTop = Math.max(8, position.y - 54)

  return (
    <>
      <style>{`
        @keyframes pet-bob { 0%,100%{transform:translateY(0) scale(1)} 45%{transform:translateY(-8px) scale(1.03)} }
        @keyframes pet-squash { 0%,100%{transform:scale(1)} 35%{transform:scale(.88,1.08)} 70%{transform:scale(1.06,.94)} }
        @keyframes pet-bonk { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-10deg)} 45%{transform:rotate(11deg)} 70%{transform:rotate(-6deg)} }
        @keyframes pet-lift { 0%,100%{transform:rotate(0)} 35%{transform:rotate(-5deg)} 70%{transform:rotate(5deg)} }
        @keyframes pet-light-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.035)} }
        @keyframes pet-flash { 0%{opacity:0; transform:translate(-50%,4px)} 15%{opacity:1; transform:translate(-50%,0)} 75%{opacity:1} 100%{opacity:0; transform:translate(-50%,-6px)} }
        .desktop-pet.pet{animation:pet-bob .62s ease}.desktop-pet.pinch{animation:pet-squash .58s ease}
        .desktop-pet.bonk{animation:pet-bonk .52s ease}.desktop-pet.lift{animation:pet-lift .55s ease-in-out infinite}
        .desktop-pet.light-pulse{animation:pet-light-pulse .16s ease}
        .pet-flash-text{animation:pet-flash .7s ease forwards}
      `}</style>

      {/* 手势计数角标——紧贴桌宠肩侧、跟随桌宠位置移动，同时也是菜单入口：
          有待汇报手势时显示数字，没有时显示“更多”图标，点一下展开/收起菜单 */}
      <button
        onClick={() => setToolbarOpen((v) => !v)}
        className="fixed grid place-items-center rounded-full"
        style={{
          left: badgeLeft, top: badgeTop,
          width: badgeSize, height: badgeSize, zIndex: 125, border: 'none', padding: 0,
          background: theme.primary, color: 'white', fontSize: 10, fontWeight: 700,
          boxShadow: '0 2px 6px rgba(0,0,0,.18)',
        }}
        aria-label={toolbarOpen ? '收起菜单' : (pendingCount > 0 ? `${pendingCount} 次待汇报，展开菜单` : '展开菜单')}
      >
        {toolbarOpen ? <X size={11} /> : (pendingCount > 0 ? pendingCount : <MoreHorizontal size={11} />)}
      </button>

      {/* 菜单——从角标展开，桌宠下方不再保留任何常驻控件 */}
      {toolbarOpen && (
        <div
          className="fixed flex items-center gap-1 p-1 rounded-full"
          style={{ left: menuLeft, top: menuTop, zIndex: 124, background: 'rgba(255,255,255,.9)', backdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(54,35,48,.14)' }}
        >
          <button onClick={() => { setChatOpen((v) => !v); setSettingsOpen(false); window.setTimeout(() => chatInputRef.current?.focus(), 30) }} className="w-8 h-8 grid place-items-center rounded-full flex-shrink-0" style={{ color: theme.primary }} aria-label="跟它说两句"><MessageCircle size={15} /></button>
          <button onClick={() => { setSettingsOpen((v) => !v); setChatOpen(false) }} className="w-8 h-8 grid place-items-center rounded-full flex-shrink-0" style={{ color: theme.primary }} aria-label="桌宠设置"><Settings size={15} /></button>
          <button onClick={requestClose} className="w-8 h-8 grid place-items-center rounded-full flex-shrink-0" style={{ color: theme.primary }} aria-label="返回聊天窗"><Undo2 size={15} /></button>
        </div>
      )}

      {/* 手势反馈——每次手势一闪而过的短字，贴着头顶 */}
      {gestureFlash && (
        <div
          key={gestureFlash + Date.now()}
          className="fixed text-sm font-bold pet-flash-text"
          style={{ left: position.x + PET_W / 2, top: position.y - 24, zIndex: 122, pointerEvents: 'none', color: theme.primary, textShadow: '0 0 6px rgba(255,255,255,.95), 0 0 10px rgba(255,255,255,.8)' }}
        >
          {gestureFlash}
        </div>
      )}

      {(isLoading || replyBubble) && (
        // 外层只负责定位/防止跑出屏幕（宽度固定 bubbleWidth，纯用来算居中锚点），
        // 真正的气泡用 flex 居中在里面、宽度随内容走（最多到 bubbleWidth）——
        // 短反应（"…"/"？"/"！"）不会被撑成一个大空盒子，长回复摘录也不会跑偏。
        <div
          className="fixed flex justify-center"
          style={{ left: bubbleLeft, top: bubbleTop, width: bubbleWidth, zIndex: 122, pointerEvents: 'none' }}
        >
          <div
            className="px-3 py-2 rounded-2xl text-sm font-medium text-center"
            style={{ maxWidth: bubbleWidth, color: theme.text, background: 'rgba(255,255,255,.92)', boxShadow: '0 5px 20px rgba(54,35,48,.16)', backdropFilter: 'blur(10px)' }}
          >
            {isLoading && !replyBubble ? '…' : replyBubble}
          </div>
        </div>
      )}

      {/* 手势区——只做摸/捏/锤/拖，不再是一排文字按钮 */}
      <div
        className={`desktop-pet ${motion}`}
        style={{ position: 'fixed', left: position.x, top: position.y, width: PET_W, height: PET_H, zIndex: 120, touchAction: 'none', cursor: drag.current?.moved ? 'grabbing' : 'grab', transformOrigin: '50% 25%' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null; setMotion('') }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        title="轻点=摸，快速连点=锤，长按或双指捏=捏脸，拖动=拎起"
      >
        <img src={petImage} alt={identity} draggable="false" style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale})`, transformOrigin: 'bottom center', filter: 'drop-shadow(0 5px 5px rgba(35,25,31,.22))', userSelect: 'none', WebkitUserDrag: 'none' }} />
      </div>

      {chatOpen && (
        <div
          className="fixed flex items-center gap-1.5 p-1.5 rounded-2xl"
          style={{ left: Math.max(8, Math.min(position.x - 90, window.innerWidth - 270)), top: Math.max(64, position.y - 52), width: 260, zIndex: 121, background: 'rgba(255,255,255,.94)', boxShadow: '0 5px 22px rgba(54,35,48,.18)', backdropFilter: 'blur(12px)' }}
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
          <button onClick={sendChat} disabled={!chatText.trim() || isLoading} className="px-3 py-2 rounded-xl text-xs flex-shrink-0" style={{ background: theme.primary, color: 'white', opacity: (!chatText.trim() || isLoading) ? 0.5 : 1 }}>发送</button>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed rounded-3xl p-4" style={{ left: panelLeft, top: Math.max(70, Math.min(position.y - 80, window.innerHeight - 360)), width: 280, maxHeight: '72vh', overflowY: 'auto', zIndex: 123, color: theme.text, background: 'rgba(255,255,255,.96)', boxShadow: '0 12px 40px rgba(43,29,38,.24)', backdropFilter: 'blur(18px)' }}>
          <div className="flex items-center justify-between mb-3">
            <div><div className="font-semibold">桌宠设置</div><div className="text-[11px] opacity-55 mt-0.5">跟着当前会话「{identity}」走</div></div>
            <button onClick={() => setSettingsOpen(false)} className="w-8 h-8 grid place-items-center rounded-full" style={{ background: theme.primary + '12' }}><X size={16} /></button>
          </div>

          <div>
            <span className="text-xs opacity-65">桌宠形象</span>
            <div className="flex gap-2 mt-1.5">
              <button onClick={() => updateDesktopPet({ petImage: DEFAULT_PET_IMAGE })} className="w-11 h-11 rounded-xl overflow-hidden" style={{ border: petImage === DEFAULT_PET_IMAGE ? `2px solid ${theme.primary}` : '2px solid transparent', background: theme.primary + '12' }}>
                <img src={DEFAULT_PET_IMAGE} alt="默认形象" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </button>
              {currentSession?.aiAvatar && (
                <button onClick={() => updateDesktopPet({ petImage: currentSession.aiAvatar })} className="w-11 h-11 rounded-xl overflow-hidden" style={{ border: petImage === currentSession.aiAvatar ? `2px solid ${theme.primary}` : '2px solid transparent', background: theme.primary + '12' }}>
                  <img src={currentSession.aiAvatar} alt="它的头像" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()} className="w-11 h-11 rounded-xl grid place-items-center flex-shrink-0" style={{ background: theme.primary + '12', color: theme.primary }} aria-label="上传形象">
                <Upload size={16} />
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleUploadImage} />
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs opacity-65">大小</span>
            <div className="flex gap-1">
              {[.82, 1, 1.16].map((value, index) => <button key={value} onClick={() => updateDesktopPet({ scale: value })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: scale === value ? theme.primary : theme.primary + '12', color: scale === value ? 'white' : theme.text }}>{['小', '中', '大'][index]}</button>)}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div><span className="text-xs opacity-65">攒几次手势问一次</span><div className="text-[10px] opacity-45 mt-0.5">中间几次只有动效，不联网</div></div>
            <div className="flex gap-1">
              {[3, 5, 8].map((value) => <button key={value} onClick={() => updateDesktopPet({ batchSize: value })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: batchSize === value ? theme.primary : theme.primary + '12', color: batchSize === value ? 'white' : theme.text }}>{value}</button>)}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs opacity-65">回复方式</span>
            <div className="flex gap-1">
              <button onClick={() => updateDesktopPet({ replyMode: 'text' })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: !voiceReply ? theme.primary : theme.primary + '12', color: !voiceReply ? 'white' : theme.text }}>文字</button>
              <button onClick={() => updateDesktopPet({ replyMode: 'voice' })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: voiceReply ? theme.primary : theme.primary + '12', color: voiceReply ? 'white' : theme.text }}>语音</button>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs opacity-65">手势音效</span>
            <button onClick={() => updateDesktopPet({ sfxEnabled: !sfxOn })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: sfxOn ? theme.primary : theme.primary + '12', color: sfxOn ? 'white' : theme.text }}>{sfxOn ? '开' : '关'}</button>
          </div>
        </div>
      )}

      {leaveConfirmOpen && (
        <div className="fixed inset-0 flex items-center justify-center px-8" style={{ zIndex: 200, background: 'rgba(20,14,18,.4)' }} onClick={confirmDiscard}>
          <div className="w-full max-w-xs rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.98)', color: theme.text, boxShadow: '0 16px 48px rgba(0,0,0,.28)' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm leading-5">要告诉「{identity}」刚才被{gestureSummaryPlain}吗？</div>
            <div className="flex gap-2 mt-3">
              <button onClick={confirmDiscard} className="flex-1 py-2 rounded-xl text-sm" style={{ background: theme.primary + '12', color: theme.text }}>不用</button>
              <button onClick={confirmBringAlong} className="flex-1 py-2 rounded-xl text-sm font-semibold" style={{ background: theme.primary, color: 'white' }}>带上</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
