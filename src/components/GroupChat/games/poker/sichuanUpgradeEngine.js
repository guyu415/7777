import { cardLabel, createDeck54, newId, parseChoiceIndex, rankLabel, shuffle } from './cards'

export { parseChoiceIndex }

export const LEVEL_ORDER = [14, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]

export function nextLevel(rank, steps = 1) {
  const index = LEVEL_ORDER.indexOf(rank)
  if (index < 0) throw new Error('未知级牌')
  const raw = index + steps
  return { rank: LEVEL_ORDER[raw % LEVEL_ORDER.length], completed: raw >= LEVEL_ORDER.length }
}

function scoreOf(card) {
  if (card.rank === 5) return 5
  if (card.rank === 10 || card.rank === 13) return 10
  return 0
}

function basePower(rank) {
  if (rank === 2) return 15
  return rank
}

export function isTrump(card, state) {
  return card.suit === 'joker' || card.rank === state.levelRank || card.suit === state.trumpSuit
}

export function effectiveSuit(card, state) {
  return isTrump(card, state) ? 'trump' : card.suit
}

export function trumpPower(card, state) {
  if (card.rank === 17) return 100
  if (card.rank === 16) return 90
  if (card.rank === state.levelRank && card.suit === state.trumpSuit) return 80
  if (card.rank === state.levelRank) return 70
  return 20 + basePower(card.rank)
}

export function compareTrickCards(a, b, leadSuit, state) {
  const aSuit = effectiveSuit(a, state)
  const bSuit = effectiveSuit(b, state)
  if (aSuit === 'trump' && bSuit !== 'trump') return 1
  if (aSuit !== 'trump' && bSuit === 'trump') return -1
  if (aSuit === 'trump' && bSuit === 'trump') return trumpPower(a, state) - trumpPower(b, state)
  if (aSuit === leadSuit && bSuit !== leadSuit) return 1
  if (aSuit !== leadSuit && bSuit === leadSuit) return -1
  if (aSuit !== bSuit) return 0
  return basePower(a.rank) - basePower(b.rank)
}

function sortForDisplay(cards, state) {
  return cards.slice().sort((a, b) => {
    const at = isTrump(a, state)
    const bt = isTrump(b, state)
    if (at !== bt) return at ? 1 : -1
    if (at) return trumpPower(a, state) - trumpPower(b, state)
    if (a.suit !== b.suit) return a.suit.localeCompare(b.suit)
    return basePower(a.rank) - basePower(b.rank)
  })
}

function dealRound(players, levelRank, dealer, rng = Math.random) {
  const deck = shuffle(createDeck54(), rng)
  const dealCards = deck.slice(0, 48)
  const bottomCards = deck.slice(48)
  const hands = [[], [], [], []]
  const callQueue = []
  for (let i = 0; i < dealCards.length; i++) {
    const seat = (dealer + i) % 4
    const card = dealCards[i]
    hands[seat].push(card)
    if (card.rank === levelRank) callQueue.push({ seat, cardId: card.id, suit: card.suit, order: i })
  }
  const shell = { levelRank, trumpSuit: null }
  return {
    players: players.map((p, i) => ({ ...p, team: i % 2, hand: sortForDisplay(hands[i], shell) })),
    bottomCards,
    callQueue,
  }
}

export function createSichuanUpgradeGame(players, opts = {}) {
  if (!Array.isArray(players) || players.length !== 4) throw new Error('四川版升级需要正好4位玩家')
  const dealer = opts.dealer ?? 0
  const levelRank = opts.levelRank ?? 14
  const dealt = dealRound(players, levelRank, dealer, opts.rng)
  if (!dealt.callQueue.length) return createSichuanUpgradeGame(players, { ...opts, rng: undefined })
  return {
    id: newId('scup'), kind: 'sichuan_upgrade', runId: newId('scuprun'),
    players: dealt.players,
    dealer,
    dealerTeam: dealer % 2,
    levelRank,
    trumpSuit: null,
    trumpCaller: null,
    bottomCards: dealt.bottomCards,
    revealedBottom: [],
    buriedCards: [],
    callQueue: dealt.callQueue,
    callCursor: 0,
    phase: 'calling',
    turn: dealt.callQueue[0].seat,
    trick: [],
    trickNo: 0,
    defenderScore: 0,
    history: [],
    finished: false,
    result: null,
    startedAt: Date.now(),
  }
}

export function restartSichuanUpgrade(state) {
  const players = state.players.map(({ kind, memberId, model, name }) => ({ kind, memberId, model, name }))
  const nextRank = state.result?.nextLevelRank ?? state.levelRank
  const nextDealer = state.result?.nextDealer ?? state.dealer
  return createSichuanUpgradeGame(players, { levelRank: nextRank, dealer: nextDealer })
}

function redeal(state) {
  const players = state.players.map(({ kind, memberId, model, name }) => ({ kind, memberId, model, name }))
  const next = createSichuanUpgradeGame(players, { levelRank: state.levelRank, dealer: state.dealer })
  return { ...next, history: [...state.history, { type: 'redeal' }] }
}

export function currentCallOption(state) {
  return state.callQueue[state.callCursor] || null
}

export function callTrump(state, playerIndex, accept, opts = {}) {
  if (state.phase !== 'calling') throw new Error('当前不在叫主阶段')
  const option = currentCallOption(state)
  if (!option || option.seat !== playerIndex || state.turn !== playerIndex) throw new Error('还没轮到这位玩家叫主')
  const history = [...state.history, { type: accept ? 'call' : 'decline_call', player: playerIndex, suit: option.suit, auto: !!opts.auto }]
  if (accept) {
    const players = state.players.map((p, i) => i === state.dealer
      ? { ...p, hand: sortForDisplay([...p.hand, ...state.bottomCards], { ...state, trumpSuit: option.suit }) }
      : { ...p, hand: sortForDisplay(p.hand, { ...state, trumpSuit: option.suit }) })
    return {
      ...state, players, trumpSuit: option.suit, trumpCaller: playerIndex,
      revealedBottom: state.bottomCards.slice(), phase: 'burying', turn: state.dealer, history,
    }
  }
  const cursor = state.callCursor + 1
  if (cursor >= state.callQueue.length) return redeal({ ...state, history })
  return { ...state, callCursor: cursor, turn: state.callQueue[cursor].seat, history }
}

export function autoChooseCall(state, playerIndex) {
  const player = state.players[playerIndex]
  const option = currentCallOption(state)
  const highTrumps = player.hand.filter((c) => c.suit === 'joker' || c.rank === state.levelRank || c.suit === option?.suit).length
  return highTrumps >= 4
}

function buryValue(card, state) {
  let value = basePower(card.rank)
  if (scoreOf(card)) value += 35
  if (isTrump(card, state)) value += 60
  return value
}

export function autoChooseBury(state, playerIndex) {
  return state.players[playerIndex].hand.slice().sort((a, b) => buryValue(a, state) - buryValue(b, state)).slice(0, 6).map((c) => c.id)
}

export function buryCards(state, playerIndex, cardIds, opts = {}) {
  if (state.phase !== 'burying' || state.turn !== playerIndex || playerIndex !== state.dealer) throw new Error('现在不是庄家换底牌的阶段')
  if (!Array.isArray(cardIds) || new Set(cardIds).size !== 6) throw new Error('必须正好换下6张牌')
  const hand = state.players[playerIndex].hand
  const idSet = new Set(cardIds)
  const buried = hand.filter((c) => idSet.has(c.id))
  if (buried.length !== 6) throw new Error('选择的牌不在庄家手牌中')
  const players = state.players.map((p, i) => i === playerIndex ? { ...p, hand: sortForDisplay(p.hand.filter((c) => !idSet.has(c.id)), state) } : p)
  return {
    ...state, players, buriedCards: buried, phase: 'playing', turn: state.dealer,
    history: [...state.history, { type: 'bury', player: playerIndex, cards: buried, auto: !!opts.auto }],
  }
}

export function enumerateLegalCards(state, playerIndex) {
  if (state.phase !== 'playing' || state.turn !== playerIndex) return []
  const hand = state.players[playerIndex].hand
  if (!state.trick.length) return hand
  const leadSuit = effectiveSuit(state.trick[0].card, state)
  const matching = hand.filter((c) => effectiveSuit(c, state) === leadSuit)
  return matching.length ? matching : hand
}

export function settleUpgradeRound(state) {
  const score = state.defenderScore
  let winnerTeam
  let steps
  let nextDealer
  let description
  if (score === 0) {
    winnerTeam = state.dealerTeam; steps = 2; nextDealer = (state.dealer + 2) % 4
    description = '庄家队守庄成功，连升两级'
  } else if (score < 45) {
    winnerTeam = state.dealerTeam; steps = 1; nextDealer = (state.dealer + 2) % 4
    description = '庄家队守庄成功，升一级'
  } else if (score < 55) {
    winnerTeam = 1 - state.dealerTeam; steps = 0; nextDealer = (state.dealer + 1) % 4
    description = '闲家队上台，本级重打'
  } else {
    winnerTeam = 1 - state.dealerTeam; steps = 1; nextDealer = (state.dealer + 1) % 4
    description = '闲家队上台并升一级'
  }
  const level = nextLevel(state.levelRank, steps)
  const result = { winnerTeam, steps, nextDealer, nextLevelRank: level.rank, completed: level.completed, description }
  return { ...state, phase: 'finished', finished: true, turn: null, result, history: [...state.history, { type: 'settle', ...result, defenderScore: score }] }
}

export function playUpgradeCard(state, playerIndex, cardId, opts = {}) {
  if (state.phase !== 'playing' || state.turn !== playerIndex) throw new Error('还没轮到这位玩家出牌')
  const legal = enumerateLegalCards(state, playerIndex)
  const card = legal.find((c) => c.id === cardId)
  if (!card) throw new Error('必须跟随首家花色')
  const players = state.players.map((p, i) => i === playerIndex ? { ...p, hand: p.hand.filter((c) => c.id !== cardId) } : p)
  const trick = [...state.trick, { player: playerIndex, card }]
  const history = [...state.history, { type: 'play', player: playerIndex, cards: [card], auto: !!opts.auto }]
  if (trick.length < 4) return { ...state, players, trick, history, turn: (playerIndex + 1) % 4 }

  const leadSuit = effectiveSuit(trick[0].card, state)
  let winner = trick[0]
  for (const item of trick.slice(1)) {
    if (compareTrickCards(item.card, winner.card, leadSuit, state) > 0) winner = item
  }
  const trickScore = trick.reduce((sum, item) => sum + scoreOf(item.card), 0)
  const wonByDefender = state.players[winner.player].team !== state.dealerTeam
  const defenderScore = state.defenderScore + (wonByDefender ? trickScore : 0)
  const afterTrick = {
    ...state, players, trick: [], trickNo: state.trickNo + 1, turn: winner.player, defenderScore,
    history: [...history, { type: 'trick', winner: winner.player, score: trickScore, defenderWon: wonByDefender }],
  }
  return players.every((p) => p.hand.length === 0) ? settleUpgradeRound(afterTrick) : afterTrick
}

export function autoChoosePlay(state, playerIndex) {
  const legal = enumerateLegalCards(state, playerIndex)
  return legal.slice().sort((a, b) => {
    const pointDiff = scoreOf(a) - scoreOf(b)
    if (pointDiff) return pointDiff
    const at = isTrump(a, state) ? 1 : 0
    const bt = isTrump(b, state) ? 1 : 0
    if (at !== bt) return at - bt
    return basePower(a.rank) - basePower(b.rank)
  })[0]?.id
}

export function buildCallPrompt(state, playerIndex) {
  const option = currentCallOption(state)
  return [
    `四川版升级，本轮打${rankLabel(state.levelRank)}。`,
    `你的手牌：${state.players[playerIndex].hand.map(cardLabel).join(' ')}`,
    `你刚摸到${cardLabel(state.players[playerIndex].hand.find((c) => c.id === option.cardId))}，可以用它叫${option.suit}为主。`,
    '只回复数字：0=不叫，1=叫主。',
  ].join('\n')
}

export function buildBuryPrompt(state, playerIndex) {
  const hand = state.players[playerIndex].hand
  const candidates = []
  const preferred = hand.slice().sort((a, b) => buryValue(a, state) - buryValue(b, state))
  for (let offset = 0; offset < Math.min(8, preferred.length - 5); offset++) {
    const cards = preferred.slice(offset, offset + 6)
    if (!candidates.some((c) => c.map((x) => x.id).sort().join() === cards.map((x) => x.id).sort().join())) candidates.push(cards)
  }
  return {
    options: candidates.map((cards) => cards.map((c) => c.id)),
    prompt: [
      `你是庄家，本轮打${rankLabel(state.levelRank)}，${state.trumpSuit}为主。底牌已公开。`,
      `你的18张牌：${hand.map(cardLabel).join(' ')}`,
      '从以下合法换底方案选一个，只回复数字：',
      ...candidates.map((cards, i) => `${i}：${cards.map(cardLabel).join(' ')}`),
    ].join('\n'),
  }
}

export function buildPlayPrompt(state, playerIndex) {
  const legal = enumerateLegalCards(state, playerIndex)
  const publicTrick = state.trick.map((x) => `${state.players[x.player].name}:${cardLabel(x.card)}`).join('；') || '本墩尚未出牌'
  return {
    options: legal.map((c) => c.id),
    prompt: [
      `四川版升级，本轮打${rankLabel(state.levelRank)}，${state.trumpSuit}为主。你属于${state.players[playerIndex].team === state.dealerTeam ? '庄家队' : '闲家抓分队'}。`,
      `你的手牌：${state.players[playerIndex].hand.map(cardLabel).join(' ')}`,
      `当前一墩：${publicTrick}。闲家已得${state.defenderScore}分。`,
      '从以下合法牌里选一张，只回复数字：',
      ...legal.map((c, i) => `${i}：${cardLabel(c)}`),
    ].join('\n'),
  }
}
