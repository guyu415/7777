import { describe, it, expect } from 'vitest'
import {
  createZhajinhuaGame, rankHand, compareHandRank, callBet, raiseBet, fold, compareHands,
  lookAtCards, enumerateZhajinhuaActions, autoChooseZhajinhuaAction, restartZhajinhua,
  parseChoiceIndex,
} from '../zhajinhuaEngine'

const PLAYERS = [
  { kind: 'user', name: '我' },
  { kind: 'ai', memberId: 'claude-code', model: 'claude-sonnet-4-6', name: 'CC' },
  { kind: 'ai', memberId: 'api:s1', model: 'gpt-4', name: 'Bot' },
]

function freshGame(opts) {
  return createZhajinhuaGame(PLAYERS, opts)
}

function c(rank, suit) {
  return { id: `${suit}${rank}`, suit, rank }
}

describe('zhajinhua: dealing', () => {
  it('deals exactly 3 cards to each of 3 players from a 52-card deck (no jokers)', () => {
    const g = freshGame()
    expect(g.players).toHaveLength(3)
    for (const p of g.players) expect(p.cards).toHaveLength(3)
    const allIds = new Set(g.players.flatMap((p) => p.cards.map((cc) => cc.id)))
    expect(allIds.size).toBe(9)
    expect(g.players.some((p) => p.cards.some((cc) => cc.suit === 'joker'))).toBe(false)
  })
  it('everyone antes the base bet into the pot at the start', () => {
    const g = freshGame({ baseBet: 10, startingChips: 1000 })
    expect(g.pot).toBe(30)
    expect(g.players[0].chips).toBe(990)
    expect(g.currentBet).toBe(10)
  })
})

describe('zhajinhua: hand type ranking', () => {
  it('识别豹子 (three of a kind)', () => {
    expect(rankHand([c(7, '♠'), c(7, '♥'), c(7, '♦')]).type).toBe('leopard')
  })
  it('识别同花顺，含 A23 作为最小顺子', () => {
    expect(rankHand([c(4, '♠'), c(5, '♠'), c(6, '♠')]).type).toBe('straightFlush')
    const a23flush = rankHand([c(14, '♠'), c(2, '♠'), c(3, '♠')])
    expect(a23flush.type).toBe('straightFlush')
  })
  it('识别金花 (flush, 非顺子)', () => {
    expect(rankHand([c(4, '♠'), c(9, '♠'), c(2, '♠')]).type).toBe('flush')
  })
  it('识别顺子，A23 视为最小顺子（比 234 还小）', () => {
    const normal = rankHand([c(4, '♠'), c(5, '♥'), c(6, '♦')])
    expect(normal.type).toBe('straight')
    const a23 = rankHand([c(14, '♠'), c(2, '♥'), c(3, '♦')])
    expect(a23.type).toBe('straight')
    expect(compareHandRank(a23, normal, false)).toBeLessThan(0)
    const twoThreeFour = rankHand([c(2, '♠'), c(3, '♥'), c(4, '♦')])
    expect(compareHandRank(a23, twoThreeFour, false)).toBeLessThan(0)
  })
  it('QKA 视为普通高位顺子（不是 wrap-around）', () => {
    const qka = rankHand([c(12, '♠'), c(13, '♥'), c(14, '♦')])
    expect(qka.type).toBe('straight')
  })
  it('识别对子和散牌', () => {
    expect(rankHand([c(7, '♠'), c(7, '♥'), c(2, '♦')]).type).toBe('pair')
    expect(rankHand([c(7, '♠'), c(9, '♥'), c(2, '♦')]).type).toBe('high')
  })
  it('基础类型优先级：豹子 > 同花顺 > 金花 > 顺子 > 对子 > 散牌', () => {
    const leopard = rankHand([c(5, '♠'), c(5, '♥'), c(5, '♦')])
    const straightFlush = rankHand([c(4, '♠'), c(5, '♠'), c(6, '♠')])
    const flush = rankHand([c(4, '♠'), c(9, '♠'), c(2, '♠')])
    const straight = rankHand([c(4, '♠'), c(5, '♥'), c(6, '♦')])
    const pair = rankHand([c(7, '♠'), c(7, '♥'), c(2, '♦')])
    const high = rankHand([c(7, '♠'), c(9, '♥'), c(2, '♦')])
    expect(compareHandRank(leopard, straightFlush, false)).toBeGreaterThan(0)
    expect(compareHandRank(straightFlush, flush, false)).toBeGreaterThan(0)
    expect(compareHandRank(flush, straight, false)).toBeGreaterThan(0)
    expect(compareHandRank(straight, pair, false)).toBeGreaterThan(0)
    expect(compareHandRank(pair, high, false)).toBeGreaterThan(0)
  })
})

describe('zhajinhua: 235吃豹子 开关', () => {
  it('开启时，非同花的 2/3/5 散牌能吃掉豹子', () => {
    const special = rankHand([c(2, '♠'), c(3, '♥'), c(5, '♦')])
    const leopard = rankHand([c(9, '♠'), c(9, '♥'), c(9, '♦')])
    expect(compareHandRank(special, leopard, true)).toBeGreaterThan(0)
    expect(compareHandRank(leopard, special, true)).toBeLessThan(0)
  })
  it('关闭时，2/3/5 散牌打不过豹子（正常按类型比较）', () => {
    const special = rankHand([c(2, '♠'), c(3, '♥'), c(5, '♦')])
    const leopard = rankHand([c(9, '♠'), c(9, '♥'), c(9, '♦')])
    expect(compareHandRank(special, leopard, false)).toBeLessThan(0)
  })
  it('235 同花不算特殊规则（本身已经是更高的金花/同花顺）', () => {
    const sameSuit235 = rankHand([c(2, '♠'), c(3, '♠'), c(5, '♠')])
    expect(sameSuit235.type).not.toBe('high')
  })
  it('235 打不过除豹子以外的其它牌型', () => {
    const special = rankHand([c(2, '♠'), c(3, '♥'), c(5, '♦')])
    const pair = rankHand([c(6, '♠'), c(6, '♥'), c(2, '♦')])
    expect(compareHandRank(special, pair, true)).toBeLessThan(0)
  })
})

describe('zhajinhua: 看牌', () => {
  it('看牌不消耗回合、不影响筹码，只是把 hasLooked 标记为 true', () => {
    let g = freshGame()
    const beforeTurn = g.turn
    const beforeChips = g.players[0].chips
    g = lookAtCards(g, 0)
    expect(g.players[0].hasLooked).toBe(true)
    expect(g.turn).toBe(beforeTurn)
    expect(g.players[0].chips).toBe(beforeChips)
  })
})

describe('zhajinhua: 下注/跟注/加注/弃牌', () => {
  it('跟注按当前注额补齐差额，并推进到下一位玩家', () => {
    let g = freshGame({ baseBet: 10 })
    g = raiseBet(g, 0, 30) // 玩家0从10加到30
    expect(g.currentBet).toBe(30)
    expect(g.turn).toBe(1)
    const before = g.players[1].chips
    g = callBet(g, 1)
    expect(g.players[1].roundContribution).toBe(30)
    expect(g.players[1].chips).toBe(before - 20) // 之前已经下了10底注，还差20
    expect(g.turn).toBe(2)
  })
  it('拒绝不高于当前注额的加注', () => {
    let g = freshGame({ baseBet: 10 })
    expect(() => raiseBet(g, 0, 10)).toThrow()
    expect(() => raiseBet(g, 0, 5)).toThrow()
  })
  it('拒绝不是自己回合的操作', () => {
    const g = freshGame()
    expect(() => callBet(g, 1)).toThrow()
  })
  it('弃牌后不再轮到这位玩家，且轮次正确跳过已弃牌的人', () => {
    let g = freshGame()
    g = fold(g, 0)
    expect(g.players[0].folded).toBe(true)
    expect(g.turn).toBe(1)
    g = fold(g, 1)
    // 只剩玩家2一人未弃牌——应直接结算，不再等待
    expect(g.finished).toBe(true)
    expect(g.winner).toBe(2)
    expect(g.winReason).toBe('fold')
  })
})

describe('zhajinhua: 比牌', () => {
  it('比牌双方按牌型高低分出胜负，输的人出局，赢家继续，只有这两人的牌被揭示', () => {
    let g = freshGame({ baseBet: 10 })
    // 直接构造一个可控的牌面，确保玩家0赢
    g = {
      ...g,
      players: g.players.map((p, i) => (i === 0
        ? { ...p, cards: [c(9, '♠'), c(9, '♥'), c(9, '♦')] }
        : i === 1 ? { ...p, cards: [c(2, '♠'), c(4, '♥'), c(7, '♦')] } : p)),
    }
    g = compareHands(g, 0, 1)
    expect(g.players[1].folded).toBe(true)
    expect(g.players[0].folded).toBe(false)
    const lastEntry = g.history[g.history.length - 1]
    expect(lastEntry.type).toBe('compare')
    expect(lastEntry.result).toBe('challenger')
    expect(lastEntry.reveal[0]).toBeDefined()
    expect(lastEntry.reveal[1]).toBeDefined()
  })
  it('比牌输家如果只剩挑战者和目标两人在场，直接结算', () => {
    let g = freshGame({ baseBet: 10 })
    g = callBet(g, 0) // turn -> 1
    g = callBet(g, 1) // turn -> 2
    g = fold(g, 2) // 玩家2弃牌，只剩0和1；turn 跳过2回到0
    g = {
      ...g,
      players: g.players.map((p, i) => (i === 1
        ? { ...p, cards: [c(9, '♠'), c(9, '♥'), c(9, '♦')] }
        : i === 0 ? { ...p, cards: [c(2, '♠'), c(4, '♥'), c(7, '♦')] } : p)),
    }
    g = compareHands(g, 0, 1)
    expect(g.finished).toBe(true)
    expect(g.winner).toBe(1)
  })
  it('不能和自己比牌，不能和已弃牌的人比牌', () => {
    let g = freshGame()
    expect(() => compareHands(g, 0, 0)).toThrow()
    g = callBet(g, 0) // turn -> 1
    g = fold(g, 1) // turn -> 2
    // 轮到玩家2，尝试和已弃牌的玩家1比牌应被拒绝
    expect(() => compareHands(g, 2, 1)).toThrow()
  })
})

describe('zhajinhua: 有限轮数 -> 强制摊牌', () => {
  it('到达 maxActions 后自动摊牌，比较所有在场玩家的牌，最大的赢', () => {
    let g = freshGame({ baseBet: 10, maxActions: 3 })
    g = {
      ...g,
      players: g.players.map((p, i) => (i === 2
        ? { ...p, cards: [c(9, '♠'), c(9, '♥'), c(9, '♦')] }
        : { ...p, cards: [c(2, '♠'), c(4, '♥'), c(7, '♦')] })),
    }
    g = callBet(g, 0) // actionsCount 1
    g = callBet(g, 1) // actionsCount 2
    g = callBet(g, 2) // actionsCount 3 -> 达到上限，强制摊牌
    expect(g.finished).toBe(true)
    expect(g.winner).toBe(2)
    expect(g.winReason).toBe('showdown')
  })
  it('达到轮数上限后拒绝继续加注', () => {
    let g = freshGame({ baseBet: 10, maxActions: 1 })
    g = raiseBet(g, 0, 30) // actionsCount -> 1，达到上限
    expect(() => raiseBet(g, 1, 50)).toThrow()
  })
})

describe('zhajinhua: 合法操作枚举 + 托管', () => {
  it('枚举的操作永远包含 fold 和 call，且 compare 只对着还在场的其他人', () => {
    let g = freshGame()
    g = callBet(g, 0) // turn -> 1
    g = fold(g, 1) // turn -> 2
    const actions = enumerateZhajinhuaActions(g, 2)
    expect(actions.some((a) => a.type === 'fold')).toBe(true)
    expect(actions.some((a) => a.type === 'call')).toBe(true)
    expect(actions.filter((a) => a.type === 'compare').every((a) => a.target === 0)).toBe(true)
  })
  it('轮数到上限后不再提供加注选项', () => {
    let g = freshGame({ maxActions: 0 })
    const actions = enumerateZhajinhuaActions(g, 0)
    expect(actions.some((a) => a.type === 'raise')).toBe(false)
  })
  it('托管：跟注金额在承受范围内就跟注', () => {
    const g = freshGame()
    const choice = autoChooseZhajinhuaAction(g, 0)
    expect(choice.type).toBe('call')
  })
  it('托管：跟注金额超过筹码大半就弃牌，不硬扛', () => {
    let g = freshGame({ baseBet: 10, startingChips: 100 })
    g = raiseBet(g, 0, 90)
    const choice = autoChooseZhajinhuaAction(g, 1)
    expect(choice.type).toBe('fold')
  })
})

describe('zhajinhua: 再来一局', () => {
  it('restartZhajinhua 保留座位配置，重新发牌，生成新的 runId', () => {
    let g = freshGame()
    g = fold(g, 0)
    const restarted = restartZhajinhua(g)
    expect(restarted.runId).not.toBe(g.runId)
    expect(restarted.finished).toBe(false)
    expect(restarted.players[1].memberId).toBe('claude-code')
    expect(restarted.players.every((p) => !p.folded)).toBe(true)
  })
})

describe('zhajinhua: AI 选择解析', () => {
  it('解析合法数字，拒绝越界/无法解析的内容（必须触发托管）', () => {
    expect(parseChoiceIndex('1', 3)).toBe(1)
    expect(parseChoiceIndex('我选择 2', 3)).toBe(2)
    expect(parseChoiceIndex('99', 3)).toBeNull()
    expect(parseChoiceIndex('不知道', 3)).toBeNull()
  })
})
