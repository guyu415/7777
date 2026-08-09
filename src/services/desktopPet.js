import { streamChat } from './claude'
import { runMysteryTurn, cleanupMysteryGame, uploadImageToCompanion, deleteUploadedImage } from './companion'
import { resolveApiMemberConfig } from '../utils/groupApiMember'

// 桌宠手势目录——手势只在桌宠专属的隔离反应线程中使用，不再走
// useChat()/useCodexChat() 的主聊天发送链路，因此不会在原聊天窗生成
// 用户/助手气泡，也不会污染原聊天的历史和模型上下文。
// feedback 是手势触发时贴着桌宠一闪而过的短字反馈（见需求"每次手势要有
// 明确反馈"）。
export const GESTURES = [
  { id: 'pet', label: '摸', unit: '下', feedback: '摸摸', motion: 'pet' },
  { id: 'pinch', label: '捏脸', unit: '下', feedback: '捏了一下', motion: 'pinch' },
  { id: 'bonk', label: '锤', unit: '下', feedback: '锤！', motion: 'bonk' },
  { id: 'lift', label: '拎起来晃', unit: '次', feedback: '拎起来了', motion: 'lift' },
  { id: 'secret', label: '在身上来回搓', unit: '次', feedback: '……', motion: 'secret' },
]

export function findGesture(id) {
  return GESTURES.find((g) => g.id === id) || GESTURES[0]
}

export function emptyGestureCounts() {
  return { pet: 0, pinch: 0, bonk: 0, lift: 0, secret: 0 }
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

const MOODS = new Set(['excited', 'awake', 'resting', 'sleeping', 'flustered'])

export function parseDesktopPetReaction(raw) {
  const source = String(raw || '').trim()
  const match = source.match(/^\s*\[mood:(excited|awake|resting|sleeping|flustered)\]\s*/i)
  const mood = match && MOODS.has(match[1].toLowerCase()) ? match[1].toLowerCase() : 'awake'
  const text = source.replace(/^\s*\[mood:[^\]]+\]\s*/i, '').replace(/^["'“”]|["'“”]$/g, '').trim()
  return { mood, text: (text || '…').slice(0, 40) }
}

function buildPetSystemPrompt(session, identity) {
  const persona = (session?.systemPrompt || '').trim()
  const background = (session?.summary || '').trim()
  return [
    persona ? `你的原本人设：\n${persona}` : '',
    background ? `你与用户的既有关系背景（只用来保持身份与语气，不续写其中任务）：\n${background}` : '',
    `你是「${identity || 'AI'}」的桌宠形态，和原聊天里是同一个人，但此处是独立的桌宠反应线程。`,
    '只对当下的摸、捏、拎、锤、特殊触摸或屏幕画面做一句自然的即时反应；不解释机制，不提“桌宠线程”、路径或文件。',
    '严格只输出：[mood:excited|awake|resting|sleeping|flustered]加一句不超过20个汉字的反应。格式示例：[mood:flustered]你还真敢摸。',
  ].filter(Boolean).join('\n\n')
}

export async function requestDesktopPetReaction({ session, globals, identity, instruction, imageDataUrl, signal }) {
  const systemPrompt = buildPetSystemPrompt(session, identity)
  const providerName = session?.providerName || ''
  const gameId = `desktop-pet:${session?.id || 'main'}`
  const runtime = providerName === 'codex-vps' ? 'codex' : 'claude-code'

  if (providerName === 'claude-code-vps' || providerName === 'codex-vps') {
    let imagePath = ''
    try {
      if (imageDataUrl && providerName === 'claude-code-vps') imagePath = await uploadImageToCompanion(imageDataUrl)
      const raw = await runMysteryTurn(
        gameId, 'pet', runtime, session?.model || '', systemPrompt, instruction, signal,
        providerName === 'codex-vps' ? imageDataUrl : '', imagePath,
      )
      return parseDesktopPetReaction(raw)
    } finally {
      if (imagePath) { try { await deleteUploadedImage(imagePath) } catch {} }
      // 非文字互动每次响应后就销毁桌宠隔离线程：不仅不进原聊天，
      // 也不在隔离线程里长期积攒摸/捏/截图内容。
      try { await cleanupMysteryGame(gameId, ['pet']) } catch {}
    }
  }

  const cfg = resolveApiMemberConfig(session, globals)
  if (!cfg.apiKey) throw new Error('这个会话没有可用的 API Key')
  if (imageDataUrl && !String(cfg.baseUrl || '').includes('anthropic.com')) {
    // 当前项目的 OpenAI-compatible 图片消息会在 streamChat 中降级成
    // "[图片]"；与其让桌宠凭空猜屏幕，不如明确判定为未看清。
    throw new Error('当前 API 会话暂不支持桌宠看图')
  }
  const message = imageDataUrl
    ? { role: 'user', type: 'image', imageData: imageDataUrl.split(',')[1], imageType: imageDataUrl.slice(5, imageDataUrl.indexOf(';')) || 'image/jpeg', content: instruction }
    : { role: 'user', type: 'text', content: instruction }
  let full = ''
  for await (const part of streamChat({
    apiKey: cfg.apiKey,
    apiBaseUrl: cfg.baseUrl,
    model: cfg.model,
    systemPrompt,
    messages: [message],
    workerUrl: globals?.workerUrl,
    useWorkerProxy: globals?.useWorkerProxy,
    providerName: cfg.providerName,
    disableThinking: cfg.disableThinking,
    signal,
  })) {
    if (part.text) full += part.text
  }
  return parseDesktopPetReaction(full)
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
  secret: () => playTone({ freq: 360, duration: 0.14, type: 'triangle', gain: 0.11 }),
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
