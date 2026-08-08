import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_CODEX_SESSION_ID,
  normalizeCodexSessionId,
  codexSessionStorageKey,
  effectiveCodexDeveloperInstructions,
  buildCodexContextMigrationText,
  codexSessionNeedsRecovery,
  codexRuntimeRestartDecision,
} from '../codex-session.ts'

describe('Codex session prompt protocol helpers', () => {
  test('empty prompt keeps the existing default, while custom text replaces it', () => {
    expect(effectiveCodexDeveloperInstructions('', 'DEFAULT')).toBe('DEFAULT')
    expect(effectiveCodexDeveloperInstructions('  ', 'DEFAULT')).toBe('DEFAULT')
    expect(effectiveCodexDeveloperInstructions('  custom rules  ', 'DEFAULT')).toBe('custom rules')
  })

  test('missing or oversized session ids fall back to the legacy main session', () => {
    expect(normalizeCodexSessionId(undefined)).toBe(DEFAULT_CODEX_SESSION_ID)
    expect(normalizeCodexSessionId('  ')).toBe(DEFAULT_CODEX_SESSION_ID)
    expect(normalizeCodexSessionId('session-a')).toBe('session-a')
    expect(normalizeCodexSessionId('x'.repeat(121))).toBe(DEFAULT_CODEX_SESSION_ID)
  })

  test('context migration is bounded and preserves chronological order', () => {
    const history = [
      { from: 'system', text: 'ignore' },
      { from: 'user', text: 'first' },
      { from: 'codex', text: 'second' },
    ]
    expect(buildCodexContextMigrationText(history)).toContain('用户：first\n你：second')
    expect(buildCodexContextMigrationText([])).toBe('')
  })

  test('session storage keys isolate punctuation and separate conversations', () => {
    expect(codexSessionStorageKey('a/b')).not.toBe(codexSessionStorageKey('a_b'))
    expect(codexSessionStorageKey('main')).toContain('main-')
  })

  test('Codex restart is isolated and safe by default', () => {
    expect(codexRuntimeRestartDecision({ processRunning: false, activeTurns: 0 })).toEqual({
      allowed: true,
      reason: 'not_running',
    })
    expect(codexRuntimeRestartDecision({ processRunning: true, activeTurns: 0 })).toEqual({
      allowed: true,
      reason: 'idle',
    })
    expect(codexRuntimeRestartDecision({ processRunning: true, activeTurns: 1 })).toEqual({
      allowed: false,
      reason: 'active_turn',
    })
    expect(codexRuntimeRestartDecision({ processRunning: true, activeTurns: 1 }, true)).toEqual({
      allowed: true,
      reason: 'forced',
    })
  })

  test('restart recovery uses either the persisted thread or visible conversation', () => {
    expect(codexSessionNeedsRecovery('thread-123')).toBe(true)
    expect(codexSessionNeedsRecovery(null, [{ from: 'user' }])).toBe(true)
    expect(codexSessionNeedsRecovery(null, [{ from: 'codex' }])).toBe(true)
    expect(codexSessionNeedsRecovery(null, [{ from: 'system' }])).toBe(false)
    expect(codexSessionNeedsRecovery(null, [])).toBe(false)
  })
})
