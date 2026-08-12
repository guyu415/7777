import { describe, expect, it } from 'vitest'
import { normalizeBubbleTextColor, themeWithUserBubbleText } from '../bubbleColors'

describe('user bubble text color', () => {
  it('accepts only full hex colors', () => {
    expect(normalizeBubbleTextColor('#fff7e6')).toBe('#FFF7E6')
    expect(normalizeBubbleTextColor('red')).toBeNull()
    expect(normalizeBubbleTextColor('#fff')).toBeNull()
  })

  it('overrides only user text while preserving the selected theme', () => {
    const theme = { primary: '#ff85b3', userBubbleText: '#F0C040' }
    expect(themeWithUserBubbleText(theme, '#ffffff')).toEqual({ primary: '#ff85b3', userBubbleText: '#FFFFFF' })
    expect(themeWithUserBubbleText(theme, null)).toBe(theme)
  })
})
