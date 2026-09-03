import { describe, expect, test } from 'bun:test'
import { addAnniversaryEvent, anniversaryRange, defaultAnniversaryState, isAnniversaryDate, normalizeAnniversaryState } from '../anniversary.ts'

describe('anniversary store', () => {
  test('validates real calendar dates', () => {
    expect(isAnniversaryDate('2026-09-03')).toBe(true)
    expect(isAnniversaryDate('2026-02-30')).toBe(false)
  })

  test('persists a bedtime note in the same date range used by the anniversary UI', () => {
    const state = addAnniversaryEvent(defaultAnniversaryState(1), '2026-09-03', '🌙 睡前英文寄语｜Rest well.｜好好休息。', 2)
    expect(anniversaryRange(state, '2026-09-01', '2026-09-30')['2026-09-03'][0].text).toContain('Rest well.')
    expect(normalizeAnniversaryState(state, 3)).toEqual(state)
  })
})
