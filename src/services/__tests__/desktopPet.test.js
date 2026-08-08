import { beforeAll, describe, expect, it } from 'vitest'

let emptyGestureCounts
let totalGestureCount
let describeGestureCounts
let parseDesktopPetReaction

beforeAll(async () => {
  globalThis.localStorage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  }
  const module = await import('../desktopPet')
  ;({ emptyGestureCounts, totalGestureCount, describeGestureCounts, parseDesktopPetReaction } = module)
})

describe('desktop pet isolated reactions', () => {
  it('counts the secret hotspot without dropping ordinary gestures', () => {
    const counts = { ...emptyGestureCounts(), pet: 2, secret: 10 }
    expect(totalGestureCount(counts)).toBe(12)
    expect(describeGestureCounts(counts)).toBe('摸了2下、摸两腿之间了10下')
  })

  it('extracts the model mood marker before showing the bubble', () => {
    expect(parseDesktopPetReaction('[mood:flustered]你还真敢摸。')).toEqual({
      mood: 'flustered',
      text: '你还真敢摸。',
    })
  })

  it('falls back safely when a model ignores the requested format', () => {
    expect(parseDesktopPetReaction('别闹。')).toEqual({ mood: 'awake', text: '别闹。' })
  })
})
