import { describe, expect, test } from 'bun:test'
import { summarizeFishingActivity } from '../fishing-game.ts'

describe('summarizeFishingActivity', () => {
  test('prefers a real catch highlight over the state footer', () => {
    const output = [
      '🎣 连钓 3 竿',
      '🆕 芦苇鲈 · 少见 · 31.6cm · 27点',
      '📊 {"pts":220,"turn":3}',
    ].join('\n')
    expect(summarizeFishingActivity('cast 3 stop=new', output)).toBe('🎣 自己钓了会儿鱼：🆕 芦苇鲈 · 少见 · 31.6cm · 27点')
  })

  test('falls back to the command action and remains compact', () => {
    const result = summarizeFishingActivity('buy basic_worm 10; cast 10', '🐟 渔获 8：鲫鱼×8\n📊 {"turn":10}')
    expect(result).toContain('抛了几竿')
    expect(result.length).toBeLessThanOrEqual(160)
  })
})
