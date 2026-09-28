import { describe, expect, test } from 'bun:test'
import { remainingThinkingPaintDelay, THINKING_PAINT_GRACE_MS } from '../thinking-delivery.ts'

describe('thinking-before-reply delivery', () => {
  test('does not delay a reply when no thinking frame was emitted', () => {
    expect(remainingThinkingPaintDelay(0, 1_000)).toBe(0)
  })

  test('keeps a full render window after a fresh thinking frame', () => {
    expect(remainingThinkingPaintDelay(1_000, 1_000)).toBe(THINKING_PAINT_GRACE_MS)
    expect(remainingThinkingPaintDelay(1_000, 1_050)).toBe(THINKING_PAINT_GRACE_MS - 50)
  })

  test('does not add latency once the render window has elapsed', () => {
    expect(remainingThinkingPaintDelay(1_000, 1_000 + THINKING_PAINT_GRACE_MS)).toBe(0)
  })
})
