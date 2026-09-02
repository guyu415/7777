import { describe, expect, it } from 'vitest'
import { parseReadingAction } from '../aiReading'

const paragraph = {
  id: 'p-1',
  text: '风从窗边进来，带着雨后的凉意。它没有催促谁。',
}

describe('aiReading structured actions', () => {
  it('accepts a JSON action and keeps the exact paragraph locator', () => {
    const result = parseReadingAction(JSON.stringify({
      action: 'annotate',
      paragraphId: 'p-1',
      quote: '风从窗边进来',
      annotation: '风把场景和情绪轻轻连在了一起。',
      interest: 0.8,
    }), paragraph)

    expect(result).toEqual({
      action: 'annotate',
      paragraphId: 'p-1',
      quote: '风从窗边进来',
      annotation: '风把场景和情绪轻轻连在了一起。',
      interest: 0.8,
    })
  })

  it('recovers fenced or wrapped model output without accepting a wrong quote', () => {
    const result = parseReadingAction('这里是动作：\n```json\n{"action":"highlight","paragraphId":"wrong","quote":"不在正文","interest":2}\n```', paragraph)

    expect(result.action).toBe('highlight')
    expect(result.paragraphId).toBe('p-1')
    expect(result.quote).toBe('风从窗边进来，带着雨后的凉意。')
    expect(result.interest).toBe(1)
  })

  it('defaults malformed output to a quiet continue action', () => {
    expect(parseReadingAction('not json', paragraph)).toMatchObject({
      action: 'continue',
      paragraphId: 'p-1',
      quote: '',
      annotation: '',
    })
  })
})
