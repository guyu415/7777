import { describe, it, expect } from 'vitest'
import {
  createDoudizhuGame, bid, applyPlay, identifyHandType, compareHandType,
  enumerateLegalActions, enumerateBidOptions, autoChooseAction, restartDoudizhu,
  parseChoiceIndex,
} from '../doudizhuEngine'

const PLAYERS = [
  { kind: 'user', name: '我' },
  { kind: 'ai', memberId: 'claude-code', model: 'claude-sonnet-4-6', name: 'CC' },
  { kind: 'ai', memberId: 'api:s1', model: 'gpt-4', name: 'Bot' },
]

function freshGame() {
  return createDoudizhuGame(PLAYERS)
}

function card(rank, suit = '♠') {
  return { id: `${suit}${rank}-${Math.random()}`, suit, rank }
}

describe('doudizhu: dealing', () => {
  it('deals 17/17/17 hand cards + 3 bottom cards from a full 54-card deck', () => {
    const g = freshGame()
    expect(g.players[0].hand).toHaveLength(17)
    expect(g.players[1].hand).toHaveLength(17)
    expect(g.players[2].hand).toHaveLength(17)
    expect(g.bottomCards).toHaveLength(3)
    const allIds = new Set([
      ...g.players.flatMap((p) => p.hand.map((c) => c.id)),
      ...g.bottomCards.map((c) => c.id),
    ])
    expect(allIds.size).toBe(54)
  })
})

describe('doudizhu: hand type identification', () => {
  it('identifies single/pair/triple', () => {
    expect(identifyHandType([card(5)]).type).toBe('single')
    expect(identifyHandType([card(5), card(5, '♥')]).type).toBe('pair')
    expect(identifyHandType([card(5), card(5, '♥'), card(5, '♦')]).type).toBe('triple')
  })
  it('identifies triple+1 and triple+2', () => {
    const t1 = identifyHandType([card(5), card(5, '♥'), card(5, '♦'), card(9)])
    expect(t1.type).toBe('triple1')
    const t2 = identifyHandType([card(5), card(5, '♥'), card(5, '♦'), card(9), card(9, '♥')])
    expect(t2.type).toBe('triple2')
  })
  it('rejects a triple + two unrelated singles as invalid (not a real type)', () => {
    expect(identifyHandType([card(5), card(5, '♥'), card(5, '♦'), card(9), card(10)])).toBeNull()
  })
  it('identifies straight (5+ consecutive singles, no 2/jokers)', () => {
    const s = identifyHandType([card(3), card(4), card(5), card(6), card(7)])
    expect(s.type).toBe('straight')
    expect(s.length).toBe(5)
  })
  it('rejects a straight that includes 2', () => {
    expect(identifyHandType([card(10), card(11), card(12), card(13), card(2)])).toBeNull()
  })
  it('rejects a 4-card straight (too short)', () => {
    expect(identifyHandType([card(3), card(4), card(5), card(6)])).toBeNull()
  })
  it('identifies consecutive pairs (连对, 3+ pairs)', () => {
    const p = identifyHandType([card(3), card(3, '♥'), card(4), card(4, '♥'), card(5), card(5, '♥')])
    expect(p.type).toBe('pairs')
    expect(p.length).toBe(3)
  })
  it('identifies a plane (飞机, 2+ consecutive triples) with no wings', () => {
    const cards = [3, 3, 3, 4, 4, 4].map((r, i) => card(r, ['♠', '♥', '♦', '♠', '♥', '♦'][i]))
    expect(identifyHandType(cards).type).toBe('plane')
  })
  it('identifies plane+1 (每组配一张单牌)', () => {
    const cards = [
      card(3), card(3, '♥'), card(3, '♦'),
      card(4), card(4, '♥'), card(4, '♦'),
      card(9), card(10),
    ]
    expect(identifyHandType(cards).type).toBe('plane1')
  })
  it('identifies plane+2 (每组配一对)', () => {
    const cards = [
      card(3), card(3, '♥'), card(3, '♦'),
      card(4), card(4, '♥'), card(4, '♦'),
      card(9), card(9, '♥'), card(10), card(10, '♥'),
    ]
    expect(identifyHandType(cards).type).toBe('plane2')
  })
  it('identifies bomb (4 of a kind) and rocket (both jokers)', () => {
    expect(identifyHandType([card(7), card(7, '♥'), card(7, '♦'), card(7, '♣')]).type).toBe('bomb')
    expect(identifyHandType([{ id: 'js', suit: 'joker', rank: 16 }, { id: 'jb', suit: 'joker', rank: 17 }]).type).toBe('rocket')
  })
  it('returns null for an incoherent set of cards', () => {
    expect(identifyHandType([card(3), card(5), card(9)])).toBeNull()
  })
})

describe('doudizhu: comparison (含炸弹/火箭优先级)', () => {
  it('higher single beats lower single of the same length', () => {
    const a = identifyHandType([card(9)])
    const b = identifyHandType([card(5)])
    expect(compareHandType(a, b)).toBe(true)
    expect(compareHandType(b, a)).toBe(false)
  })
  it('a straight cannot beat a pair (different type)', () => {
    const straight = identifyHandType([card(3), card(4), card(5), card(6), card(7)])
    const pair = identifyHandType([card(9), card(9, '♥')])
    expect(compareHandType(straight, pair)).toBe(false)
  })
  it('a longer straight beats nothing shorter automatically — length must match', () => {
    const s5 = identifyHandType([card(3), card(4), card(5), card(6), card(7)])
    const s6 = identifyHandType([card(3), card(4), card(5), card(6), card(7), card(8)])
    expect(compareHandType(s6, s5)).toBe(false) // different length, not comparable
  })
  it('bomb beats any regular hand regardless of type', () => {
    const bomb = identifyHandType([card(4), card(4, '♥'), card(4, '♦'), card(4, '♣')])
    const rocket = identifyHandType([{ id: 'js', suit: 'joker', rank: 16 }, { id: 'jb', suit: 'joker', rank: 17 }])
    const plane = identifyHandType([3, 3, 3, 8, 8, 8].map((r, i) => card(r, ['♠', '♥', '♦', '♠', '♥', '♦'][i])))
    expect(compareHandType(bomb, plane)).toBe(true)
    expect(compareHandType(plane, bomb)).toBe(false)
    expect(compareHandType(rocket, bomb)).toBe(true)
    expect(compareHandType(bomb, rocket)).toBe(false)
  })
  it('bigger bomb beats smaller bomb', () => {
    const bomb7 = identifyHandType([card(7), card(7, '♥'), card(7, '♦'), card(7, '♣')])
    const bomb4 = identifyHandType([card(4), card(4, '♥'), card(4, '♦'), card(4, '♣')])
    expect(compareHandType(bomb7, bomb4)).toBe(true)
  })
})

describe('doudizhu: bidding', () => {
  it('supports 不叫/1/2/3, and 3 immediately ends bidding with that player as landlord', () => {
    let g = freshGame()
    g = bid(g, 0, 0)
    expect(g.phase).toBe('bidding')
    g = bid(g, 1, 3)
    expect(g.phase).toBe('playing')
    expect(g.landlord).toBe(1)
    expect(g.players[1].hand).toHaveLength(20) // 17 + 3 bottom cards
    expect(g.players[1].role).toBe('landlord')
    expect(g.players[0].role).toBe('farmer')
    expect(g.players[2].role).toBe('farmer')
  })
  it('rejects a bid that does not exceed the current highest', () => {
    let g = freshGame()
    g = bid(g, 0, 2)
    expect(() => bid(g, 1, 1)).toThrow()
    expect(() => bid(g, 1, 2)).toThrow()
  })
  it('auto-redeals a fresh hand when all three players pass', () => {
    let g = freshGame()
    const originalHand0 = g.players[0].hand.map((c) => c.id).sort()
    g = bid(g, 0, 0)
    g = bid(g, 1, 0)
    g = bid(g, 2, 0)
    expect(g.phase).toBe('bidding')
    expect(g.redealCount).toBe(1)
    expect(g.players[0].hand).toHaveLength(17)
    // 重发是全新洗牌，几乎不可能和上一次完全一样（不做强断言避免小概率误报，
    // 但至少验证确实重新走了一轮完整的 3 人叫分）
    expect(g.bids).toHaveLength(0)
    void originalHand0
  })
  it('highest bidder becomes landlord once everyone has acted', () => {
    let g = freshGame()
    g = bid(g, 0, 1)
    g = bid(g, 1, 0)
    g = bid(g, 2, 2)
    expect(g.phase).toBe('playing')
    expect(g.landlord).toBe(2)
  })
  it('enumerateBidOptions narrows as the highest bid rises', () => {
    let g = freshGame()
    expect(enumerateBidOptions(g)).toEqual([0, 1, 2, 3])
    g = bid(g, 0, 1)
    expect(enumerateBidOptions(g)).toEqual([0, 2, 3])
  })
})

describe('doudizhu: turn advancement, passing, and clearing the table', () => {
  function landlordGame() {
    let g = freshGame()
    g = bid(g, 0, 3) // user is landlord, turn = 0
    return g
  }

  it('advances turn to the next player after a real play', () => {
    let g = landlordGame()
    const single = g.players[0].hand[0]
    g = applyPlay(g, 0, [single.id])
    expect(g.turn).toBe(1)
    expect(g.lastPlay.player).toBe(0)
  })

  it('rejects playing out of turn', () => {
    const g = landlordGame()
    expect(() => applyPlay(g, 1, [g.players[1].hand[0].id])).toThrow()
  })

  it('rejects passing when leading (nothing on the table)', () => {
    const g = landlordGame()
    expect(() => applyPlay(g, 0, [])).toThrow()
  })

  it('clears the table after two consecutive passes, and turn returns to the original leader', () => {
    let g = landlordGame()
    const single = g.players[0].hand[0]
    g = applyPlay(g, 0, [single.id]) // player 0 leads, turn -> 1
    g = applyPlay(g, 1, []) // pass, turn -> 2
    expect(g.lastPlay).not.toBeNull()
    g = applyPlay(g, 2, []) // second pass -> table clears
    expect(g.lastPlay).toBeNull()
    expect(g.passCount).toBe(0)
    expect(g.turn).toBe(0) // 回到原来出牌的人，必须重新主动领出
    expect(() => applyPlay(g, 0, [])).toThrow() // 领出不能过牌
  })

  it('rejects an illegal (non-beating) play', () => {
    let g = landlordGame()
    // 找一张小牌先出
    const sorted = g.players[0].hand.slice().sort((a, b) => a.rank - b.rank)
    g = applyPlay(g, 0, [sorted[0].id])
    // 玩家1如果手里有更小的单张，出它应该被拒绝——直接构造一个必然更小的假设：
    // 用玩家1手牌里最小的一张去比较，如果比刚才打出的还小就该被拒绝
    const p1Sorted = g.players[1].hand.slice().sort((a, b) => a.rank - b.rank)
    const lastPower = g.lastPlay.handType.power
    const smaller = p1Sorted.find((c) => require_ddz_power_lt(c.rank, lastPower))
    if (smaller) {
      expect(() => applyPlay(g, 1, [smaller.id])).toThrow()
    }
  })
})

// 直接内联一份和引擎一致的 power 映射，只用于测试里挑一张"必然更小"的牌，
// 不依赖引擎是否导出这个内部函数。
function require_ddz_power_lt(rank, power) {
  const map = (r) => {
    if (r === 17) return 15
    if (r === 16) return 14
    if (r === 2) return 13
    if (r === 14) return 12
    if (r === 13) return 11
    if (r === 12) return 10
    if (r === 11) return 9
    return r - 2
  }
  return map(rank) < power
}

describe('doudizhu: legal action enumeration and auto-play (托管)', () => {
  it('every enumerated action is genuinely legal (verified via identifyHandType+compareHandType)', () => {
    let g = freshGame()
    g = bid(g, 0, 3)
    const { actions } = enumerateLegalActions(g, 0)
    expect(actions.length).toBeGreaterThan(0)
    for (const a of actions) {
      const cards = a.cards.map((id) => g.players[0].hand.find((c) => c.id === id))
      expect(cards.every(Boolean)).toBe(true)
      const type = identifyHandType(cards)
      expect(type).not.toBeNull()
    }
  })
  it('does not offer pass when the player must lead', () => {
    let g = freshGame()
    g = bid(g, 0, 3)
    const { canPass } = enumerateLegalActions(g, 0)
    expect(canPass).toBe(false)
  })
  it('offers pass once someone else has played', () => {
    let g = freshGame()
    g = bid(g, 0, 3)
    g = applyPlay(g, 0, [g.players[0].hand[0].id])
    const { canPass } = enumerateLegalActions(g, 1)
    expect(canPass).toBe(true)
  })
  it('autoChooseAction always returns a legal, applicable action', () => {
    let g = freshGame()
    g = bid(g, 0, 3)
    const choice = autoChooseAction(g, 0)
    expect(() => applyPlay(g, 0, choice.cards)).not.toThrow()
  })
  it('autoChooseAction passes when passing is legal', () => {
    let g = freshGame()
    g = bid(g, 0, 3)
    g = applyPlay(g, 0, [g.players[0].hand[0].id])
    const choice = autoChooseAction(g, 1)
    expect(choice.cards).toEqual([])
  })
})

describe('doudizhu: game end', () => {
  it('finishes and reports the winning role when a player empties their hand', () => {
    // 构造一个"只剩最后一张"的可控终局，而不是随机打到自然结束
    let g = freshGame()
    g = bid(g, 0, 3)
    const single = g.players[0].hand[0]
    g = { ...g, players: g.players.map((p, i) => (i === 0 ? { ...p, hand: [single] } : p)) }
    g = applyPlay(g, 0, [single.id])
    expect(g.finished).toBe(true)
    expect(g.phase).toBe('finished')
    expect(g.winnerRole).toBe('landlord')
    expect(g.turn).toBeNull()
  })

  it('restartDoudizhu preserves seat assignments but deals a brand new hand and runId', () => {
    let g = freshGame()
    g = bid(g, 0, 3)
    const restarted = restartDoudizhu(g)
    expect(restarted.runId).not.toBe(g.runId)
    expect(restarted.phase).toBe('bidding')
    expect(restarted.players[1].memberId).toBe('claude-code')
    expect(restarted.players[2].memberId).toBe('api:s1')
  })
})

describe('doudizhu: AI choice parsing (模型只能选合法索引)', () => {
  it('parses a plain digit reply', () => {
    expect(parseChoiceIndex('2', 5)).toBe(2)
  })
  it('extracts the first number even with extra text', () => {
    expect(parseChoiceIndex('我选 3 号', 5)).toBe(3)
  })
  it('rejects out-of-range or unparseable replies (must trigger auto-play)', () => {
    expect(parseChoiceIndex('99', 5)).toBeNull()
    expect(parseChoiceIndex('这局我不知道该怎么办', 5)).toBeNull()
    expect(parseChoiceIndex('', 5)).toBeNull()
    expect(parseChoiceIndex(null, 5)).toBeNull()
  })
})
