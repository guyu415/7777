import { describe, expect, it } from 'vitest'
import { resolveHexagram, __fortuneTest } from './fortune.js'

describe('fortune formal casting', () => {
  it('keeps Liu Yao lines bottom-up: Earth over Heaven is Tai', () => {
    const gua = resolveHexagram([7, 7, 7, 8, 8, 8])
    expect(gua).toMatchObject({ number: 11, name: '泰', lower: '乾', upper: '坤' })
  })

  it('maps moving lines into the changed hexagram without reversing upper/lower', () => {
    const gua = resolveHexagram([9, 7, 7, 8, 8, 8])
    expect(gua.moving).toEqual([1])
    expect(gua.lower).toBe('乾')
    expect(gua.upper).toBe('坤')
  })

  it('calculates Xiao Liu Ren palaces from the reported numbers in sequence', () => {
    const result = __fortuneTest.xiaoliurenFromNumbers([1, 1, 1])
    expect(result.palaces).toEqual(['大安', '大安', '大安'])
  })

  it('keeps RWS tarot ids stable from the first major to the last minor', () => {
    expect(__fortuneTest.tarotCardById('major00')).toMatchObject({ name: '愚者', wiki: 'RWS_Tarot_00_Fool.jpg' })
    expect(__fortuneTest.tarotCardById('pentacles14')).toMatchObject({ name: '星币国王', wiki: 'Pents14.jpg' })
  })
})
