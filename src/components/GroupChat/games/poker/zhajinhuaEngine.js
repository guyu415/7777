// 炸金花引擎——纯函数，写法和 mysteryEngine.js / doudizhuEngine.js 一致：
// UI（ZhajinhuaRoom.jsx）只负责"什么时候调"，规则判断、发牌、下注、比牌、
// 结算全部在这里。模型同样只能从这里枚举出的合法选项里选索引。
//
// 简化说明（有意为之，不是漏做）：真实桌面炸金花里"闷牌"（没看牌时下注按
// 明注一半计算）这套差异化赌注经济学没有实现——"看牌"在这个引擎里是一个
// 随时可做、不占用回合、不影响下注金额的纯展示/记录动作（对用户是"翻开自
// 己的牌"，对 AI 只是一个记录，不影响它的决策成本）。这样能完整满足"支持
// 看牌"这条要求，同时不引入闷注/明注两套下注金额换算的额外复杂度和潜在
// bug——需求里也没有要求这两者下注金额必须不同。

import { createDeck52, shuffle, cardLabel, newId, parseChoiceIndex } from './cards'

export { parseChoiceIndex }

const TYPE_LABEL = {
  leopard: '豹子', straightFlush: '同花顺', flush: '金花', straight: '顺子', pair: '对子', high: '散牌',
}
const TYPE_RANK = { leopard: 6, straightFlush: 5, flush: 4, straight: 3, pair: 2, high: 1 }

function sortForDisplay(cards) {
  return cards.slice().sort((a, b) => a.rank - b.rank)
}

// ---------------------------------------------------------------- 建局

export function createZhajinhuaGame(players, opts = {}) {
  if (!Array.isArray(players) || players.length !== 3) throw new Error('炸金花需要正好 3 位玩家')
  const startingChips = opts.startingChips ?? 1000
  const baseBet = opts.baseBet ?? 10
  const deck = shuffle(createDeck52())
  const dealt = players.map((p, i) => ({
    ...p,
    cards: sortForDisplay(deck.slice(i * 3, i * 3 + 3)),
    chips: startingChips - baseBet,
    folded: false,
    hasLooked: false,
    roundContribution: baseBet,
  }))
  return {
    id: newId('zjh'),
    kind: 'zhajinhua',
    runId: newId('zjhrun'),
    players: dealt,
    pot: baseBet * players.length,
    currentBet: baseBet,
    baseBet,
    turn: 0,
    phase: 'betting',
    history: [{ type: 'ante', amount: baseBet }],
    rule235: opts.rule235 !== false,
    actionsCount: 0,
    maxActions: opts.maxActions ?? 36,
    finished: false,
    winner: null,
    winReason: null,
    startedAt: Date.now(),
  }
}

export function restartZhajinhua(state) {
  const players = state.players.map((p) => ({ kind: p.kind, memberId: p.memberId, model: p.model, name: p.name }))
  return createZhajinhuaGame(players, { rule235: state.rule235, baseBet: state.baseBet, maxActions: state.maxActions })
}

// 看牌——随时可做，不占用下注回合，不影响任何金额，纯粹是"翻开自己的牌"
// 这件事本身（给用户用于揭示自己手牌的 UI，也给历史记录留痕）。
export function lookAtCards(state, playerIndex) {
  if (state.phase !== 'betting') throw new Error('当前不在下注阶段')
  const player = state.players[playerIndex]
  if (!player || player.folded) throw new Error('已经弃牌了，不能再看牌')
  if (player.hasLooked) return state
  return {
    ...state,
    players: state.players.map((p, i) => (i === playerIndex ? { ...p, hasLooked: true } : p)),
    history: [...state.history, { type: 'look', player: playerIndex }],
  }
}

function requireTurn(state, playerIndex) {
  if (state.phase !== 'betting') throw new Error('当前不在下注阶段')
  if (state.turn !== playerIndex) throw new Error('还没轮到这位玩家')
  if (state.players[playerIndex].folded) throw new Error('已经弃牌了')
}

// ---------------------------------------------------------------- 牌型判断/比较

// 顺子/同花顺的连续判定：普通 3 张连续点数(如 4-5-6)，或 A-2-3（视为最小的
// 顺子，比 2-3-4 还小）——ranks 必须是升序排列的 3 个不同点数。
function straightPower(ranks) {
  if (ranks[0] + 1 === ranks[1] && ranks[1] + 1 === ranks[2]) return ranks[0]
  if (ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 14) return 1
  return null
}

export function rankHand(cards) {
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b)
  const isFlush = new Set(cards.map((c) => c.suit)).size === 1
  const highPower = ranks[2] * 225 + ranks[1] * 15 + ranks[0]

  if (ranks[0] === ranks[1] && ranks[1] === ranks[2]) {
    return { type: 'leopard', typeRank: TYPE_RANK.leopard, power: ranks[0], cards }
  }
  const sp = straightPower(ranks)
  if (sp != null && isFlush) return { type: 'straightFlush', typeRank: TYPE_RANK.straightFlush, power: sp, cards }
  if (isFlush) return { type: 'flush', typeRank: TYPE_RANK.flush, power: highPower, cards }
  if (sp != null) return { type: 'straight', typeRank: TYPE_RANK.straight, power: sp, cards }
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    const pairRank = ranks[0] === ranks[1] ? ranks[0] : ranks[1]
    const kicker = ranks[0] === ranks[1] ? ranks[2] : ranks[0]
    return { type: 'pair', typeRank: TYPE_RANK.pair, power: pairRank * 15 + kicker, cards }
  }
  return { type: 'high', typeRank: TYPE_RANK.high, power: highPower, cards }
}

function isSpecial235(rankInfo) {
  if (rankInfo.type !== 'high') return false
  const ranks = rankInfo.cards.map((c) => c.rank).sort((a, b) => a - b)
  return ranks[0] === 2 && ranks[1] === 3 && ranks[2] === 5
}

// > 0 表示 a 赢，< 0 表示 b 赢，0 表示平（理论上极罕见，因为用的是同一副
// 52 张单副牌，三张全同点数+同花的组合不可能重复到打平，除非双方类型和
// power 都恰好一致——留着这个分支只是防御性的，不代表规则允许平局悬而不决）。
export function compareHandRank(a, b, rule235 = true) {
  if (rule235) {
    const aSpecial = isSpecial235(a)
    const bSpecial = isSpecial235(b)
    if (aSpecial && b.type === 'leopard') return 1
    if (bSpecial && a.type === 'leopard') return -1
  }
  if (a.typeRank !== b.typeRank) return a.typeRank - b.typeRank
  return a.power - b.power
}

// ---------------------------------------------------------------- 下注动作

function activeIndices(state) {
  return state.players.map((_, i) => i).filter((i) => !state.players[i].folded)
}

function finishGame(state, winnerIndex, reason, revealIndices) {
  const players = state.players.map((p, i) => (i === winnerIndex ? { ...p, chips: p.chips + state.pot } : p))
  const history = [...state.history, {
    type: 'settle',
    winner: winnerIndex,
    reason,
    reveal: revealIndices ? Object.fromEntries(revealIndices.map((i) => [i, state.players[i].cards])) : undefined,
  }]
  return { ...state, players, phase: 'finished', finished: true, winner: winnerIndex, winReason: reason, pot: 0, turn: null, history }
}

// 一人未弃牌时直接结算；轮数到了上限就强制摊牌（比较所有还在场的人的牌，
// 最大的赢）——这是"设置有限轮数，避免 AI 无限加注"这条要求的落地：
// 不是简单地不让加注，而是给了一个明确会把牌局带向结束的机制。
function advanceTurnOrResolve(state) {
  const active = activeIndices(state)
  if (active.length === 1) return finishGame(state, active[0], 'fold')
  if (state.actionsCount >= state.maxActions) {
    let best = active[0]
    for (const i of active.slice(1)) {
      if (compareHandRank(rankHand(state.players[i].cards), rankHand(state.players[best].cards), state.rule235) > 0) best = i
    }
    return finishGame(state, best, 'showdown', active)
  }
  let next = state.turn
  for (let step = 0; step < state.players.length; step++) {
    next = (next + 1) % state.players.length
    if (!state.players[next].folded) break
  }
  return { ...state, turn: next }
}

export function callBet(state, playerIndex, opts = {}) {
  requireTurn(state, playerIndex)
  const player = state.players[playerIndex]
  const owe = Math.max(state.currentBet - player.roundContribution, 0)
  const pay = Math.min(owe, player.chips)
  const players = state.players.map((p, i) => (i === playerIndex ? { ...p, chips: p.chips - pay, roundContribution: p.roundContribution + pay } : p))
  const history = [...state.history, { type: 'call', player: playerIndex, amount: pay, auto: !!opts.auto }]
  return advanceTurnOrResolve({ ...state, players, pot: state.pot + pay, history, actionsCount: state.actionsCount + 1 })
}

export function raiseBet(state, playerIndex, toAmount, opts = {}) {
  requireTurn(state, playerIndex)
  if (state.actionsCount >= state.maxActions) throw new Error('本局加注轮数已达上限，只能跟注/弃牌/比牌')
  if (!Number.isFinite(toAmount) || toAmount <= state.currentBet) throw new Error('加注金额必须高于当前注额')
  const player = state.players[playerIndex]
  const owe = toAmount - player.roundContribution
  if (owe <= 0) throw new Error('加注金额必须高于当前注额')
  const pay = Math.min(owe, player.chips)
  const actualTo = player.roundContribution + pay
  const players = state.players.map((p, i) => (i === playerIndex ? { ...p, chips: p.chips - pay, roundContribution: actualTo } : p))
  const history = [...state.history, { type: 'raise', player: playerIndex, amount: actualTo, auto: !!opts.auto }]
  return advanceTurnOrResolve({ ...state, players, pot: state.pot + pay, currentBet: Math.max(state.currentBet, actualTo), history, actionsCount: state.actionsCount + 1 })
}

export function fold(state, playerIndex, opts = {}) {
  requireTurn(state, playerIndex)
  const players = state.players.map((p, i) => (i === playerIndex ? { ...p, folded: true } : p))
  const history = [...state.history, { type: 'fold', player: playerIndex, auto: !!opts.auto }]
  return advanceTurnOrResolve({ ...state, players, history, actionsCount: state.actionsCount + 1 })
}

// 比牌：挑战者出双倍当前注额，双方摊牌，输的人直接出局（视同弃牌），赢的人
// 留在场上继续。只有这两个人的牌会被揭示（history 里带 reveal），别人的牌
// 不受影响，还是隐藏的。
export function compareHands(state, challengerIndex, targetIndex, opts = {}) {
  requireTurn(state, challengerIndex)
  const target = state.players[targetIndex]
  if (challengerIndex === targetIndex) throw new Error('不能跟自己比牌')
  if (!target || target.folded) throw new Error('对方不在牌局中，不能比牌')
  const challenger = state.players[challengerIndex]
  const cost = state.currentBet * 2
  const owe = Math.max(cost - challenger.roundContribution, 0)
  const pay = Math.min(owe, challenger.chips)

  const challengerWins = compareHandRank(rankHand(challenger.cards), rankHand(target.cards), state.rule235) > 0
  const loserIndex = challengerWins ? targetIndex : challengerIndex

  const players = state.players
    .map((p, i) => (i === challengerIndex ? { ...p, chips: p.chips - pay, roundContribution: p.roundContribution + pay } : p))
    .map((p, i) => (i === loserIndex ? { ...p, folded: true } : p))
  const history = [...state.history, {
    type: 'compare', player: challengerIndex, target: targetIndex,
    result: challengerWins ? 'challenger' : 'target',
    reveal: { [challengerIndex]: challenger.cards, [targetIndex]: target.cards },
    auto: !!opts.auto,
  }]
  return advanceTurnOrResolve({ ...state, players, pot: state.pot + pay, history, actionsCount: state.actionsCount + 1 })
}

// ---------------------------------------------------------------- 合法操作枚举/托管

// 返回这一轮真正可选的动作列表（供 UI 按钮和 AI 提示词共用同一份数据）。
// 'look' 不在这里——它不占用回合，随时可做，房间组件单独处理。
export function enumerateZhajinhuaActions(state, playerIndex) {
  const player = state.players[playerIndex]
  const callAmount = Math.max(state.currentBet - player.roundContribution, 0)
  const actions = [{ type: 'fold' }, { type: 'call', amount: callAmount }]
  if (state.actionsCount < state.maxActions) {
    actions.push({ type: 'raise', amount: state.currentBet + state.baseBet })
    actions.push({ type: 'raise', amount: state.currentBet + state.baseBet * 2 })
  }
  for (const t of activeIndices(state)) {
    if (t !== playerIndex) actions.push({ type: 'compare', target: t })
  }
  return actions
}

export function applyZhajinhuaAction(state, playerIndex, action, opts = {}) {
  if (!action || action.type === 'fold') return fold(state, playerIndex, opts)
  if (action.type === 'call') return callBet(state, playerIndex, opts)
  if (action.type === 'raise') return raiseBet(state, playerIndex, action.amount, opts)
  if (action.type === 'compare') return compareHands(state, playerIndex, action.target, opts)
  throw new Error('未知的操作类型')
}

// 托管兜底：跟注金额在自己筹码承受范围内就跟注（最保守、最不容易一步送出
// 全部筹码的选择）；跟注金额已经占到自己筹码一大半，托管就直接弃牌，
// 不替用户/群成员去赌大的。
export function autoChooseZhajinhuaAction(state, playerIndex) {
  const player = state.players[playerIndex]
  const callAmount = Math.max(state.currentBet - player.roundContribution, 0)
  if (player.chips > 0 && callAmount > player.chips * 0.6) return { type: 'fold' }
  return { type: 'call' }
}

// ---------------------------------------------------------------- AI 提示词构造

function describeHistoryEntry(h) {
  if (h.type === 'ante') return `每人底注 ${h.amount}`
  if (h.type === 'look') return `玩家${h.player}看了牌`
  if (h.type === 'call') return `玩家${h.player}跟注${h.amount}`
  if (h.type === 'raise') return `玩家${h.player}加注到${h.amount}`
  if (h.type === 'fold') return `玩家${h.player}弃牌`
  if (h.type === 'compare') return `玩家${h.player}向玩家${h.target}比牌，${h.result === 'challenger' ? '玩家' + h.player : '玩家' + h.target}赢`
  if (h.type === 'settle') return `结算：玩家${h.winner}赢得彩池`
  return ''
}

export function buildZhajinhuaPrompt(state, playerIndex) {
  const player = state.players[playerIndex]
  const handText = player.cards.map(cardLabel).join(' ')
  const actions = enumerateZhajinhuaActions(state, playerIndex)
  const recent = state.history.slice(-8).map(describeHistoryEntry).filter(Boolean).join('；')
  const optionLines = actions.map((a, i) => {
    if (a.type === 'fold') return `${i}：弃牌`
    if (a.type === 'call') return `${i}：跟注（需要投入 ${a.amount}）`
    if (a.type === 'raise') return `${i}：加注到 ${a.amount}`
    if (a.type === 'compare') return `${i}：向玩家${a.target}比牌（需要投入 ${state.currentBet * 2}，输的人直接出局）`
    return ''
  })
  return [
    `虚拟筹码桌上的炸金花。你当前筹码：${player.chips}，彩池：${state.pot}，当前注额：${state.currentBet}。`,
    `你的手牌：${handText}`,
    recent ? `最近的动作：${recent}` : '',
    '请从以下合法选项里选一个，直接回复选项前面的数字，不要输出任何其它内容：',
    ...optionLines,
  ].filter(Boolean).join('\n')
}

export { TYPE_LABEL as HAND_TYPE_LABEL }
