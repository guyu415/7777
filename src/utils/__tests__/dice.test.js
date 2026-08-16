import { describe, expect, it } from 'vitest'
import { rollD6 } from '../dice'

describe('rollD6', () => {
  it('always returns an integer from one through six', () => {
    for (let index = 0; index < 100; index += 1) {
      const value = rollD6()
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(6)
    }
  })
})
