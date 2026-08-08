import { describe, expect, it } from 'vitest'
import { buildCodexMessagePayload, normalizeCodexSessionId } from '../codexProtocol'

describe('Codex session request protocol', () => {
  it('carries the active session and prompt on every message', () => {
    expect(buildCodexMessagePayload({
      id: 'm1', text: 'hello', sessionId: 'session-a', prompt: 'be concise', clientTime: { formatted: 'now' },
    })).toMatchObject({ runtime: 'codex', id: 'm1', text: 'hello', sessionId: 'session-a', prompt: 'be concise' })
  })

  it('uses the legacy main session when the id is absent', () => {
    expect(normalizeCodexSessionId('')).toBe('main')
    expect(buildCodexMessagePayload({ id: 'm2', text: 'hello', clientTime: null }).sessionId).toBe('main')
  })
})
