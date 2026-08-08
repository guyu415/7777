import { describe, expect, it } from 'vitest'
import { isFixedVpsSession, ordinaryProactiveEnabled } from './scheduled-message-worker.js'

describe('ordinary proactive target separation', () => {
  it('treats both CC and Codex fixed runtimes as non-API targets', () => {
    expect(isFixedVpsSession({ providerName: 'claude-code-vps' })).toBe(true)
    expect(isFixedVpsSession({ providerName: 'codex-vps' })).toBe(true)
    expect(isFixedVpsSession({ providerName: 'anthropic' })).toBe(false)
    expect(isFixedVpsSession({ providerName: '' })).toBe(false)
  })

  it('keeps old behaviour for settings written before the global switch', () => {
    expect(ordinaryProactiveEnabled({})).toBe(true)
    expect(ordinaryProactiveEnabled({ apiProactiveEnabled: true })).toBe(true)
    expect(ordinaryProactiveEnabled({ apiProactiveEnabled: false })).toBe(false)
  })
})
