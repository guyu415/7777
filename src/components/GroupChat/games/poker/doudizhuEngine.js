// 斗地主引擎——纯函数，没有 React、没有网络、没有 store 依赖，和
// mysteryEngine.js 同一个写法：UI（DoudizhuRoom.jsx）只负责"什么时候调"，
// 这里只负责"调了会变成什么"。发牌、叫分、出牌合法性、牌型大小、结束判定
// 全部在这里，房间组件不做任何规则判断，模型也只能从这里枚举出的合法选项
// 里选索引——不会出现"模型自己描述了一手牌，程序信了"这种事。
//
// ===== 隐藏信息在这里落地 =====
// buildBidPrompt / buildPlayPrompt 只读 state.players[playerIndex] 自己的
// hand，其余玩家的手牌在这两个函数里没有任何可达路径——和 mysteryEngine 的
// 秘密隔离是同一个结构性保证，不是靠提示词约束。

import { createDeck54, shuffle, cardLabel, newId, parseChoiceIndex } from './cards'

export { parseChoiceIndex }

export const HAND_TYPE_LABEL = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带二',
  straight: '顺子', pairs: '连对', plane: '飞机', plane1: '飞机带单', plane2: '飞机带对',
  bomb: '炸弹', rocket: '火箭',
}

// 斗地主自己的大小序，和牌面 rank 完全不同：3 最小，2 和王最大。
// 3..10 -> 1..8；J=9 Q=10 K=11；A=12；2=13；小王=14；大王=15。
export function ddzPower(rank) {
  if (rank === 17) return 15
  if (rank === 16) return 14
  if (rank === 2) return 13
  if (rank === 14) return 12
  if (rank === 13) return 11
  if (rank === 12) return 10
  if (rank === 11) return 9
  return rank - 2
}
function powerToRank(power) {
  if (power === 15) return 17
  if (power === 14) return 16
  if (power === 13) return 2
  if (power === 12) return 14
  if (power === 11) return 13
  if (power === 10) return 12
  if (power === 9) return 11
  return power + 2
}

function sortHandForDisplay(cards) {
  return cards.slice().sort((a, b) => ddzPower(a.rank) - ddzPower(b.rank))
}
function groupByRank(cards) {
  const map = new Map()
  for (const c of cards) {
    if (!map.has(c.rank)) map.set(c.rank, [])
    map.get(c.rank).push(c)
  }
  return map
}
function isConsecutive(sortedPowers) {
  for (let i = 1; i < sortedPowers.length; i++) {
    if (sortedPowers[i] !== sortedPowers[i - 1] + 1) return false
  }
  return true
}

// ---------------------------------------------------------------- 建局/发牌

function dealFreshRound() {
  const deck = shuffle(createDeck54())
  return {
    hands: [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)],
    bottomCards: deck.slice(51, 54),
  }
}

// players: 长度正好 3 的数组，座位顺序=叫分/出牌顺序，每项
// { kind:'user' } 或 { kind:'ai', memberId, model, name }。
export function createDoudizhuGame(players) {
  if (!Array.isArray(players) || players.length !== 3) throw new Error('斗地主需要正好 3 位玩家')
  const { hands, bottomCards } = dealFreshRound()
  return {
    id: newId('ddz'),
    kind: 'doudizhu',
    runId: newId('ddzrun'),
    players: players.map((p, i) => ({ ...p, hand: sortHandForDisplay(hands[i]), role: null })),
    phase: 'bidding',
    bottomCards,
    biddingTurn: 0,
    biddingStarter: 0,
    bids: [],
    highestBid: null,
    landlord: null,
    turn: null,
    lastPlay: null,
    passCount: 0,
    history: [],
    finished: false,
    winnerRole: null,
    redealCount: 0,
    startedAt: Date.now(),
  }
}

// 再来一局：沿用同样的座位安排（谁是 AI、用什么模型），重新发一副全新的牌，
// 生成一个全新的 runId——房间组件负责在调用这个之前/之后清理旧 runId 的
// VPS 隔离会话，和剧本杀"结束本局"的处理方式一致。
export function restartDoudizhu(state) {
  const players = state.players.map((p) => ({ kind: p.kind, memberId: p.memberId, model: p.model, name: p.name }))
  return createDoudizhuGame(players)
}

function redeal(state, starter) {
  const { hands, bottomCards } = dealFreshRound()
  return {
    ...state,
    players: state.players.map((p, i) => ({ ...p, hand: sortHandForDisplay(hands[i]), role: null })),
    bottomCards,
    phase: 'bidding',
    biddingTurn: starter,
    biddingStarter: starter,
    bids: [],
    highestBid: null,
    landlord: null,
    turn: null,
    lastPlay: null,
    passCount: 0,
    history: [...state.history, { type: 'redeal', redealCount: state.redealCount + 1 }],
    redealCount: state.redealCount + 1,
  }
}

function startPlayingPhase(state, landlordIndex) {
  const players = state.players.map((p, i) => (i === landlordIndex
    ? { ...p, hand: sortHandForDisplay([...p.hand, ...state.bottomCards]), role: 'landlord' }
    : { ...p, role: 'farmer' }))
  return {
    ...state,
    players,
    phase: 'playing',
    landlord: landlordIndex,
    turn: landlordIndex,
    lastPlay: null,
    passCount: 0,
    history: [...state.history, { type: 'landlord', player: landlordIndex }],
  }
}

// ---------------------------------------------------------------- 叫分

// 叫分选项永远是这 4 个之一：0=不叫，1/2/3=叫分，且必须比当前最高分更高
// （3 分立即结束叫分）。返回值是这一轮里"还合法"的选项，供 UI/prompt 用同
// 一份数据保证一致——不会出现"提示词说能选1分，其实已经不合法"的偏差。
export function enumerateBidOptions(state) {
  const options = [0]
  for (const v of [1, 2, 3]) {
    if (!state.highestBid || v > state.highestBid.value) options.push(v)
  }
  return options
}

export function bid(state, playerIndex, value, opts = {}) {
  if (state.phase !== 'bidding') throw new Error('当前不在叫分阶段')
  if (state.biddingTurn !== playerIndex) throw new Error('还没轮到这位玩家叫分')
  const legalOptions = enumerateBidOptions(state)
  if (!legalOptions.includes(value)) throw new Error('这个分数现在不能叫')

  const bids = [...state.bids, { player: playerIndex, value, auto: !!opts.auto }]
  const highestBid = value > 0 && (!state.highestBid || value > state.highestBid.value)
    ? { player: playerIndex, value }
    : state.highestBid

  if (value === 3) {
    return startPlayingPhase({ ...state, bids, highestBid }, playerIndex)
  }
  if (bids.length >= 3) {
    if (highestBid) return startPlayingPhase({ ...state, bids, highestBid }, highestBid.player)
    return redeal(state, (state.biddingStarter + 1) % 3)
  }
  return { ...state, bids, highestBid, biddingTurn: (playerIndex + 1) % 3 }
}

export function autoChooseBid() {
  // 托管默认不叫——简单、安全，不会让一个没想清楚的自动决策稀里糊涂当上地主。
  return 0
}

// ---------------------------------------------------------------- 牌型判断/比较

export function identifyHandType(cards) {
  if (!cards || cards.length === 0) return null
  const n = cards.length
  const groups = groupByRank(cards)
  const ranks = [...groups.keys()]
  const counts = ranks.map((r) => groups.get(r).length)

  if (n === 2 && ranks.length === 2 && ranks.includes(16) && ranks.includes(17)) {
    return { type: 'rocket', power: Infinity, length: 1 }
  }
  if (n === 4 && ranks.length === 1 && counts[0] === 4) {
    return { type: 'bomb', power: ddzPower(ranks[0]), length: 1 }
  }
  if (n === 1) return { type: 'single', power: ddzPower(ranks[0]), length: 1 }
  if (n === 2 && ranks.length === 1 && counts[0] === 2) return { type: 'pair', power: ddzPower(ranks[0]), length: 1 }
  if (n === 3 && ranks.length === 1 && counts[0] === 3) return { type: 'triple', power: ddzPower(ranks[0]), length: 1 }

  if (n === 4 && ranks.length === 2) {
    const tripleRank = ranks.find((r) => groups.get(r).length === 3)
    const singleRank = ranks.find((r) => groups.get(r).length === 1)
    if (tripleRank != null && singleRank != null) return { type: 'triple1', power: ddzPower(tripleRank), length: 1 }
  }
  if (n === 5 && ranks.length === 2) {
    const tripleRank = ranks.find((r) => groups.get(r).length === 3)
    const pairRank = ranks.find((r) => groups.get(r).length === 2)
    if (tripleRank != null && pairRank != null) return { type: 'triple2', power: ddzPower(tripleRank), length: 1 }
  }

  if (n >= 5 && ranks.length === n && counts.every((c) => c === 1)) {
    const powers = ranks.map(ddzPower).sort((a, b) => a - b)
    if (powers[powers.length - 1] <= 12 && isConsecutive(powers)) {
      return { type: 'straight', power: powers[0], length: n }
    }
  }
  if (n >= 6 && n % 2 === 0 && counts.every((c) => c === 2)) {
    const powers = ranks.map(ddzPower).sort((a, b) => a - b)
    if (powers.length >= 3 && powers[powers.length - 1] <= 12 && isConsecutive(powers)) {
      return { type: 'pairs', power: powers[0], length: powers.length }
    }
  }
  if (n >= 6 && n % 3 === 0 && counts.every((c) => c === 3)) {
    const powers = ranks.map(ddzPower).sort((a, b) => a - b)
    if (powers.length >= 2 && powers[powers.length - 1] <= 12 && isConsecutive(powers)) {
      return { type: 'plane', power: powers[0], length: powers.length }
    }
  }

  const tripleRanks = ranks.filter((r) => groups.get(r).length === 3)
  if (tripleRanks.length >= 2) {
    const otherCount = n - tripleRanks.length * 3
    const powers = tripleRanks.map(ddzPower).sort((a, b) => a - b)
    if (powers[powers.length - 1] <= 12 && isConsecutive(powers)) {
      if (otherCount === tripleRanks.length) {
        return { type: 'plane1', power: powers[0], length: tripleRanks.length }
      }
      if (otherCount === tripleRanks.length * 2) {
        const restCards = cards.filter((c) => !tripleRanks.includes(c.rank))
        const restGroups = groupByRank(restCards)
        if ([...restGroups.values()].every((g) => g.length === 2)) {
          return { type: 'plane2', power: powers[0], length: tripleRanks.length }
        }
      }
    }
  }
  return null
}

// a 是否压得过 b（b 为 null 表示领出，永远成立）。炸弹/火箭优先级在这里
// 落地：火箭天下第一；炸弹压任何非炸弹非火箭的普通牌型，炸弹之间比大小；
// 普通牌型必须类型和长度都一致才能比。
export function compareHandType(a, b) {
  if (!a) return false
  if (!b) return true
  if (a.type === 'rocket') return true
  if (b.type === 'rocket') return false
  if (a.type === 'bomb' && b.type === 'bomb') return a.power > b.power
  if (a.type === 'bomb') return true
  if (b.type === 'bomb') return false
  if (a.type !== b.type || a.length !== b.length) return false
  return a.power > b.power
}

// ---------------------------------------------------------------- 出牌

// 枚举当前玩家所有合法出牌选项（含是否可过牌）——不是对全体牌力做暴力
// 笛卡尔积，而是按"点数分组"直接构造候选，规模是 O(点数种类²) 级别，
// 17 张手牌顶多 13 种点数，不会有组合爆炸；每个候选都经过
// identifyHandType+compareHandType 真正校验过，绝对合法。
export function enumerateLegalActions(state, playerIndex) {
  const player = state.players[playerIndex]
  const hand = player.hand
  const groups = groupByRank(hand)
  const ranks = [...groups.keys()].sort((a, b) => a - b)
  const lastType = state.lastPlay?.handType || null
  const actions = []
  const seen = new Set()

  const add = (cards) => {
    if (!cards.length) return
    const handType = identifyHandType(cards)
    if (!handType) return
    if (lastType && !compareHandType(handType, lastType)) return
    const key = cards.map((c) => c.id).slice().sort().join(',')
    if (seen.has(key)) return
    seen.add(key)
    actions.push({ cards: cards.map((c) => c.id), type: handType.type, power: handType.power, length: handType.length })
  }

  for (const r of ranks) {
    const g = groups.get(r)
    add([g[0]])
    if (g.length >= 2) add(g.slice(0, 2))
    if (g.length >= 3) add(g.slice(0, 3))
    if (g.length === 4) add(g.slice(0, 4))
  }
  if (groups.has(16) && groups.has(17)) add([groups.get(16)[0], groups.get(17)[0]])

  for (const r of ranks) {
    const g = groups.get(r)
    if (g.length < 3) continue
    const triple = g.slice(0, 3)
    for (const r2 of ranks) {
      if (r2 === r) continue
      const g2 = groups.get(r2)
      add([...triple, g2[0]])
      if (g2.length >= 2) add([...triple, g2[0], g2[1]])
    }
  }

  const singleRanksAsc = ranks.filter((r) => ddzPower(r) <= 12)
  const powersAsc = singleRanksAsc.map(ddzPower).sort((a, b) => a - b)
  for (let len = 5; len <= 12; len++) {
    for (let i = 0; i + len <= powersAsc.length; i++) {
      const windowPowers = powersAsc.slice(i, i + len)
      if (isConsecutive(windowPowers)) add(windowPowers.map((p) => groups.get(powerToRank(p))[0]))
    }
  }

  const pairRanks = ranks.filter((r) => groups.get(r).length >= 2 && ddzPower(r) <= 12)
  const pairPowersAsc = pairRanks.map(ddzPower).sort((a, b) => a - b)
  for (let len = 3; len <= pairPowersAsc.length; len++) {
    for (let i = 0; i + len <= pairPowersAsc.length; i++) {
      const windowPowers = pairPowersAsc.slice(i, i + len)
      if (isConsecutive(windowPowers)) add(windowPowers.flatMap((p) => groups.get(powerToRank(p)).slice(0, 2)))
    }
  }

  const tripleRanksAsc = ranks.filter((r) => groups.get(r).length >= 3 && ddzPower(r) <= 12)
  const triplePowersAsc = tripleRanksAsc.map(ddzPower).sort((a, b) => a - b)
  for (let len = 2; len <= triplePowersAsc.length; len++) {
    for (let i = 0; i + len <= triplePowersAsc.length; i++) {
      const windowPowers = triplePowersAsc.slice(i, i + len)
      if (!isConsecutive(windowPowers)) continue
      const windowRanks = windowPowers.map(powerToRank)
      const tripleCards = windowRanks.flatMap((r) => groups.get(r).slice(0, 3))
      add(tripleCards)

      const otherRanksForKicker = ranks.filter((r) => !windowRanks.includes(r))
      if (otherRanksForKicker.length >= len) {
        add([...tripleCards, ...otherRanksForKicker.slice(0, len).map((r) => groups.get(r)[0])])
        add([...tripleCards, ...otherRanksForKicker.slice(-len).map((r) => groups.get(r)[0])])
      }
      const otherPairRanksForKicker = ranks.filter((r) => !windowRanks.includes(r) && groups.get(r).length >= 2)
      if (otherPairRanksForKicker.length >= len) {
        add([...tripleCards, ...otherPairRanksForKicker.slice(0, len).flatMap((r) => groups.get(r).slice(0, 2))])
      }
    }
  }

  return { canPass: !!state.lastPlay, actions }
}

export function applyPlay(state, playerIndex, cardIds, opts = {}) {
  if (state.phase !== 'playing') throw new Error('当前不在出牌阶段')
  if (state.turn !== playerIndex) throw new Error('还没轮到这位玩家出牌')
  const player = state.players[playerIndex]
  const isPass = !cardIds || cardIds.length === 0

  if (isPass) {
    if (!state.lastPlay) throw new Error('轮到你先出牌，不能过牌')
    const passCount = state.passCount + 1
    const history = [...state.history, { type: 'pass', player: playerIndex, auto: !!opts.auto }]
    if (passCount >= 2) {
      return { ...state, lastPlay: null, passCount: 0, turn: (playerIndex + 1) % 3, history }
    }
    return { ...state, passCount, turn: (playerIndex + 1) % 3, history }
  }

  const idSet = new Set(cardIds)
  if (idSet.size !== cardIds.length) throw new Error('选中的牌重复了')
  const cards = player.hand.filter((c) => idSet.has(c.id))
  if (cards.length !== cardIds.length) throw new Error('选中的牌不在手牌里')
  const handType = identifyHandType(cards)
  if (!handType) throw new Error('不是合法的牌型')
  if (state.lastPlay && !compareHandType(handType, state.lastPlay.handType)) {
    throw new Error('压不过上一手牌')
  }

  const remainingHand = player.hand.filter((c) => !idSet.has(c.id))
  const players = state.players.map((p, i) => (i === playerIndex ? { ...p, hand: remainingHand } : p))
  const history = [...state.history, { type: 'play', player: playerIndex, cards, handType: handType.type, auto: !!opts.auto }]

  if (remainingHand.length === 0) {
    return {
      ...state, players, lastPlay: { player: playerIndex, cards, handType }, passCount: 0,
      history, phase: 'finished', finished: true, winnerRole: player.role, turn: null,
    }
  }
  return {
    ...state, players, lastPlay: { player: playerIndex, cards, handType }, passCount: 0,
    history, turn: (playerIndex + 1) % 3,
  }
}

// 托管兜底：能过就过；不能过（轮到自己主动领出）就打出"体积最小"的合法牌，
// 优先避开炸弹/火箭——不需要聪明，只需要合法、不送人头。
export function autoChooseAction(state, playerIndex) {
  const { canPass, actions } = enumerateLegalActions(state, playerIndex)
  if (canPass) return { cards: [] }
  if (!actions.length) return { cards: [] }
  const nonBomb = actions.filter((a) => a.type !== 'bomb' && a.type !== 'rocket')
  const pool = nonBomb.length ? nonBomb : actions
  pool.sort((a, b) => (a.cards.length - b.cards.length) || (a.power - b.power))
  return { cards: pool[0].cards }
}

// ---------------------------------------------------------------- AI 提示词构造

function findCard(hand, id) {
  return hand.find((c) => c.id === id)
}
function describeHistoryEntry(h) {
  if (h.type === 'pass') return `玩家${h.player}过牌`
  if (h.type === 'play') return `玩家${h.player}出${h.cards.map(cardLabel).join('')}`
  if (h.type === 'landlord') return `玩家${h.player}当地主`
  if (h.type === 'redeal') return '无人叫分，重新发牌'
  return ''
}

export function buildBidPrompt(state, playerIndex) {
  const player = state.players[playerIndex]
  const handText = player.hand.map(cardLabel).join(' ')
  const bidsText = state.bids.length
    ? state.bids.map((b) => `玩家${b.player}：${b.value === 0 ? '不叫' : b.value + '分'}`).join('；')
    : '（还没有人叫分）'
  const options = enumerateBidOptions(state)
  const labelFor = (v) => (v === 0 ? '不叫' : `${v}分${v === 3 ? '（立刻结束叫分，直接当地主）' : ''}`)
  return [
    '这是斗地主的叫分环节。',
    `你的17张手牌：${handText}`,
    `目前已经叫过的：${bidsText}`,
    `当前最高分：${state.highestBid ? state.highestBid.value + '分（玩家' + state.highestBid.player + '）' : '无'}`,
    '请从以下合法选项里选一个，只回复选项前面的数字，不要输出任何其它内容：',
    ...options.map((v, i) => `${i}：${labelFor(v)}`),
  ].join('\n')
}

export function buildPlayPrompt(state, playerIndex) {
  const player = state.players[playerIndex]
  const handText = player.hand.map(cardLabel).join(' ')
  const { canPass, actions } = enumerateLegalActions(state, playerIndex)
  const lastPlayText = state.lastPlay
    ? `上一手是玩家${state.lastPlay.player}出的：${state.lastPlay.cards.map(cardLabel).join(' ')}（${HAND_TYPE_LABEL[state.lastPlay.handType.type] || ''}）`
    : '桌面是空的，轮到你主动出牌（不能过牌）'
  const recent = state.history.slice(-6).map(describeHistoryEntry).filter(Boolean).join('；')
  const optionLines = []
  if (canPass) optionLines.push('0：过牌')
  actions.forEach((a, i) => {
    const idx = i + (canPass ? 1 : 0)
    optionLines.push(`${idx}：出 ${a.cards.map((id) => cardLabel(findCard(player.hand, id))).join(' ')}（${HAND_TYPE_LABEL[a.type] || a.type}）`)
  })
  return [
    `你是${player.role === 'landlord' ? '地主' : '农民'}。`,
    `你的手牌（${player.hand.length}张）：${handText}`,
    lastPlayText,
    recent ? `最近的动作：${recent}` : '',
    '请从以下合法选项里选一个，直接回复选项前面的数字，不要输出任何其它内容：',
    ...optionLines,
  ].filter(Boolean).join('\n')
}
