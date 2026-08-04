import { getMessages } from '../store'
import { streamChat } from './claude'
import { runMysteryTurn } from './companion'
import { resolveApiMemberConfig } from '../utils/groupApiMember'

const ACTION_TEXT = {
  pet: '用户摸了摸你的头。',
  pinch: '用户捏了捏你的脸。',
  bonk: '用户轻轻锤了你一下。',
  lift: '用户把你拎起来又放下。',
}

function cleanReaction(text) {
  const value = String(text || '')
    .replace(/<[^>]+>/g, '')
    .replace(/[“”"'「」『』]/g, '')
    .replace(/\s+/g, '')
    .replace(/^(反应|回复|桌宠)[：:]/, '')
  return Array.from(value).slice(0, 10).join('') || '……'
}

function recentConversation(messages) {
  return (messages || [])
    .filter((message) => (message.role === 'user' || message.role === 'assistant') && typeof message.content === 'string' && message.content.trim())
    .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    .slice(-8)
    .map((message) => ({ role: message.role, type: 'text', content: message.content.slice(0, 800) }))
}

function systemPromptFor(session, memories) {
  const identity = session?.aiName || session?.name || '桌宠'
  const historyText = memories.map((message) => `${message.role === 'user' ? '用户' : identity}：${message.content}`).join('\n')
  return [
    session?.systemPrompt?.trim() ? `你原本的人设：\n${session.systemPrompt.trim()}` : '',
    `你就是“${identity}”，不是用户，也不是别的模型。现在你暂时以用户身边的黑发桌宠形态陪着用户，但性格、关系和记忆仍然属于你自己。`,
    session?.summary ? `你与用户的长期记忆摘要：\n${session.summary}` : '',
    historyText ? `你与用户最近的私聊片段（只作关系背景）：\n${historyText}` : '',
    '用户刚对桌宠做了一个动作。请按你自己的性格真实反应，只说一句2—10个汉字的即时反应；可以别扭、嫌弃、纵容或还嘴。不要解说动作，不要写旁白、引号、角色名、括号或标签，不要自称AI。',
  ].filter(Boolean).join('\n\n')
}

export async function getDesktopPetReaction({ action, session, globals, signal }) {
  if (!session) throw new Error('请先给桌宠绑定一个会话')
  const allMessages = await getMessages(session.id)
  const memories = recentConversation(allMessages)
  const systemPrompt = systemPromptFor(session, memories)
  const instruction = `${ACTION_TEXT[action] || ACTION_TEXT.pet}\n只输出你的短反应。`

  if (session.providerName === 'claude-code-vps' || session.providerName === 'codex-vps') {
    const runtime = session.providerName === 'codex-vps' ? 'codex' : 'claude-code'
    const text = await runMysteryTurn(`desktop-pet-${session.id}`, 'pet', runtime, session.model || '', systemPrompt, instruction, signal)
    return cleanReaction(text)
  }

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
  return cleanReaction(fullText)
}
