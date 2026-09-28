#!/usr/bin/env bun
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { dirname, join } from 'path'
import { planConversationRewind, tidalStateAfterRewind } from '../conversation-rewind.ts'

const ROOT = process.env.AI_COMPANION_ROOT ?? '/opt/ai-companion'
const HOME_DIR = process.env.AI_COMPANION_HOME ?? '/home/companion'
const STATE_DIR = join(ROOT, 'state')
const REQUEST_FILE = process.env.AI_COMPANION_REWIND_REQUEST_FILE ?? join(STATE_DIR, 'conversation-rewind-request.json')
const RESULT_FILE = process.env.AI_COMPANION_REWIND_RESULT_FILE ?? join(STATE_DIR, 'conversation-rewind-result.json')
const SESSION_ID_FILE = process.env.AI_COMPANION_BRAIN_SESSION_ID_FILE ?? join(STATE_DIR, 'brain-session-id')
const HISTORY_FILE = process.env.AI_COMPANION_HISTORY_FILE ?? join(STATE_DIR, 'chat-history.json')
const TIDAL_STATE_FILE = process.env.AI_COMPANION_TIDAL_STATE_FILE ?? join(STATE_DIR, 'cc-tidal-memory.json')
const THINKING_FLUSH_FILE = process.env.AI_COMPANION_THINKING_FLUSH_STATE_FILE ?? join(STATE_DIR, 'thinking-flush.json')
const RESET_MARKER_FILE = process.env.AI_COMPANION_RESET_MARKER_FILE ?? join(ROOT, 'config', 'cc-reset-marker.json')
const TRANSCRIPT_DIR = process.env.AI_COMPANION_TRANSCRIPT_DIR ?? join(HOME_DIR, '.claude', 'projects', '-opt-ai-companion')

function readJson(path: string, fallback: any): any {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return fallback }
}

function atomicWrite(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, content, { mode: 0o600 })
  renameSync(tmp, path)
}

function safeCopy(path: string, backupDir: string) {
  if (existsSync(path)) copyFileSync(path, join(backupDir, path.split('/').at(-1)!))
}

function restoreCopy(path: string, backupDir: string, originallyExisted: boolean) {
  const backup = join(backupDir, path.split('/').at(-1)!)
  if (originallyExisted && existsSync(backup)) copyFileSync(backup, path)
  else if (!originallyExisted) {
    try { unlinkSync(path) } catch {}
  }
}

function writeResult(result: Record<string, unknown>) {
  atomicWrite(RESULT_FILE, JSON.stringify(result, null, 2) + '\n')
}

let requestId = 'unknown'
let backupDir: string | null = null
let touched = false
let rollbackPaths: Array<{ path: string; existed: boolean }> = []
try {
  const request = readJson(REQUEST_FILE, null)
  requestId = typeof request?.requestId === 'string' ? request.requestId : ''
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(requestId)) throw new Error('invalid_request_id')
  const sessionId = readFileSync(SESSION_ID_FILE, 'utf8').trim()
  if (!sessionId || request?.sessionId !== sessionId) throw new Error('session_mismatch')

  const transcriptPath = join(TRANSCRIPT_DIR, `${sessionId}.jsonl`)
  const transcript = readFileSync(transcriptPath, 'utf8')
  const transcriptLines = transcript.split('\n')
  if (transcriptLines.at(-1) === '') transcriptLines.pop()
  const history = readJson(HISTORY_FILE, [])
  if (!Array.isArray(history)) throw new Error('invalid_history')
  const requestedAt = Number(request?.requestedAt) || Date.now()
  const plan = planConversationRewind({
    history,
    transcriptLines,
    messageIds: request?.messageIds,
    requestedAt,
  })

  const stamp = new Date(requestedAt).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  backupDir = join(STATE_DIR, 'session-archives', `user-rewind-${stamp}-${requestId.slice(0, 12)}`)
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  rollbackPaths = [transcriptPath, HISTORY_FILE, TIDAL_STATE_FILE, THINKING_FLUSH_FILE, RESET_MARKER_FILE]
    .map(path => ({ path, existed: existsSync(path) }))
  for (const { path } of rollbackPaths) {
    safeCopy(path, backupDir)
  }
  atomicWrite(join(backupDir, 'manifest.json'), JSON.stringify({
    requestId,
    sessionId,
    requestedAt,
    targetWireId: plan.targetWireId,
    branchTailUuid: plan.branchTailUuid,
    transcriptCutoffLine: plan.transcriptCutoffLine,
    keptHistoryCount: plan.keptHistory.length,
    removedHistoryCount: plan.removedHistory.length,
  }, null, 2) + '\n')

  const keptTranscript = transcriptLines.slice(0, plan.transcriptCutoffLine)
  const tidalState = tidalStateAfterRewind(
    readJson(TIDAL_STATE_FILE, null),
    sessionId,
    plan.marker.boundaryTs,
    plan.keptIds,
    requestedAt,
  )
  const thinkingFlushState = {
    baselinePct: null,
    baselineContextTokens: null,
    baselineRecoveryTokens: null,
    contextWindowSize: null,
    recoveryPending: null,
    updatedAt: requestedAt,
  }

  touched = true
  atomicWrite(transcriptPath, keptTranscript.length ? `${keptTranscript.join('\n')}\n` : '')
  atomicWrite(HISTORY_FILE, JSON.stringify(plan.keptHistory))
  atomicWrite(TIDAL_STATE_FILE, JSON.stringify(tidalState, null, 2) + '\n')
  atomicWrite(THINKING_FLUSH_FILE, JSON.stringify(thinkingFlushState, null, 2) + '\n')
  atomicWrite(RESET_MARKER_FILE, JSON.stringify(plan.marker, null, 2) + '\n')
  try { unlinkSync(REQUEST_FILE) } catch {}
  writeResult({
    ok: true,
    requestId,
    sessionId,
    targetWireId: plan.targetWireId,
    branchTailUuid: plan.branchTailUuid,
    removedIds: plan.removedIds,
    removedCount: plan.removedHistory.length,
    marker: plan.marker,
    backupDir,
    completedAt: Date.now(),
  })
} catch (error) {
  const message = String(error instanceof Error ? error.message : error)
  if (touched && backupDir) {
    for (const { path, existed } of rollbackPaths) {
      try { restoreCopy(path, backupDir, existed) } catch {}
    }
  }
  try { unlinkSync(REQUEST_FILE) } catch {}
  writeResult({ ok: false, requestId, error: message, completedAt: Date.now() })
  process.exitCode = 1
}
