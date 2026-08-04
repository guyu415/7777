import { getMessages, saveMessage, useStore } from '../../../../store'
import { saveSessionMsgs } from '../../../../services/sync'
import { cardLabel, rankLabel } from './cards'

function nameOf(game, index) {
  // A summary is read by several AIs. "我" makes every model identify itself
  // as the user, so the human seat is always named explicitly.
  if (index === 0) return '用户'
  return game.players?.[index]?.name || `玩家${index + 1}`
}

export function doudizhuSummary(game) {
  const landlord = nameOf(game, game.landlord)
  const bombs = game.history.filter((h) => h.type === 'play' && (h.handType === 'bomb' || h.handType === 'rocket')).length
  const winner = game.winnerRole === 'landlord' ? `地主 ${landlord}` : '农民阵营'
  const remaining = game.players.map((p, i) => `${nameOf(game, i)} ${p.hand.length}张`).join('、')
  const roster = game.players.map((_, i) => nameOf(game, i)).join('、')
  return {
    id: `summary-${game.id}`,
    gameId: game.id,
    game: '斗地主',
    text: `【斗地主对局摘要】\n参与者：${roster}\n地主：${landlord}｜获胜：${winner}\n炸弹/王炸：${bombs}次｜结束时剩牌：${remaining}`,
  }
}

export function zhajinhuaSummary(game) {
  const settle = [...game.history].reverse().find((h) => h.type === 'settle')
  const compares = game.history.filter((h) => h.type === 'compare').length
  const folds = game.history.filter((h) => h.type === 'fold').map((h) => nameOf(game, h.player))
  const reveal = settle?.reveal?.[game.winner]
  const winningCards = reveal?.length ? `｜胜牌：${reveal.map(cardLabel).join(' ')}` : ''
  const roster = game.players.map((_, i) => nameOf(game, i)).join('、')
  return {
    id: `summary-${game.id}`,
    gameId: game.id,
    game: '炸金花',
    text: `【炸金花对局摘要】\n参与者：${roster}\n获胜：${nameOf(game, game.winner)}${winningCards}\n比牌：${compares}次｜弃牌：${folds.length ? folds.join('、') : '无'}｜总操作：${game.actionsCount}次`,
  }
}

export function sichuanUpgradeSummary(game) {
  const dealerTeamNames = game.players.map((p, i) => ({ p, i })).filter(({ p }) => p.team === game.dealerTeam).map(({ i }) => nameOf(game, i)).join('、')
  const defenderTeam = game.dealerTeam === 0 ? 1 : 0
  const defenderNames = game.players.map((p, i) => ({ p, i })).filter(({ p }) => p.team === defenderTeam).map(({ i }) => nameOf(game, i)).join('、')
  const next = rankLabel(game.result?.nextLevelRank ?? game.levelRank)
  return {
    id: `summary-${game.id}`,
    gameId: game.id,
    game: '四川版升级',
    text: `【四川版升级对局摘要】\n本轮打${rankLabel(game.levelRank)}｜主花色：${game.trumpSuit || '未定'}｜庄家：${nameOf(game, game.dealer)}\n庄家队：${dealerTeamNames}｜抓分方：${defenderNames}\n闲家得分：${game.defenderScore}分｜${game.result?.description || '本轮结束'}｜下一轮打${next}`,
  }
}

// Explicit share only. Saving a summary never calls the target model; it is a
// visible user-side context note waiting in that session for a later chat.
export async function shareGameSummaryToSession(sessionId, summary) {
  if (!sessionId || !summary?.text) throw new Error('没有可分享的会话或摘要')
  const timestamp = Date.now()
  const msg = {
    id: `${summary.id}-${timestamp.toString(36)}`,
    conversationId: sessionId,
    role: 'user',
    type: 'text',
    content: summary.text,
    timestamp,
    gameSummary: true,
  }
  await saveMessage(msg)
  const state = useStore.getState()
  if (state.currentSessionId === sessionId) state.addMessage(msg)
  state.updateSession(sessionId, { lastMsgPreview: `${summary.game}对局摘要`, lastMsgTime: timestamp })

  const password = localStorage.getItem('auth.password')
  if (password) {
    const all = await getMessages(sessionId)
    all.sort((a, b) => a.timestamp - b.timestamp)
    await saveSessionMsgs(password, sessionId, all)
  }
  return msg
}
