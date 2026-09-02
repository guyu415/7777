import { describe, expect, it } from 'vitest'
import { formatReasoningSeconds, getReasoningDurationMs } from '../reasoningTiming'

describe('reasoning timing', () => {
  it('uses the saved duration once reasoning is complete', () => {
    expect(getReasoningDurationMs({ reasoning: '摘要', reasoningDurationMs: 2450 }, 99999)).toBe(2450)
    expect(formatReasoningSeconds(2450)).toBe('2 秒')
  })

  it('catches up a live counter after a suspended foreground timer', () => {
    expect(getReasoningDurationMs({ reasoningStreaming: true, reasoningStartedAt: 1000 }, 7600)).toBe(6600)
  })

  it('does not invent a one-second duration for legacy reasoning', () => {
    expect(getReasoningDurationMs({ reasoning: '旧摘要' })).toBeNull()
    expect(formatReasoningSeconds(null)).toBeNull()
  })
})
