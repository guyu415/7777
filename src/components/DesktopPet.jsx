import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Settings, X, MessageCircle, Undo2, Upload, Eye } from 'lucide-react'
import { useStore, getBlob, getMessages, saveMessage } from '../store'
import { useChat } from '../hooks/useChat'
import { useCodexChat } from '../hooks/useCodexChat'
import {
  findGesture, emptyGestureCounts, totalGestureCount, buildGestureReport,
  describeGestureCounts, playGestureSfx, playLightTapSfx, requestDesktopPetReaction, requestBoundApiPetTurn,
} from '../services/desktopPet'
import { sendVpsDesktopPetAction } from '../services/companion'
import { saveSessionMsgs } from '../services/sync'
import { compressImage } from '../utils/image'
import { fetchTTSAudio } from '../services/tts'

const PET_W = 88
const PET_H = 136
const LONG_PRESS_MS = 500
const RAPID_TAP_MS = 420
const PINCH_CLOSE_PX = 18
const DEFAULT_PET_IMAGE = '/pets/black-haired-pet.png'
const DEFAULT_EXPRESSION_IMAGES = {
  excited: '/pets/black-haired-expressions/excited.png',
  awake: '/pets/black-haired-expressions/awake.png',
  resting: '/pets/black-haired-expressions/resting.png',
  sleeping: '/pets/black-haired-expressions/sleeping.png',
  flustered: '/pets/black-haired-expressions/excited.png',
  angry: '/pets/black-haired-expressions/angry.png',
  teased: '/pets/black-haired-expressions/teased.png',
}
const EXCITED_MS = 8_000
const RESTING_AFTER_MS = 45_000
const SLEEPING_AFTER_MS = 120_000
const SECRET_STREAK_MS = 2_500
const RUB_DEADZONE_PX = 5
const RUB_MIN_AMPLITUDE_PX = 12
const SWING_DEADZONE_PX = 4 // 判定方向反转前的抖动容差
const SWING_MIN_AMPLITUDE_PX = 24 // 单次摆幅至少要达到这个距离才算数
const SWING_MIN_SPEED_PX_MS = 0.15 // 单次摆动的最低速度（px/ms），挡住"缓慢挪动时顺手回摆一下"
const BADGE_DRAG_HOLD_MS = 220 // 角标短按开菜单，按住后才接管桌宠移动

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
  const { sessions, currentSessionId, desktopPet, updateDesktopPet, setCurrentView, setCurrentSessionId } = useStore()
  const cc = useChat()
  const codex = useCodexChat()

  const petSessionId = desktopPet.sessionId || currentSessionId
  const currentSession = useMemo(
    () => sessions?.find((s) => s.id === petSessionId),
    [sessions, petSessionId],
  )
  const isCodexSession = currentSession?.providerName === 'codex-vps'
  const chat = isCodexSession ? codex : cc
  const { sendMessage, isLoading: chatIsLoading, loadHistory, messages } = chat

  // 桌宠输入框里的真实文字对话走原会话；手势和屏幕感知走隔离反应线程。
  // 手势完成后会把动作与反应写回绑定会话的显示历史，屏幕感知仍只留在桌宠层。
  // 只有桌宠文字输入需要先保证原会话历史已加载。
  useEffect(() => { if (currentSessionId === petSessionId) loadHistory() }, [currentSessionId, petSessionId, loadHistory])

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
  const [reactionLoading, setReactionLoading] = useState(false)
  const [idleState, setIdleState] = useState('awake')
  const [expressionOverride, setExpressionOverride] = useState('')
  const [secretActive, setSecretActive] = useState(false)
  const [peekRequestOpen, setPeekRequestOpen] = useState(false)
  const [peekScheduleKey, setPeekScheduleKey] = useState(0)

  const drag = useRef(null)
  const badgeDragTimer = useRef(null)
  const pressTimer = useRef(null)
  const longPressFired = useRef(false)
  const touchPinch = useRef(null) // { startDist, fired }
  const isPinchingRef = useRef(false)
  const tapDecisionTimer = useRef(null)
  const tapBurst = useRef({ count: 0, lastAt: 0 })
  const gestureCounts = useRef(emptyGestureCounts())
  const flashTimer = useRef(null)
  const replyTimer = useRef(null)
  const chatInputRef = useRef(null)
  const fileInputRef = useRef(null)
  const screenshotInputRef = useRef(null)
  const mountedAt = useRef(Date.now())
  const lastShownReplyId = useRef(null)
  const lastActivityAt = useRef(Date.now())
  const expressionTimer = useRef(null)
  const secretTimer = useRef(null)
  const secretStreak = useRef({ count: 0, at: 0 })
  const hasRequestedPeek = useRef(false)
  const reactionBusyRef = useRef(false)
  // 主聊天窗口跟桌宠共用同一个 useChat 会话/messages 数组——只有靠这个标记
  // 才能分清"新回复是桌宠自己发的话引出来的"还是"用户在主对话框里聊天顺带
  // 冒出来的"，桌宠语音只该在前一种情况下响，见 sendChat 和下面的回复气泡
  // effect。
  const petTriggeredRef = useRef(false)

  const batchSize = desktopPet.batchSize || 15
  const scale = desktopPet.scale || 0.8
  const petImage = desktopPet.petImage || DEFAULT_PET_IMAGE
  const usesDefaultPet = !desktopPet.petImage || desktopPet.petImage === DEFAULT_PET_IMAGE
  const identity = currentSession?.aiName || currentSession?.name || 'AI'
  const sfxOn = !!desktopPet.sfxEnabled
  const voiceReply = desktopPet.replyMode === 'voice'
  const sceneAwareness = desktopPet.sceneAwareness !== false
  const expression = expressionOverride || idleState
  const displayedPetImage = usesDefaultPet ? (DEFAULT_EXPRESSION_IMAGES[expression] || DEFAULT_EXPRESSION_IMAGES.awake) : petImage

  useEffect(() => {
    const fit = () => setPosition((current) => clampPosition(current.x, current.y))
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const markActive = useCallback((mood = 'excited', holdMs = EXCITED_MS) => {
    lastActivityAt.current = Date.now()
    setIdleState('excited')
    setExpressionOverride(mood)
    window.clearTimeout(expressionTimer.current)
    expressionTimer.current = window.setTimeout(() => setExpressionOverride(''), holdMs)
  }, [])

  // 兴奋 → 清醒 → 休息 → 睡眠是纯前端待机状态；它不调用模型、
  // 不写消息，只切换表情和轻量待机动作。
  useEffect(() => {
    const updateIdle = () => {
      if (document.visibilityState === 'hidden') { setIdleState('sleeping'); return }
      const elapsed = Date.now() - lastActivityAt.current
      if (elapsed < EXCITED_MS) setIdleState('excited')
      else if (elapsed < RESTING_AFTER_MS) setIdleState('awake')
      else if (elapsed < SLEEPING_AFTER_MS) setIdleState('resting')
      else setIdleState('sleeping')
    }
    updateIdle()
    const timer = window.setInterval(updateIdle, 4_000)
    document.addEventListener('visibilitychange', updateIdle)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', updateIdle) }
  }, [])

  // 桌宠可以主动“申请偷看”，但只弹授权请求；永远不在后台静默捕捉。
  useEffect(() => {
    if (!sceneAwareness || peekRequestOpen) return undefined
    const firstDelay = 55_000 + Math.random() * 35_000
    const laterDelay = 5 * 60_000 + Math.random() * 5 * 60_000
    const timer = window.setTimeout(() => {
      if (document.visibilityState !== 'visible') { setPeekScheduleKey((v) => v + 1); return }
      hasRequestedPeek.current = true
      setPeekRequestOpen(true)
      markActive('excited', 12_000)
    }, hasRequestedPeek.current ? laterDelay : firstDelay)
    return () => window.clearTimeout(timer)
  }, [sceneAwareness, peekRequestOpen, peekScheduleKey, markActive])

  useEffect(() => () => {
    window.clearTimeout(pressTimer.current)
    window.clearTimeout(flashTimer.current)
    window.clearTimeout(replyTimer.current)
    window.clearTimeout(expressionTimer.current)
    window.clearTimeout(secretTimer.current)
    window.clearTimeout(tapDecisionTimer.current)
    window.clearTimeout(badgeDragTimer.current)
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

  const showPetReply = useCallback((text, mood = 'awake') => {
    const plain = String(text || '').trim()
    if (!plain) return
    markActive(mood, mood === 'flustered' ? 18_000 : 10_000)
    const visible = plain.length > 60 ? `${plain.slice(0, 60)}…` : plain
    window.clearTimeout(replyTimer.current)
    if (voiceReply) {
      synthesizeAndPlay(plain).then((ok) => {
        setReplyBubble(ok ? '🔊' : visible)
        window.clearTimeout(replyTimer.current)
        replyTimer.current = window.setTimeout(() => setReplyBubble(''), 5_000)
      })
    } else {
      setReplyBubble(visible)
      replyTimer.current = window.setTimeout(() => setReplyBubble(''), 7_000)
    }
  }, [markActive, synthesizeAndPlay, voiceReply])

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

    // 只有桌宠输入框发出的真实文字对话才在桌宠上回显。用户在原聊天
    // 窗输入引发的回复不会“串台”到桌宠气泡。
    const isPetTriggered = petTriggeredRef.current
    petTriggeredRef.current = false
    if (!isPetTriggered) return

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
    flashTimer.current = window.setTimeout(() => setGestureFlash(''), 550)
    setMotion(g.motion)
    window.setTimeout(() => setMotion(''), 650)
    navigator.vibrate?.(gestureId === 'bonk' ? 14 : gestureId === 'secret' ? 10 : 8)
    playGestureSfx(gestureId, sfxOn)
  }, [sfxOn])

  const reportGestures = useCallback(async () => {
    if (reactionBusyRef.current) return
    const counts = { ...gestureCounts.current }
    const report = describeGestureCounts(counts)
    gestureCounts.current = emptyGestureCounts()
    setPendingCount(0)
    if (!report) return
    reactionBusyRef.current = true
    setReactionLoading(true)
    try {
      const action = buildGestureReport(counts, identity)
      if (currentSession?.providerName === 'claude-code-vps' || currentSession?.providerName === 'codex-vps') {
        await sendVpsDesktopPetAction({
          runtime: currentSession.providerName === 'codex-vps' ? 'codex' : 'claude-code',
          sessionId: petSessionId,
          action,
        })
      } else if (currentSessionId === petSessionId) {
        petTriggeredRef.current = true
        await sendMessage(action, 'text')
      } else {
        const now = Date.now()
        const userMessage = { id: `pet-user-${now}`, conversationId: petSessionId, role: 'user', type: 'text', content: action, timestamp: now }
        await saveMessage(userMessage)
        const history = await getMessages(petSessionId)
        history.sort((a, b) => a.timestamp - b.timestamp)
        const reply = await requestBoundApiPetTurn({ session: currentSession, globals: useStore.getState(), messages: history })
        const assistantMessage = { id: `pet-ai-${Date.now()}`, conversationId: petSessionId, role: 'assistant', type: 'text', content: reply, timestamp: Date.now() }
        await saveMessage(assistantMessage)
        const store = useStore.getState()
        store.updateSession(petSessionId, { lastMsgPreview: reply.slice(0, 40), lastMsgTime: assistantMessage.timestamp })
        const password = localStorage.getItem('auth.password')
        if (password) {
          const completed = [...history, assistantMessage].filter((message) => !message.streaming)
          await saveSessionMsgs(password, petSessionId, completed)
        }
        showPetReply(reply, 'awake')
      }
    } catch (e) {
      console.warn('[PET] 手势汇总发送失败:', e?.message)
      setReplyBubble('……没听清')
      window.clearTimeout(replyTimer.current)
      replyTimer.current = window.setTimeout(() => setReplyBubble(''), 3_000)
    } finally {
      reactionBusyRef.current = false
      setReactionLoading(false)
    }
  }, [currentSession, currentSessionId, identity, petSessionId, sendMessage, showPetReply])

  // 单次手势只累加本地计数 + 播本地动效；攒够 batchSize 次才真的触发一次
  // 请求（带完整人设与上下文的真实链路），中间几次完全不联网。
  const triggerGesture = useCallback((gestureId, amount = 1, forceReport = false) => {
    markActive(gestureId === 'bonk' ? 'angry' : gestureId === 'secret' ? 'teased' : gestureId === 'pinch' ? 'resting' : 'excited')
    playLocalMotion(gestureId)
    gestureCounts.current[gestureId] = (gestureCounts.current[gestureId] || 0) + amount
    const total = totalGestureCount(gestureCounts.current)
    if (total >= batchSize || forceReport) {
      reportGestures()
    } else {
      setPendingCount(total)
    }
  }, [playLocalMotion, batchSize, reportGestures, markActive])

  // 轻反馈——第一下尚在等待“摸/锤”判定时给一个小抖动和轻提示音；
  // 它本身不算正式手势、不计数、不出文字。
  const lightTapPulse = useCallback(() => {
    navigator.vibrate?.(4)
    playLightTapSfx(sfxOn)
    setMotion('light-pulse')
    window.setTimeout(() => setMotion(''), 160)
  }, [sfxOn])

  const handleSecretStroke = useCallback(() => {
    const now = Date.now()
    const nextCount = now - secretStreak.current.at <= SECRET_STREAK_MS ? secretStreak.current.count + 1 : 1
    secretStreak.current = { count: nextCount, at: now }
    triggerGesture('secret', 1, nextCount === 10)
    if (nextCount < 10) return
    secretStreak.current = { count: 0, at: 0 }
    setSecretActive(true)
    markActive('flustered', 25_000)
    navigator.vibrate?.([18, 35, 24])
    window.clearTimeout(secretTimer.current)
    secretTimer.current = window.setTimeout(() => setSecretActive(false), 30_000)
  }, [triggerGesture, markActive])

  // 三连点才折算成一次“锤”。单点停下=摸一下，双点停下=摸两下；
  // 六连点才是锤两下。阈值累计的是锤击次数，不是原始点击次数。
  const handleTap = useCallback(() => {
    const now = Date.now()
    lightTapPulse()
    if (now - tapBurst.current.lastAt > RAPID_TAP_MS) tapBurst.current.count = 0
    tapBurst.current.count += 1
    tapBurst.current.lastAt = now
    window.clearTimeout(tapDecisionTimer.current)
    if (tapBurst.current.count >= 3) {
      tapBurst.current.count = 0
      triggerGesture('bonk', 1)
      return
    }
    tapDecisionTimer.current = window.setTimeout(() => {
      tapDecisionTimer.current = null
      const count = tapBurst.current.count
      tapBurst.current.count = 0
      if (count > 0) triggerGesture('pet', count)
    }, RAPID_TAP_MS)
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
    if (petSessionId) setCurrentSessionId(petSessionId)
    setCurrentView('chat')
  }, [updateDesktopPet, petSessionId, setCurrentSessionId, setCurrentView])

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
    if (!text || chatIsLoading) return
    setChatText('')
    // 发送后立刻收起输入框，不常驻挡屏幕；回复走上面那个"新回复"气泡。
    setChatOpen(false)
    petTriggeredRef.current = true
    try {
      await sendMessage(text, 'text')
    } catch (e) {
      console.warn('[PET] 发送失败:', e?.message)
    }
  }, [chatText, chatIsLoading, sendMessage])

  // ── 手势识别：身体只接互动，位置移动只允许从右上角标按住后开始。 ──

  const onPointerDown = (event) => {
    if (isPinchingRef.current) return
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    longPressFired.current = false
    const localX = (event.clientX - position.x) / PET_W
    const localY = (event.clientY - position.y) / PET_H
    drag.current = {
      mode: 'interaction',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      // 摆动判定：swingDir 记录当前这一段的水平方向（0=还没定下来），
      // segStartX/segStartTime 是这一段的起点，extremumX 是目前为止在这个
      // 方向上走到的最远处——一旦从 extremumX 往回退超过死区，就认为方向
      // 反转了一次，检查这一段的摆幅和速度是否达标。
      swingDir: 0,
      segStartX: event.clientX,
      segStartTime: event.timeStamp,
      extremumX: event.clientX,
      // 从身体区域落指、且主要水平往复时识别为“搓动”；
      // 头部起手或明显纵向拖动仍是原来的拎起/移位。
      rubCandidate: localX >= 0.18 && localX <= 0.82 && localY >= 0.28 && localY <= 0.9,
      rubbing: false,
      rubDir: 0,
      rubPhase: 'outbound',
      rubOriginX: event.clientX,
      rubExtremumX: event.clientX,
      rubReturnStartX: event.clientX,
      rubCycles: 0,
    }
    window.clearTimeout(pressTimer.current)
    pressTimer.current = window.setTimeout(() => {
      if (drag.current?.mode === 'interaction' && !drag.current.moved) {
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

  const detectRub = useCallback((x) => {
    const d = drag.current
    if (!d) return
    if (d.rubDir === 0) {
      if (x - d.rubOriginX > RUB_DEADZONE_PX) { d.rubDir = 1; d.rubExtremumX = x }
      else if (d.rubOriginX - x > RUB_DEADZONE_PX) { d.rubDir = -1; d.rubExtremumX = x }
      return
    }

    if (d.rubPhase === 'outbound') {
      const extendsOutward = d.rubDir === 1 ? x > d.rubExtremumX : x < d.rubExtremumX
      if (extendsOutward) { d.rubExtremumX = x; return }
      const reversal = Math.abs(d.rubExtremumX - x)
      if (reversal <= RUB_DEADZONE_PX) return
      const outboundAmplitude = Math.abs(d.rubExtremumX - d.rubOriginX)
      if (outboundAmplitude < RUB_MIN_AMPLITUDE_PX) {
        d.rubDir = 0
        d.rubOriginX = x
        d.rubExtremumX = x
        return
      }
      d.rubPhase = 'returning'
      d.rubReturnStartX = d.rubExtremumX
      d.rubDir *= -1
    }

    // 从最远点往回滑够一个有效摆幅，立即算一次完整“来回”；
    // 随后的连续滑动从当前位置重新开始下一轮，不要求多拐一次弯。
    if (Math.abs(x - d.rubReturnStartX) >= RUB_MIN_AMPLITUDE_PX) {
      d.rubCycles += 1
      handleSecretStroke()
      d.rubPhase = 'outbound'
      d.rubDir = 0
      d.rubOriginX = x
      d.rubExtremumX = x
      d.rubReturnStartX = x
    }
  }, [handleSecretStroke])

  const onPointerMove = (event) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId || drag.current.mode !== 'interaction') return
    const dx = event.clientX - drag.current.startX
    const dy = event.clientY - drag.current.startY
    if (drag.current.rubCandidate && (drag.current.rubbing || Math.abs(dy) <= 36)) {
      if (Math.abs(dx) > RUB_DEADZONE_PX) {
        drag.current.moved = true
        drag.current.rubbing = true
        window.clearTimeout(pressTimer.current)
        detectRub(event.clientX)
      }
      return
    }
    drag.current.rubCandidate = false
    if (Math.hypot(dx, dy) > 6) {
      drag.current.moved = true
      window.clearTimeout(pressTimer.current)
    }
  }

  const onPointerUp = (event) => {
    window.clearTimeout(pressTimer.current)
    if (!drag.current || drag.current.pointerId !== event.pointerId || drag.current.mode !== 'interaction') return
    const wasMoved = drag.current.moved
    const wasLongPress = longPressFired.current
    const wasRubbing = drag.current.rubbing
    const rubCycles = drag.current.rubCycles
    drag.current = null
    setMotion('')
    if (wasLongPress) return // 捏脸已经在长按计时器里触发过了
    if (wasRubbing) {
      // 有完整往复才计彩蛋；只蹭了一下也不会被误算成摸或锤。
      if (rubCycles === 0) lightTapPulse()
      return
    }
    if (!wasMoved) handleTap()
  }

  const onBadgePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    window.clearTimeout(pressTimer.current)
    event.currentTarget.setPointerCapture?.(event.pointerId)
    window.clearTimeout(badgeDragTimer.current)
    drag.current = {
      mode: 'badge-pending', pointerId: event.pointerId,
      startX: event.clientX, startY: event.clientY,
      originX: position.x, originY: position.y,
      moved: false, latest: position,
      swingDir: 0, segStartX: event.clientX, segStartTime: event.timeStamp, extremumX: event.clientX,
    }
    badgeDragTimer.current = window.setTimeout(() => {
      if (drag.current?.mode === 'badge-pending' && drag.current.pointerId === event.pointerId) {
        drag.current.mode = 'badge-move'
        setToolbarOpen(false)
        setMotion('lift')
      }
    }, BADGE_DRAG_HOLD_MS)
  }

  const onBadgePointerMove = (event) => {
    const d = drag.current
    if (!d || d.pointerId !== event.pointerId) return
    event.preventDefault()
    if (d.mode !== 'badge-move') return
    const dx = event.clientX - d.startX
    const dy = event.clientY - d.startY
    if (Math.hypot(dx, dy) > 4) d.moved = true
    detectSwing(event.clientX, event.timeStamp)
    const next = clampPosition(d.originX + dx, d.originY + dy)
    d.latest = next
    setPosition(next)
  }

  const onBadgePointerUp = (event) => {
    const d = drag.current
    if (!d || d.pointerId !== event.pointerId) return
    event.preventDefault()
    event.stopPropagation()
    window.clearTimeout(badgeDragTimer.current)
    drag.current = null
    setMotion('')
    if (d.mode === 'badge-pending') {
      setToolbarOpen((v) => !v)
      return
    }
    if (d.moved) updateDesktopPet({ x: d.latest.x, y: d.latest.y })
  }

  const cancelBadgeDrag = () => {
    window.clearTimeout(badgeDragTimer.current)
    drag.current = null
    setMotion('')
  }

  // 双指捏合——原生 touch 事件，和上面的指针手势并行；一旦检测到第二根手
  // 指落下就接管，取消可能已经在跑的单指长按/拖动判定，避免重复触发。
  const onTouchStart = (event) => {
    if (event.touches.length === 2) {
      window.clearTimeout(pressTimer.current)
      window.clearTimeout(badgeDragTimer.current)
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

  const reactToScreen = useCallback(async (dataUrl) => {
    if (!dataUrl || !currentSession) return
    setReactionLoading(true)
    markActive('excited', 12_000)
    try {
      const result = await requestDesktopPetReaction({
        session: currentSession,
        globals: useStore.getState(),
        identity,
        instruction: '这是用户刚刚明确同意让你偷看的屏幕画面。只对你真正看到的内容做一句符合你身份的反应，看不清就直说，不要猜。',
        imageDataUrl: dataUrl,
      })
      showPetReply(result.text, result.mood)
    } catch (e) {
      console.warn('[PET] 屏幕感知失败:', e?.message)
      showPetReply('这次没看清。', 'resting')
    } finally {
      setReactionLoading(false)
      setPeekScheduleKey((v) => v + 1)
    }
  }, [currentSession, identity, markActive, showPetReply])

  const handleScreenshotFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) { setPeekScheduleKey((v) => v + 1); return }
    try {
      const { dataUrl } = await compressImage(file, { maxDim: 1200, quality: 0.78, keepGif: false })
      await reactToScreen(dataUrl)
    } catch {
      showPetReply('图片没打开。', 'resting')
    }
  }

  const allowScreenPeek = useCallback(async () => {
    setPeekRequestOpen(false)
    // iOS PWA 暂时不提供 getDisplayMedia；这时候直接唤起系统图片选择器，
    // 让用户选刚截的屏，仍然不会在没授权时偷偷读取任何画面。
    if (!navigator.mediaDevices?.getDisplayMedia) {
      screenshotInputRef.current?.click()
      return
    }
    let stream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const video = document.createElement('video')
      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve
        video.onerror = reject
        window.setTimeout(() => reject(new Error('屏幕画面超时')), 8_000)
      })
      await video.play()
      const maxWidth = 1200
      const ratio = Math.min(1, maxWidth / Math.max(1, video.videoWidth))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(video.videoWidth * ratio))
      canvas.height = Math.max(1, Math.round(video.videoHeight * ratio))
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
      await reactToScreen(canvas.toDataURL('image/jpeg', 0.78))
    } catch (e) {
      if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') showPetReply('这次没偷看成。', 'resting')
      setPeekScheduleKey((v) => v + 1)
    } finally {
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [reactToScreen, showPetReply])

  const declineScreenPeek = useCallback(() => {
    setPeekRequestOpen(false)
    setExpressionOverride('awake')
    window.setTimeout(() => setExpressionOverride(''), 2_000)
    setPeekScheduleKey((v) => v + 1)
  }, [])

  const panelLeft = Math.max(10, Math.min(position.x - 85, window.innerWidth - 290))
  const gestureSummaryPlain = describeGestureCounts(gestureCounts.current)

  // 菜单入口合并进右上角角标——不再有常驻的底部工具条。角标本身始终可点：
  // 视觉上是一枚真正镂空的银色雕花戒指，实际触控热区更大；短按时戒圈展开，
  // 按住后拖动才会改变桌宠位置。
  const badgeHitSize = 34
  const badgeVisualSize = toolbarOpen ? 28 : 20
  const badgeLeft = position.x + PET_W * 0.62
  const badgeTop = position.y + PET_H * 0.045
  const menuWidth = 154
  const menuLeft = Math.max(8, Math.min(badgeLeft + badgeHitSize - menuWidth, window.innerWidth - menuWidth - 8))
  const menuTop = badgeTop + badgeHitSize + 3

  // 回复气泡（"…"/单字反应/语音🔊/长回复摘录都走这一个气泡）——横向以桌宠
  // 中线为基准居中，不再是原来那种以桌宠左侧为锚点、盒子整体往右怼的算法
  // （短反应字符一少，视觉上就飘到离人物很远的地方去了）。
  const bubbleWidth = 210
  const bubbleLeft = Math.max(8, Math.min(position.x + PET_W / 2 - bubbleWidth / 2, window.innerWidth - bubbleWidth - 8))
  const bubbleTop = Math.max(8, position.y - 54)
  const isPetBusy = reactionLoading || (chatIsLoading && petTriggeredRef.current)

  return (
    <>
      <style>{`
        @keyframes pet-bob { 0%,100%{transform:translateY(0) scale(1)} 45%{transform:translateY(-8px) scale(1.03)} }
        @keyframes pet-squash { 0%,100%{transform:scale(1)} 35%{transform:scale(.88,1.08)} 70%{transform:scale(1.06,.94)} }
        @keyframes pet-bonk { 0%,100%{transform:rotate(0)} 20%{transform:rotate(-10deg)} 45%{transform:rotate(11deg)} 70%{transform:rotate(-6deg)} }
        @keyframes pet-lift { 0%,100%{transform:rotate(0)} 35%{transform:rotate(-5deg)} 70%{transform:rotate(5deg)} }
        @keyframes pet-light-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.035)} }
        @keyframes pet-excited-idle { 0%,100%{transform:translateY(0) rotate(0)} 18%{transform:translateY(-8px) rotate(-4deg)} 36%{transform:translateY(0) rotate(3deg)} 52%{transform:translateY(-4px) rotate(-2deg)} 68%{transform:translateY(0) rotate(0)} }
        @keyframes pet-awake-idle { 0%,22%,100%{transform:translateX(0) rotate(0)} 32%,44%{transform:translateX(-4px) rotate(-3deg)} 57%,69%{transform:translateX(4px) rotate(3deg)} 80%{transform:translateX(0) rotate(0)} }
        @keyframes pet-rest-idle { 0%,100%{transform:translateY(4px) rotate(-4deg)} 50%{transform:translateY(7px) rotate(4deg)} }
        @keyframes pet-sleep-idle { 0%,100%{transform:translateY(9px) rotate(6deg) scale(.96)} 50%{transform:translateY(12px) rotate(7deg) scale(.94,.98)} }
        @keyframes pet-cue-float { 0%,100%{transform:translateY(0);opacity:.42} 50%{transform:translateY(-5px);opacity:.9} }
        @keyframes pet-secret-pop { 0%{transform:translateX(-50%) scale(.2);opacity:0} 60%{transform:translateX(-50%) scale(1.16);opacity:1} 100%{transform:translateX(-50%) scale(1);opacity:1} }
        @keyframes pet-flash { 0%{opacity:0; transform:translate(-50%,4px)} 15%{opacity:1; transform:translate(-50%,0)} 75%{opacity:1} 100%{opacity:0; transform:translate(-50%,-6px)} }
        .desktop-pet.pet{animation:pet-bob .62s ease}.desktop-pet.pinch{animation:pet-squash .58s ease}
        .desktop-pet.bonk{animation:pet-bonk .52s ease}.desktop-pet.lift{animation:pet-lift .55s ease-in-out infinite}
        .desktop-pet.secret{animation:pet-squash .42s ease}
        .desktop-pet.light-pulse{animation:pet-light-pulse .16s ease}
        .desktop-pet.idle-excited{animation:pet-excited-idle 1.8s ease-in-out infinite}
        .desktop-pet.idle-awake{animation:pet-awake-idle 6.5s ease-in-out infinite}
        .desktop-pet.idle-resting{animation:pet-rest-idle 4.2s ease-in-out infinite}
        .desktop-pet.idle-sleeping{animation:pet-sleep-idle 5.2s ease-in-out infinite}
        .desktop-pet,.desktop-pet *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
        .pet-idle-cue{animation:pet-cue-float 2.2s ease-in-out infinite}
        .pet-secret-bulge{animation:pet-secret-pop .45s cubic-bezier(.2,.9,.25,1.15) forwards}
        .pet-flash-text{animation:pet-flash .7s ease forwards}
        .pet-silver-ring{position:relative;display:block;transition:width .2s ease,height .2s ease,transform .2s ease,filter .2s ease;filter:drop-shadow(0 1px 2px rgba(35,39,48,.36));pointer-events:none}
        .pet-silver-ring.open{transform:rotate(8deg);filter:brightness(1.08) drop-shadow(0 2px 3px rgba(35,39,48,.4))}
        .pet-silver-ring img{display:block;width:100%;height:100%;object-fit:contain}
        .pet-ring-count{position:absolute;right:-2px;top:-2px;display:grid;place-items:center;min-width:12px;height:12px;padding:0 3px;border-radius:999px;background:#d977a2;color:white;font-size:8px;line-height:1;box-shadow:0 1px 3px rgba(62,36,51,.28),0 0 0 1px rgba(255,255,255,.9)}
      `}</style>

      {/* 手势计数角标——紧贴桌宠肩侧、跟随桌宠位置移动，同时也是菜单入口与
          唯一移动把手：短按展开/收起菜单，按住后拖动桌宠。 */}
      <button
        onPointerDown={onBadgePointerDown}
        onPointerMove={onBadgePointerMove}
        onPointerUp={onBadgePointerUp}
        onPointerCancel={cancelBadgeDrag}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') setToolbarOpen((v) => !v) }}
        className="fixed grid place-items-center rounded-full"
        style={{
          left: badgeLeft, top: badgeTop,
          width: badgeHitSize, height: badgeHitSize, zIndex: 125, border: 'none', padding: 0,
          background: 'transparent', color: '#526070', fontSize: 9, fontWeight: 800,
          touchAction: 'none', cursor: 'grab',
        }}
        aria-label={toolbarOpen ? '收起菜单；按住可移动桌宠' : (pendingCount > 0 ? `${pendingCount} 次待汇报；点按展开，按住移动桌宠` : '点按展开菜单，按住移动桌宠')}
        title="点按开菜单，按住拖动桌宠"
      >
        <span className={`pet-silver-ring${toolbarOpen ? ' open' : ''}`} style={{ width: badgeVisualSize, height: badgeVisualSize }}>
          <img src="/pets/silver-leaf-ring-hollow-v2.png" alt="" draggable="false" />
          {pendingCount > 0 && <span className="pet-ring-count">{pendingCount}</span>}
        </span>
      </button>

      {/* 菜单——从角标展开，桌宠下方不再保留任何常驻控件 */}
      {toolbarOpen && (
        <div
          className="fixed flex items-center gap-1 p-1 rounded-full"
          style={{ left: menuLeft, top: menuTop, zIndex: 124, background: 'rgba(255,255,255,.9)', backdropFilter: 'blur(10px)', boxShadow: '0 4px 14px rgba(54,35,48,.14)' }}
        >
          <button onClick={() => { if (petSessionId && currentSessionId !== petSessionId) setCurrentSessionId(petSessionId); setChatOpen((v) => !v); setSettingsOpen(false); window.setTimeout(() => chatInputRef.current?.focus(), 30) }} className="w-8 h-8 grid place-items-center rounded-full flex-shrink-0" style={{ color: theme.primary }} aria-label="跟它说两句"><MessageCircle size={15} /></button>
          <button onClick={() => { setPeekRequestOpen(true); setToolbarOpen(false); markActive('excited', 12_000) }} className="w-8 h-8 grid place-items-center rounded-full flex-shrink-0" style={{ color: theme.primary }} aria-label="请求偷看屏幕"><Eye size={15} /></button>
          <button onClick={() => { setSettingsOpen((v) => !v); setChatOpen(false) }} className="w-8 h-8 grid place-items-center rounded-full flex-shrink-0" style={{ color: theme.primary }} aria-label="桌宠设置"><Settings size={15} /></button>
          <button onClick={requestClose} className="w-8 h-8 grid place-items-center rounded-full flex-shrink-0" style={{ color: theme.primary }} aria-label="返回聊天窗"><Undo2 size={15} /></button>
        </div>
      )}

      {gestureFlash && (
        <div
          key={gestureFlash + Date.now()}
          className="fixed pet-flash-text"
          style={{ left: position.x + PET_W / 2, top: position.y - 12, zIndex: 122, pointerEvents: 'none', color: theme.primary, fontSize: 10, fontWeight: 500, opacity: .72, textShadow: '0 1px 4px rgba(255,255,255,.95)' }}
        >
          {gestureFlash}
        </div>
      )}

      {(isPetBusy || replyBubble) && (
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
            {isPetBusy && !replyBubble ? '…' : replyBubble}
          </div>
        </div>
      )}

      {/* 身体手势区只做互动；移动只能按住上面的角标，避免滑动彩蛋被抢成拖拽。 */}
      <div
        className={`desktop-pet ${motion || `idle-${idleState}`}`}
        style={{ position: 'fixed', left: position.x, top: position.y, width: PET_W, height: PET_H, zIndex: 120, touchAction: 'none', cursor: 'pointer', transformOrigin: '50% 25%', userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { window.clearTimeout(pressTimer.current); drag.current = null; setMotion('') }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onSelectStart={(event) => event.preventDefault()}
        onDragStart={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
        title="点一下=摸，快速连点=锤，身上来回滑=搓，长按或双指捏=捏脸；移动请按住右上角标"
      >
        <img src={displayedPetImage} alt={identity} draggable="false" onContextMenu={(event) => event.preventDefault()} style={{ width: '100%', height: '100%', objectFit: 'contain', transform: `scale(${scale})`, transformOrigin: 'bottom center', filter: 'drop-shadow(0 5px 5px rgba(35,25,31,.22))', userSelect: 'none', WebkitUserDrag: 'none', WebkitTouchCallout: 'none', pointerEvents: 'none' }} />
        {secretActive && usesDefaultPet && <div className="pet-secret-bulge" style={{ position: 'absolute', left: '50%', top: '65%', width: '12px', height: '18px', borderRadius: '55% 55% 48% 48%', background: 'radial-gradient(ellipse at 38% 28%, rgba(94,90,99,.96), rgba(24,22,27,.98) 58%, rgba(8,8,10,.98))', boxShadow: '0 1px 3px rgba(0,0,0,.42)', pointerEvents: 'none' }} />}
        {expression === 'flustered' && usesDefaultPet && <><span style={{ position: 'absolute', left: '32%', top: '31%', width: 8, height: 4, borderRadius: '50%', background: 'rgba(234,120,145,.35)', filter: 'blur(1px)', pointerEvents: 'none' }} /><span style={{ position: 'absolute', right: '30%', top: '31%', width: 8, height: 4, borderRadius: '50%', background: 'rgba(234,120,145,.35)', filter: 'blur(1px)', pointerEvents: 'none' }} /></>}
        {!motion && idleState === 'excited' && <span className="pet-idle-cue" style={{ position: 'absolute', right: 5, top: 24, fontSize: 13, color: theme.primary, textShadow: '0 1px 4px white', pointerEvents: 'none' }}>✦</span>}
        {!motion && idleState === 'resting' && <span className="pet-idle-cue" style={{ position: 'absolute', right: 7, top: 18, fontSize: 13, color: theme.primary, textShadow: '0 1px 4px white', pointerEvents: 'none' }}>…</span>}
        {!motion && idleState === 'sleeping' && <span className="pet-idle-cue" style={{ position: 'absolute', right: 2, top: 10, fontSize: 11, fontWeight: 800, color: theme.primary, textShadow: '0 1px 4px white', pointerEvents: 'none' }}>Zz</span>}
      </div>

      <input ref={screenshotInputRef} type="file" accept="image/*" hidden onChange={handleScreenshotFile} />

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
          <button onClick={sendChat} disabled={!chatText.trim() || chatIsLoading} className="px-3 py-2 rounded-xl text-xs flex-shrink-0" style={{ background: theme.primary, color: 'white', opacity: (!chatText.trim() || chatIsLoading) ? 0.5 : 1 }}>发送</button>
        </div>
      )}

      {peekRequestOpen && (
        <div className="fixed inset-0 flex items-center justify-center px-8" style={{ zIndex: 190, background: 'rgba(20,14,18,.32)' }} onClick={declineScreenPeek}>
          <div className="w-full max-w-xs rounded-3xl p-4" style={{ background: 'rgba(255,255,255,.97)', color: theme.text, boxShadow: '0 16px 48px rgba(0,0,0,.25)', backdropFilter: 'blur(16px)' }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 font-semibold"><Eye size={17} style={{ color: theme.primary }} />「{identity}」想偷看一眼屏幕</div>
            <div className="text-xs opacity-60 mt-2 leading-5">只会在你同意后读取这一张画面，不持续录屏，反应也不发回原聊天。</div>
            <div className="flex gap-2 mt-3">
              <button onClick={declineScreenPeek} className="flex-1 py-2 rounded-xl text-sm" style={{ background: theme.primary + '12', color: theme.text }}>不给看</button>
              <button onClick={allowScreenPeek} className="flex-1 py-2 rounded-xl text-sm font-semibold" style={{ background: theme.primary, color: 'white' }}>给你看一眼</button>
            </div>
          </div>
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
              {[.66, .8, .94].map((value, index) => <button key={value} onClick={() => updateDesktopPet({ scale: value })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: scale === value ? theme.primary : theme.primary + '12', color: scale === value ? 'white' : theme.text }}>{['小', '中', '大'][index]}</button>)}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <div><span className="text-xs opacity-65">攒几次手势问一次</span><div className="text-[10px] opacity-45 mt-0.5">中间几次只有动效，不联网</div></div>
            <div className="flex gap-1">
              {[10, 15, 20].map((value) => <button key={value} onClick={() => updateDesktopPet({ batchSize: value })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: batchSize === value ? theme.primary : theme.primary + '12', color: batchSize === value ? 'white' : theme.text }}>{value}</button>)}
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

          <div className="mt-3 flex items-center justify-between">
            <div><span className="text-xs opacity-65">场景感知</span><div className="text-[10px] opacity-45 mt-0.5">只申请，同意后才看一张</div></div>
            <button onClick={() => updateDesktopPet({ sceneAwareness: !sceneAwareness })} className="px-3 py-1.5 rounded-lg text-xs" style={{ background: sceneAwareness ? theme.primary : theme.primary + '12', color: sceneAwareness ? 'white' : theme.text }}>{sceneAwareness ? '开' : '关'}</button>
          </div>
        </div>
      )}

      {leaveConfirmOpen && (
        <div className="fixed inset-0 flex items-center justify-center px-8" style={{ zIndex: 200, background: 'rgba(20,14,18,.4)' }} onClick={confirmDiscard}>
          <div className="w-full max-w-xs rounded-2xl p-4" style={{ background: 'rgba(255,255,255,.98)', color: theme.text, boxShadow: '0 16px 48px rgba(0,0,0,.28)' }} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm leading-5">要把刚才的互动（{gestureSummaryPlain}）发给「{identity}」吗？</div>
            <div className="text-[11px] opacity-50 mt-1">会作为真实动作发进抱走它的原聊天窗，由它本人回应。</div>
            <div className="flex gap-2 mt-3">
              <button onClick={confirmDiscard} className="flex-1 py-2 rounded-xl text-sm" style={{ background: theme.primary + '12', color: theme.text }}>不用</button>
              <button onClick={confirmBringAlong} className="flex-1 py-2 rounded-xl text-sm font-semibold" style={{ background: theme.primary, color: 'white' }}>让他回应</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
