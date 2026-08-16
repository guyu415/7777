import { describe, expect, it } from 'vitest'
import { composeCouplesCardMessage, COUPLES_TOD_CARDS, drawCouplesCard } from '../couplesTruthOrDare'

describe('couples truth or dare deck', () => {
  it('draws from the requested level and type', () => {
    const card = drawCouplesCard({ level: 'sweet', type: 'truth', random: () => 0 })
    expect(COUPLES_TOD_CARDS.sweet.truth).toContainEqual(card)
  })

  it('does not immediately repeat a card when alternatives exist', () => {
    const first = COUPLES_TOD_CARDS.adult.dare[0]
    const next = drawCouplesCard({ level: 'adult', type: 'dare', previousId: first.id, random: () => 0 })
    expect(next.id).not.toBe(first.id)
  })

  it('draws randomly across the complete deck when no intensity is selected', () => {
    const last = drawCouplesCard({ level: 'all', type: 'truth', random: () => 0.999999 })
    expect(COUPLES_TOD_CARDS.adult.truth).toContainEqual(last)
  })

  it('combines the drawn card and the next real message into one turn', () => {
    const message = composeCouplesCardMessage({ round: 3, target: 'user', aiName: 'CC', type: 'truth', card: { text: '测试题' } }, '这是我的回答')
    expect(message).toBe('【第 3 轮｜我抽到真心话】\n测试题\n\n这是我的回答')
  })

  it('sends a CC-drawn card as one concise turn without fake instructions', () => {
    const message = composeCouplesCardMessage({ round: 2, target: 'ai', aiName: 'CC', type: 'dare', card: { text: '完成这个挑战' } }, '')
    expect(message).toBe('【第 2 轮｜CC抽到大冒险】\n完成这个挑战')
  })
})
