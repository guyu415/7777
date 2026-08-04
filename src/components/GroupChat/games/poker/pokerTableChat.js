import { callSeatForPokerDecision, cleanupStuckSeat } from './pokerAiCall'

export const POKER_CHAT_LIMIT = 10
export const pokerChatCharId = (seatIndex) => `tablechat-seat${seatIndex}`

export function limitPokerChat(text) {
  return Array.from(String(text || '').trim()).slice(0, POKER_CHAT_LIMIT).join('')
}

function cleanModelReply(raw) {
  let text = String(raw || '').trim().split(/\r?\n/)[0] || ''
  text = text.replace(/^(回复|回答|我说|台词)\s*[:：]\s*/u, '').replace(/^[“”"'「」]+|[“”"'「」]+$/gu, '').trim()
  return limitPokerChat(text)
}

function speakerName(game, index) {
  return index === 0 ? '用户' : (game.players[index]?.name || `玩家${index + 1}`)
}

export async function requestPokerChatReplies({ game, gameLabel, userText, sessions, globals }) {
  const recent = [...(game.tableChat || []), { player: 0, text: userText }].slice(-10)
  const seats = game.players.map((seat, index) => ({ seat, index })).filter(({ seat }) => seat.kind === 'ai')
  const roster = game.players.map((_, i) => `${i + 1}号位=${speakerName(game, i)}`).join('；')

  const replies = await Promise.all(seats.map(async ({ seat, index }) => {
    const identity = speakerName(game, index)
    const systemPrompt = [
      `你正在和用户玩${gameLabel}。你的身份是“${identity}”，位于${index + 1}号座。`,
      `牌桌成员：${roster}。其中“用户”是真人；你只能代表“${identity}”说话，绝不能把自己当成用户或其他玩家。`,
      '现在是独立的牌桌闲聊，不是出牌决策。禁止报牌、猜牌、分析策略、解释规则、解说回合或说明自己为什么出牌。',
      `只说一句自然的情绪反应、打趣或接话，最多${POKER_CHAT_LIMIT}个字。不要加名字前缀，不要换行。`,
    ].join('\n')
    const history = recent.map((m) => `${speakerName(game, m.player)}：${m.text}`).join('\n')
    const turnPrompt = `最近牌桌闲聊：\n${history}\n\n现在请以“${identity}”的身份接一句。`
    try {
      const raw = await callSeatForPokerDecision({ runId: game.runId, charId: pokerChatCharId(index), seat, sessions, globals, systemPrompt, turnPrompt })
      const text = cleanModelReply(raw)
      return text ? { player: index, text } : null
    } catch {
      cleanupStuckSeat(game.runId, pokerChatCharId(index), seat)
      return null
    }
  }))
  return replies.filter(Boolean)
}
