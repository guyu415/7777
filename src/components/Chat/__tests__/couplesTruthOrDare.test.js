import { describe, expect, it } from 'vitest'
import { buildCouplesTurnPrompt, COUPLES_TOD_CARDS, drawCouplesCard } from '../couplesTruthOrDare'

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

  it('builds a CC-addressed turn prompt with consent-aware instructions', () => {
    const prompt = buildCouplesTurnPrompt({ round: 3, target: 'ai', aiName: 'CC', type: 'truth', level: 'intimate', card: { text: '测试题' } })
    expect(prompt).toContain('第 3 轮')
    expect(prompt).toContain('轮到CC')
    expect(prompt).toContain('测试题')
    expect(prompt).toContain('伴侣身份')
  })
})
