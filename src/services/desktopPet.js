// 桌宠手势目录——纯数据，不含任何模型调用逻辑。真正的"回应"完全走
// useChat()/useCodexChat() 这条和主聊天窗一模一样的真实链路（见
// DesktopPet.jsx），这里只负责：手势 id → 本地动效/标记，以及把累计的
// 手势次数汇总成一句话交给那条真实链路。
// feedback 是手势触发时贴着桌宠一闪而过的短字反馈（见需求"每次手势要有
// 明确反馈"）。
export const GESTURES = [
  { id: 'pet', label: '摸', unit: '下', feedback: '摸摸', motion: 'pet' },
  { id: 'pinch', label: '捏脸', unit: '下', feedback: '捏了一下', motion: 'pinch' },
  { id: 'bonk', label: '锤', unit: '下', feedback: '锤！', motion: 'bonk' },
  { id: 'lift', label: '拎起来晃', unit: '次', feedback: '拎起来了', motion: 'lift' },
]

export function findGesture(id) {
  return GESTURES.find((g) => g.id === id) || GESTURES[0]
}

export function emptyGestureCounts() {
  return { pet: 0, pinch: 0, bonk: 0, lift: 0 }
}

export function totalGestureCount(counts) {
  return GESTURES.reduce((sum, g) => sum + (counts[g.id] || 0), 0)
}

// 用于真实发给模型那条消息——主聊天窗里 <i>动作内容</i> 已经是被
// MessageBubble 支持的"动作描写"格式（见 ChatWindow 的 renderWithActions），
// 这里直接复用，不需要新样式。
export function buildGestureReport(counts) {
  const parts = GESTURES
    .filter((g) => counts[g.id] > 0)
    .map((g) => `${g.label}了${counts[g.id]}${g.unit}`)
  if (!parts.length) return ''
  return `<i>${parts.join('，')}</i>`
}

// 用于"要不要带上"确认弹窗里给用户看的大白话版本（不带 <i> 标签）。
export function describeGestureCounts(counts) {
  const parts = GESTURES
    .filter((g) => counts[g.id] > 0)
    .map((g) => `${g.label}了${counts[g.id]}${g.unit}`)
  return parts.join('、')
}

// ─── 手势音效 ──────────────────────────────────────────────────────────────
// 应用里目前没有现成的全局静音开关，这几声短音效就用桌宠自己设置里的
// sfxEnabled 当"静音设置"。没有音频素材文件——用 Web Audio 现合成几个短
// 音，不额外占包体，触发点都在真实的指针/触摸事件回调里，满足浏览器
// autoplay 门槛。

let sfxCtx = null
function getSfxContext() {
  const Ctor = window.AudioContext || window.webkitAudioContext
  if (!Ctor) return null
  if (!sfxCtx) sfxCtx = new Ctor()
  if (sfxCtx.state === 'suspended') sfxCtx.resume().catch(() => {})
  return sfxCtx
}

function playTone({ freq, duration, type = 'sine', gain = 0.15 }) {
  const ctx = getSfxContext()
  if (!ctx) return
  try {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    osc.connect(g)
    g.connect(ctx.destination)
    const now = ctx.currentTime
    g.gain.setValueAtTime(gain, now)
    g.gain.exponentialRampToValueAtTime(0.001, now + duration)
    osc.start(now)
    osc.stop(now + duration)
  } catch {
    // 静默失败——音效是锦上添花，不该因为 AudioContext 出问题打断手势本身
  }
}

const GESTURE_SFX = {
  pet: () => playTone({ freq: 620, duration: 0.12, type: 'sine', gain: 0.13 }),
  pinch: () => playTone({ freq: 480, duration: 0.1, type: 'triangle', gain: 0.14 }),
  bonk: () => playTone({ freq: 190, duration: 0.16, type: 'square', gain: 0.18 }),
  lift: () => playTone({ freq: 760, duration: 0.13, type: 'sine', gain: 0.12 }),
}

export function playGestureSfx(gestureId, enabled) {
  if (!enabled) return
  ;(GESTURE_SFX[gestureId] || GESTURE_SFX.pet)()
}

// 连点攒锤过程中、还没攒够阈值的那几下——给个更轻更短的"滴"声，和真正
// 触发时的音效明显不同，让人分得清自己点到第几下。
export function playLightTapSfx(enabled) {
  if (!enabled) return
  playTone({ freq: 900, duration: 0.045, type: 'sine', gain: 0.07 })
}
