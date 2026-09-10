import { describe, expect, it } from 'vitest'
import { getKakaoBubbleFrame, getNineSlice } from '../../bubbleSkins'

describe('Kakao bubble skins', () => {
  it('uses 01 for the first bubble and 02 for a following bubble', () => {
    expect(getKakaoBubbleFrame('kakao-water', true, false).src).toContain('send-01')
    expect(getKakaoBubbleFrame('kakao-water', true, true).src).toContain('send-02')
    expect(getKakaoBubbleFrame('kakao-water', false, false).src).toContain('receive-01')
    expect(getKakaoBubbleFrame('kakao-water', false, true).src).toContain('receive-02')
  })

  it('converts iOS cap points into asymmetric source slices without rounding', () => {
    const frame = getKakaoBubbleFrame('kakao-candy', true, false)
    expect(getNineSlice(frame)).toEqual({
      source: '93 101 63 102 fill',
      width: '31px 33.666666666666664px 21px 34px',
    })
  })

  it('keeps the Android nine-patch one-pixel stretch cell intact', () => {
    const frame = getKakaoBubbleFrame('kakao-rainbow-bear', true, false)
    expect(getNineSlice(frame)).toEqual({
      source: '125 107 46 43 fill',
      width: '41.666666666666664px 35.666666666666664px 15.333333333333334px 14.333333333333334px',
    })
  })
})
