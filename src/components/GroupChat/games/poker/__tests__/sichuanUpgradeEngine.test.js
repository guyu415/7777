import { describe, expect, it } from 'vitest'
import {
  autoChooseBury, autoChoosePlay, buryCards, callTrump, compareTrickCards,
  createSichuanUpgradeGame, currentCallOption, effectiveSuit, enumerateLegalCards,
  nextLevel, playUpgradeCard, settleUpgradeRound, trumpPower,
} from '../sichuanUpgradeEngine'

const c = (id, suit, rank) => ({ id, suit, rank })
const players = [0, 1, 2, 3].map((i) => ({ name: `p${i}`, team: i % 2, hand: [] }))
const base = {
  players, dealer: 0, dealerTeam: 0, levelRank: 14, trumpSuit: '♥',
  phase: 'playing', turn: 0, trick: [], history: [], defenderScore: 0,
}

describe('四川版升级规则', () => {
  it('级别从 A 开始并按 A 2 3…K 推进', () => {
    expect(nextLevel(14, 1)).toEqual({ rank: 2, completed: false })
    expect(nextLevel(14, 2)).toEqual({ rank: 3, completed: false })
    expect(nextLevel(13, 1)).toEqual({ rank: 14, completed: true })
  })

  it('主级牌、副级牌和王的大小正确', () => {
    const mainA = c('ha', '♥', 14)
    const sideA = c('sa', '♠', 14)
    const joker = c('j', 'joker', 16)
    expect(effectiveSuit(sideA, base)).toBe('trump')
    expect(trumpPower(mainA, base)).toBeGreaterThan(trumpPower(sideA, base))
    expect(trumpPower(joker, base)).toBeGreaterThan(trumpPower(mainA, base))
  })

  it('有首家花色时必须跟牌', () => {
    const state = {
      ...base,
      turn: 1,
      trick: [{ player: 0, card: c('s9', '♠', 9) }],
      players: players.map((p, i) => i === 1 ? { ...p, hand: [c('s3', '♠', 3), c('d2', '♦', 2), c('h3', '♥', 3)] } : p),
    }
    expect(enumerateLegalCards(state, 1).map((x) => x.id)).toEqual(['s3'])
  })

  it('主牌压过首家副牌', () => {
    expect(compareTrickCards(c('h3', '♥', 3), c('sk', '♠', 13), '♠', base)).toBeGreaterThan(0)
  })

  it.each([
    [0, 2, 0, '庄家队守庄成功，连升两级'],
    [40, 1, 0, '庄家队守庄成功，升一级'],
    [45, 0, 1, '闲家队上台，本级重打'],
    [50, 0, 1, '闲家队上台，本级重打'],
    [55, 1, 1, '闲家队上台并升一级'],
  ])('闲家得分 %s 的结算正确', (score, steps, winnerTeam, description) => {
    const result = settleUpgradeRound({ ...base, defenderScore: score })
    expect(result.result.steps).toBe(steps)
    expect(result.result.winnerTeam).toBe(winnerTeam)
    expect(result.result.description).toBe(description)
  })

  it('完整自动牌局会在48次出牌后正常结算', () => {
    const seats = [0, 1, 2, 3].map((i) => ({ kind: i ? 'ai' : 'user', name: `p${i}` }))
    let game = createSichuanUpgradeGame(seats)
    const option = currentCallOption(game)
    game = callTrump(game, option.seat, true)
    game = buryCards(game, game.dealer, autoChooseBury(game, game.dealer))
    let plays = 0
    while (!game.finished && plays < 49) {
      game = playUpgradeCard(game, game.turn, autoChoosePlay(game, game.turn))
      plays += 1
    }
    expect(plays).toBe(48)
    expect(game.finished).toBe(true)
    expect(game.players.every((p) => p.hand.length === 0)).toBe(true)
    expect(game.history.filter((h) => h.type === 'trick')).toHaveLength(12)
  })
})
