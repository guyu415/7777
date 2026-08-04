import { getMessages, saveMessage, useStore } from '../store'
import { streamChat } from './claude'
import { runMysteryTurn } from './companion'
import { resolveApiMemberConfig } from '../utils/groupApiMember'

// ─── Action catalog ───────────────────────────────────────────────────────
// Single source of truth for both the UI (labels/motion keyframes) and the
// model prompt (what actually happened) + mood bookkeeping (see below).
// `mood` deltas are added to the session-independent desktopPet mood
// counters in the store every time the action fires.
export const PET_ACTIONS = [
  { id: 'pet', label: '摸摸', mark: '♡', motion: 'pet', text: '用户摸了摸你的头。', mood: { affection: 1 } },
  { id: 'pinch', label: '捏脸', mark: 'ˋ', motion: 'pinch', text: '用户捏了捏你的脸。', mood: { affection: 1 } },
  { id: 'poke', label: '戳一戳', mark: '☝', motion: 'poke', text: '用户伸手指戳了戳你。', mood: { affection: 0, annoyance: 1 } },
  { id: 'bonk', label: '锤他', mark: '!', motion: 'bonk', text: '用户轻轻锤了你一下。', mood: { affection: -1, annoyance: 2 } },
  { id: 'lift', label: '拎后颈', mark: '？', motion: 'lift', text: '用户一把拎起了你的后颈。', mood: { affection: 0, annoyance: 0 } },
]

export function findAction(id) {
  return PET_ACTIONS.find((a) => a.id === id) || PET_ACTIONS[0]
}

// ─── Mood accumulation ────────────────────────────────────────────────────
// 一直锤它，它不会每次都独立生成一句反应——而是从"还能忍"到"真烦了"再到
// "直接躲开、不太想理你"；一直摸它则会越来越黏人。moodAffection/
// moodAnnoyance 是持久化在 store 里的两个 0-8 计数器，这里只是把它们换算
// 成一个当下的"心情档位"，供 systemPromptFor 塞进模型的 system prompt。
// 计数器本身随时间自然回落（每 10 分钟没有新互动就各退 1 格），避免"三年前
// 锤过一次"还在生模型的气。
const MOOD_DECAY_MS = 10 * 60 * 1000

export function effectiveMood(pet) {
  const elapsed = pet?.moodUpdatedAt ? Date.now() - pet.moodUpdatedAt : 0
  const decaySteps = Math.max(0, Math.floor(elapsed / MOOD_DECAY_MS))
  return {
    affection: Math.max(0, (pet?.moodAffection || 0) - decaySteps),
    annoyance: Math.max(0, (pet?.moodAnnoyance || 0) - decaySteps),
  }
}

export function moodTier(pet) {
  const { affection, annoyance } = effectiveMood(pet)
  if (annoyance >= 6) return 'furious'
  if (annoyance >= 3) return 'annoyed'
  if (affection >= 6) return 'clingy'
  if (affection >= 3) return 'warm'
  return 'neutral'
}

const MOOD_PROMPT = {
  furious: '它已经被连续骚扰得真的有点上火了，这次可以直接不耐烦地翻脸、警告或转身躲开，语气可以冲一点，不必顾着对方情绪。',
  annoyed: '它已经有点不耐烦了，反应可以带点嫌弃、抗议或阴阳怪气，但还没到翻脸的地步。',
  clingy: '它最近被顺毛顺习惯了，特别黏人，反应可以带点撒娇或得寸进尺，不太想让对方走开。',
  warm: '它今天心情不错，反应可以比平时稍微软一点、纵容一点。',
  neutral: '',
}

// 连续锤到 furious 档，短时间内（4 秒）再锤一下不再调用模型——直接从这几句
// 里随机挑一句当反应，既省额度，也更符合"真的懒得理你了"这件事本身。
const FURIOUS_DODGE_LINES = ['……', '别烦我', '滚开', '不想理你', '再锤试试']

export function pickFuriousDodgeLine() {
  return FURIOUS_DODGE_LINES[Math.floor(Math.random() * FURIOUS_DODGE_LINES.length)]
}

// ─── Reaction text cleanup ────────────────────────────────────────────────

function cleanReaction(text) {
  const value = String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[“”"'「」『』]/g, '')
    .replace(/\s+/g, '')
    .replace(/^(反应|回复|桌宠)[：:]/, '')
  return Array.from(value).slice(0, 10).join('') || '……'
}

// 自由聊天不是"几字反应"，不做逐字截断，只去掉包裹引号/标签并限制长度，
// 避免桌宠气泡显示一整段模型输出。
function cleanFreeReply(text) {
  const value = String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/^[“"'「『]+|[”"'」』]+$/g, '')
    .trim()
  return value.slice(0, 200) || '……'
}

// ─── Session context (memory) ─────────────────────────────────────────────

async function recentConversation(sessionId) {
  const all = await getMessages(sessionId)
  return (all || [])
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    .slice(-8)
    .map((m) => ({ role: m.role, type: 'text', content: m.content.slice(0, 800) }))
}

function systemPromptFor(session, memories, tier, sceneHint) {
  const identity = session?.aiName || session?.name || '桌宠'
  const historyText = memories.map((m) => `${m.role === 'user' ? '用户' : identity}：${m.content}`).join('\n')
  return [
    session?.systemPrompt?.trim() ? `你原本的人设：\n${session.systemPrompt.trim()}` : '',
    `你就是"${identity}"，不是用户，也不是别的模型。现在你暂时以用户身边的桌宠形态陪着用户，但性格、关系和记忆仍然属于你自己——被抱走只是换了个陪伴形式，不是变成另一个东西，也不是失忆重开的分身。`,
    session?.summary ? `你与用户的长期记忆摘要：\n${session.summary}` : '',
    historyText ? `你与用户最近的片段（含正式聊天和桌宠互动，只作关系背景）：\n${historyText}` : '',
    MOOD_PROMPT[tier] ? `你当前的状态：${MOOD_PROMPT[tier]}` : '',
    sceneHint ? `你顺带瞥到了一点当前屏幕上的情况（用户明确允许你看）：${sceneHint}` : '',
  ].filter(Boolean).join('\n\n')
}

// ─── Write-back ───────────────────────────────────────────────────────────
// 桌宠互动不是浮在空中的临时文字——落回真实会话的消息记录里，用户回去正式
// 聊天时对方"记得"刚才发生过什么。同一条会话当前若正开着，顺手也塞进内存
// 里的 messages，界面立刻能看到；不是当前会话就只写 IndexedDB，等用户回去
// 打开时自然从那读出来。
function petMessagePair(sessionId, userText, aiText) {
  const now = Date.now()
  const rand = () => Math.random().toString(36).slice(2, 8)
  return [
    { id: `pet-u-${now}-${rand()}`, conversationId: sessionId, role: 'user', type: 'text', content: userText, timestamp: now, streaming: false, petInteraction: true },
    { id: `pet-a-${now}-${rand()}`, conversationId: sessionId, role: 'assistant', type: 'text', content: aiText, timestamp: now + 1, streaming: false, petInteraction: true },
  ]
}

export async function recordPetInteraction(sessionId, userText, aiText) {
  const [userMsg, aiMsg] = petMessagePair(sessionId, userText, aiText)
  await saveMessage(userMsg)
  await saveMessage(aiMsg)
  const state = useStore.getState()
  if (state.currentSessionId === sessionId) {
    state.addMessage(userMsg)
    state.addMessage(aiMsg)
  }
}

// ─── Model calls ──────────────────────────────────────────────────────────

async function runReaction(session, systemPrompt, instruction, memories, signal) {
  if (session.providerName === 'claude-code-vps' || session.providerName === 'codex-vps') {
    const runtime = session.providerName === 'codex-vps' ? 'codex' : 'claude-code'
    return runMysteryTurn(`desktop-pet-${session.id}`, 'pet', runtime, session.model || '', systemPrompt, instruction, signal)
  }
  const globals = useStore.getState()
  const cfg = resolveApiMemberConfig(session, globals)
  if (!cfg.apiKey) throw new Error('这个会话还没有可用的 API Key')
  let fullText = ''
  for await (const chunk of streamChat({
    apiKey: cfg.apiKey,
    apiBaseUrl: cfg.baseUrl,
    model: cfg.model,
    systemPrompt,
    messages: [...memories, { role: 'user', type: 'text', content: instruction }],
    workerUrl: globals?.workerUrl,
    useWorkerProxy: globals?.useWorkerProxy,
    providerName: cfg.providerName,
    disableThinking: cfg.disableThinking,
    signal,
  })) {
    if (chunk.text) fullText += chunk.text
  }
  return fullText
}

/** Action button (摸/捏/戳/锤/拎) → bumps mood, calls the model, writes back. */
export async function getDesktopPetReaction({ action, session, signal, sceneHint }) {
  if (!session) throw new Error('请先给桌宠绑定一个会话')
  const actionDef = findAction(action)
  useStore.getState().bumpDesktopPetMood(actionDef.mood)
  const tier = moodTier(useStore.getState().desktopPet)
  const memories = await recentConversation(session.id)
  const systemPrompt = systemPromptFor(session, memories, tier, sceneHint)
  const instruction = `${actionDef.text}\n只输出你的短反应（2-10个汉字），不要解释、不要旁白。`
  const raw = await runReaction(session, systemPrompt, instruction, memories, signal)
  const text = cleanReaction(raw)
  await recordPetInteraction(session.id, actionDef.text, text)
  return text
}

/** Furious-dodge short circuit — no network call, still writes back so memory stays consistent. */
export async function recordDodgeLocally(session, action) {
  const actionDef = findAction(action)
  useStore.getState().bumpDesktopPetMood({ affection: 0, annoyance: 1 })
  const line = pickFuriousDodgeLine()
  await recordPetInteraction(session.id, actionDef.text, line)
  return line
}

/** Free-text "跟它说两句" — no mood delta of its own, just a real exchange. */
export async function getDesktopPetTextReply({ text, session, signal, sceneHint }) {
  if (!session) throw new Error('请先给桌宠绑定一个会话')
  const trimmed = String(text || '').trim()
  if (!trimmed) return ''
  const tier = moodTier(useStore.getState().desktopPet)
  const memories = await recentConversation(session.id)
  const systemPrompt = systemPromptFor(session, memories, tier, sceneHint)
  const instruction = `用户凑过来跟你说了一句话："${trimmed}"\n以桌宠此刻的状态自然回一句就好，别太长，不要写旁白或角色名前缀。`
  const raw = await runReaction(session, systemPrompt, instruction, memories, signal)
  const replyText = cleanFreeReply(raw)
  await recordPetInteraction(session.id, trimmed, replyText)
  return replyText
}
