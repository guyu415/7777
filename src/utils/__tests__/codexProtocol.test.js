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

  it('carries split user bubbles as one ordered turn payload', () => {
    expect(buildCodexMessagePayload({ id: 'm3', text: '一\n二', segments: ['一', '二'], sessionId: 's1' })).toMatchObject({
      text: '一\n二', segments: ['一', '二'], sessionId: 's1',
    })
  })
})
