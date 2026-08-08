export const DEFAULT_CODEX_SESSION_ID = 'main'

export function normalizeCodexSessionId(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw.length > 120) return DEFAULT_CODEX_SESSION_ID
  return raw
}

export function codexSessionStorageKey(value: unknown): string {
  const sessionId = normalizeCodexSessionId(value)
  let hash = 2166136261
  for (const char of sessionId) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  const readable = sessionId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'session'
  return `${readable}-${(hash >>> 0).toString(16)}`
}

export function effectiveCodexDeveloperInstructions(prompt: unknown, defaultInstructions: string): string {
  const value = typeof prompt === 'string' ? prompt.trim() : ''
  return value || defaultInstructions
}

export function buildCodexContextMigrationText(history: Array<{ from?: string; text?: string }> = []): string {
  const recent = history
    .filter((item) => item?.from === 'user' || item?.from === 'codex')
    .slice(-20)
    .map((item) => `${item.from === 'user' ? '用户' : '你'}：${String(item.text || '').slice(0, 500)}`)
    .join('\n')
  return recent ? `【上下文迁移】以下是原对话中最近的内容，请保持上下文连续，不要主动复述：\n${recent}` : ''
}

// A persisted thread is the strongest recovery anchor. The visible chat log
// is the fallback anchor when an app-server update/corruption makes that
// thread impossible to resume or fork. System-only notices do not create a
// conversation worth eagerly rebuilding after a restart.
export function codexSessionNeedsRecovery(
  threadId: unknown,
  history: Array<{ from?: string }> = [],
): boolean {
  if (typeof threadId === 'string' && threadId.trim()) return true
  return history.some((item) => item?.from === 'user' || item?.from === 'codex')
}

export type CodexRuntimeRestartSnapshot = {
  processRunning: boolean
  activeTurns: number
}

export type CodexRuntimeRestartDecision = {
  allowed: boolean
  reason: 'not_running' | 'idle' | 'forced' | 'active_turn'
}

// Keep the operator-facing restart policy pure and independently testable.
// A normal Codex restart must never interrupt an in-flight turn by accident;
// an explicit force is required when an operator has already warned that the
// Codex window will be interrupted. This policy says nothing about CC: the
// controller only ever targets the Codex child process.
export function codexRuntimeRestartDecision(
  snapshot: CodexRuntimeRestartSnapshot,
  force = false,
): CodexRuntimeRestartDecision {
  if (!snapshot.processRunning) return { allowed: true, reason: 'not_running' }
  if (snapshot.activeTurns > 0 && !force) return { allowed: false, reason: 'active_turn' }
  return { allowed: true, reason: force ? 'forced' : 'idle' }
}
