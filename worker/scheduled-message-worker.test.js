import { describe, expect, it } from 'vitest'
import { isFixedVpsSession, ordinaryProactiveEnabled, vpsPushTitle } from './scheduled-message-worker.js'

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

describe('VPS push sender title', () => {
  it('identifies an untitled resident-session push as CC', () => {
    expect(vpsPushTitle({})).toBe('CC')
    expect(vpsPushTitle({ title: '' })).toBe('CC')
  })

  it('preserves explicit titles for other VPS notices', () => {
    expect(vpsPushTitle({ title: 'CC 的后台小记' })).toBe('CC 的后台小记')
  })
})
