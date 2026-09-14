import { describe, expect, it } from 'vitest'
import { buildSpicyVisual, spicyRollDelivery, spicyRollUserText } from '../spicy-monopoly'

describe('spicy monopoly direct board rolls', () => {
  it('renders an engine dice result as a native chat dice bubble', () => {
    expect(spicyRollUserText({ dice: 5 })).toBe('[DICE:5]')
    expect(spicyRollUserText({ dice: null })).toBe('继续回合')
  })

  it('builds a monotonic visual event from authoritative engine state', () => {
    const visual = buildSpicyVisual(
      { game_id: 'game-1', visual: { event: { seq: 200 } } },
      {
        board: '棋盘 〔回合 4/12〕',
        positions: { 小满: 8, CC: 3 },
        coins: { 小满: 2, CC: 1 },
        laps: { 小满: 0, CC: 0 },
        turn: 'CC',
      },
      { who: '小满', dice: 6, tile: 'mystery' },
      100,
    )

    expect(visual).toMatchObject({
      game_id: 'game-1',
      round: 4,
      total_rounds: 12,
      turn: 'CC',
      event: { seq: 201, who: '小满', dice: 6, tile: 'mystery' },
    })
    expect(visual.tiles).toHaveLength(20)
    expect(visual.tiles[5]).toBe('chance')
  })

  it('tells CC to narrate the existing result without rolling again', () => {
    const delivery = spicyRollDelivery({ dice: 3, task: { content: '测试任务' }, board: 'large board' })
    expect(delivery).toContain('不要调用 roll_dice')
    expect(delivery).toContain('测试任务')
    expect(delivery).not.toContain('large board')
  })
})
