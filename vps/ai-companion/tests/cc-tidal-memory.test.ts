import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_TIDAL_CONFIG,
  appendOnly,
  buildRecoveryPacket,
  claimTidalPending,
  createTidalState,
  enqueueUnique,
  guardedSummaryBeforeCompact,
  inputTokensFromMessageStart,
  loadTidalState,
  manualSummaryUpdateCandidate,
  retainThroughBoundary,
  renderRollingSummary,
  saveTidalState,
  sessionIdUnchanged,
  shouldEvaluateTidalSurface,
  shouldInjectTidalStartupRecovery,
  tidalTrigger,
  tidalStatusSnapshot,
  tidalStateAfterConversationClear,
  type RollingSummary,
  type VisibleCcMessage,
} from '../cc-tidal-memory.ts'

const summary: RollingSummary = {
  relationshipIdentity: '双方保持长期陪伴关系，身份连续。'.repeat(3),
  emotionInteraction: '当前互动平稳、亲近，延续刚才的语气。'.repeat(3),
  factsCommitments: '已经确认的事实和约定都在这里。'.repeat(3),
  ongoing: '正在继续讨论潮汐式记忆改造。'.repeat(3),
  todos: '完成测试、部署和线上验证。'.repeat(3),
  preferences: '用户偏好直接执行、完整验证、不丢历史。'.repeat(3),
}

describe('CC tidal context waterline', () => {
  test('reads real input-side usage from stream-json message_start', () => {
    const tokens = inputTokensFromMessageStart({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { usage: { input_tokens: 7, cache_creation_input_tokens: 12_000, cache_read_input_tokens: 98_500 } },
      },
    })
    expect(tokens).toBe(110_507)
    expect(tidalTrigger(tokens, 0).reason).toBe('tokens')
  })

  test('ignores cumulative result usage so it cannot cause a false trigger', () => {
    const tokens = inputTokensFromMessageStart({ type: 'result', usage: { input_tokens: 999_999 } })
    expect(tokens).toBeNull()
    expect(tidalTrigger(tokens, 12)).toEqual({ trigger: false, reason: null })
  })
})

describe('two-phase safety', () => {
  test('never compacts when summary fails or has an incomplete structure', async () => {
    let compactCalls = 0
    const failed = await guardedSummaryBeforeCompact({
      summarize: async () => { throw new Error('quota') },
      compact: async () => { compactCalls++ },
    })
    const invalid = await guardedSummaryBeforeCompact({
      summarize: async () => ({ relationshipIdentity: 'only one field' }),
      compact: async () => { compactCalls++ },
    })
    expect(failed).toEqual({ ok: false, stage: 'summary' })
    expect(invalid).toEqual({ ok: false, stage: 'summary' })
    expect(compactCalls).toBe(0)
  })

  test('requires compact to preserve the exact CC session id', () => {
    expect(sessionIdUnchanged('same-session', 'same-session')).toBeTrue()
    expect(sessionIdUnchanged('same-session', 'new-session')).toBeFalse()
  })

  test('pending state, boundary, summary, session and queue survive restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tidal-state-'))
    const path = join(dir, 'state.json')
    const state = createTidalState('session-a')
    state.rollingSummary = summary
    state.processedBoundaryId = 'm-old'
    state.pending = {
      taskId: 'task-1', phase: 'compacted', triggerReason: 'tokens', boundaryId: 'm-new', boundaryTs: 2,
      sourceCount: 150, summary, summaryProvider: 'luna', contextTokens: 120_000, recoveryMarker: 'marker-1',
    }
    state.queue.push({ id: 'queued-1', text: 'later', filePath: '/opt/ai-companion/uploads/example.pdf', fileName: 'example.pdf', fileSize: 123, fileType: 'application/pdf', queuedAt: 3 })
    saveTidalState(path, state)
    const loaded = loadTidalState(path, 'different-default')
    expect(loaded.sessionId).toBe('session-a')
    expect(loaded.pending?.phase).toBe('compacted')
    expect(loaded.pending?.recoveryMarker).toBe('marker-1')
    expect(loaded.processedBoundaryId).toBe('m-old')
    expect(loaded.queue.map((q) => q.id)).toEqual(['queued-1'])
    expect(loaded.queue[0]).toMatchObject({ fileName: 'example.pdf', fileSize: 123, fileType: 'application/pdf' })
    expect(readFileSync(path, 'utf8')).toContain('relationshipIdentity')
  })
})

describe('authoritative rolling-summary management', () => {
  test('reads the current tidal summary and preserves manual edits across reload/restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tidal-manual-'))
    const path = join(dir, 'state.json')
    const initial = createTidalState('cc-session')
    initial.rollingSummary = summary
    initial.summaryRevision = 1
    initial.summaryUpdatedAt = 100
    initial.summaryModel = 'gpt-5.6-luna'
    initial.summarySource = 'automatic'
    saveTidalState(path, initial)

    const loaded = loadTidalState(path, 'unused-default')
    expect(renderRollingSummary(loaded.rollingSummary)).toBe(renderRollingSummary(summary))
    const editedText = renderRollingSummary({
      ...summary,
      ongoing: '人工纠正后的正在进行事项，会成为后续恢复读取的权威版本。'.repeat(3),
    })
    const candidate = manualSummaryUpdateCandidate(loaded, {
      sessionId: 'cc-session', expectedRevision: 1, summaryText: editedText, now: 456,
    })
    expect(candidate.ok).toBeTrue()
    if (!candidate.ok) throw new Error(candidate.code)
    saveTidalState(path, candidate.state)

    const afterRestart = loadTidalState(path, 'another-default')
    expect(renderRollingSummary(afterRestart.rollingSummary)).toBe(editedText)
    expect(afterRestart.sessionId).toBe('cc-session')
    expect(afterRestart.summaryRevision).toBe(2)
    expect(afterRestart.summaryUpdatedAt).toBe(456)
    expect(afterRestart.summarySource).toBe('manual')
    expect(afterRestart.summaryModel).toBe('gpt-5.6-luna')
  })

  test('manual summary persistence never modifies the append-only chat history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tidal-history-'))
    const statePath = join(dir, 'state.json')
    const historyPath = join(dir, 'chat-history.json')
    const originalHistory = JSON.stringify([{ id: 'u1', from: 'user', text: '私密原文' }, { id: 'a1', from: 'cc', text: '完整回复' }])
    writeFileSync(historyPath, originalHistory)
    const state = createTidalState('cc-session')
    const candidate = manualSummaryUpdateCandidate(state, {
      sessionId: 'cc-session', expectedRevision: 0, summaryText: renderRollingSummary(summary), now: 500,
    })
    expect(candidate.ok).toBeTrue()
    if (!candidate.ok) throw new Error(candidate.code)
    saveTidalState(statePath, candidate.state)
    expect(readFileSync(historyPath, 'utf8')).toBe(originalHistory)
  })

  test('version and pending-state checks prevent concurrent writes from overwriting a manual revision', () => {
    const state = createTidalState('cc-session')
    state.rollingSummary = summary
    state.summaryRevision = 4
    const first = manualSummaryUpdateCandidate(state, {
      sessionId: 'cc-session', expectedRevision: 4, summaryText: renderRollingSummary(summary), now: 600,
    })
    expect(first.ok).toBeTrue()
    if (!first.ok) throw new Error(first.code)
    const stale = manualSummaryUpdateCandidate(first.state, {
      sessionId: 'cc-session', expectedRevision: 4, summaryText: renderRollingSummary(summary), now: 601,
    })
    expect(stale).toEqual({ ok: false, code: 'version_conflict' })

    first.state.pending = {
      taskId: 'automatic', phase: 'summarizing', triggerReason: 'tokens', boundaryId: 'm1', boundaryTs: 1,
      sourceCount: 1, contextTokens: 110_000, baseSummaryRevision: first.state.summaryRevision,
    }
    const duringAutomatic = manualSummaryUpdateCandidate(first.state, {
      sessionId: 'cc-session', expectedRevision: first.state.summaryRevision, summaryText: renderRollingSummary(summary), now: 602,
    })
    expect(duringAutomatic).toEqual({ ok: false, code: 'tidal_active' })
  })

  test('reports empty, retry, failure and successful summary states', () => {
    const state = createTidalState('cc-session', 10)
    expect(tidalStatusSnapshot(state, 20).status).toBe('idle')
    state.pending = {
      taskId: 'retry', phase: 'summarizing', triggerReason: 'tokens', boundaryId: 'm1', boundaryTs: 1,
      sourceCount: 1, contextTokens: 110_000,
    }
    state.retryAt = 1_000
    state.lastRun = { status: 'retry_wait', stage: 'summary_all_failed', at: 30, retryAt: 1_000 }
    expect(tidalStatusSnapshot(state, 100)).toMatchObject({ status: 'retry_wait', retryAt: 1_000 })
    state.pending = null
    state.retryAt = null
    state.lastRun = { status: 'failed', stage: 'summary_revision_conflict', at: 40 }
    expect(tidalStatusSnapshot(state, 100).status).toBe('failed')
    state.lastRun = null
    state.rollingSummary = summary
    state.summaryUpdatedAt = 50
    expect(tidalStatusSnapshot(state, 100)).toMatchObject({ status: 'success', stage: 'existing_summary', at: 50 })
  })

  test('retired compression-review files are ignored and their routes are gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tidal-legacy-'))
    const legacyDir = join(dir, 'compression')
    mkdirSync(legacyDir)
    writeFileSync(join(legacyDir, 'summary-pending.md'), '这是一份废弃管线的摘要，不应成为潮汐权威数据。')
    const loaded = loadTidalState(join(dir, 'state', 'cc-tidal-memory.json'), 'cc-session')
    expect(loaded.rollingSummary).toBeNull()
    const serverSource = readFileSync(new URL('../channel-server.ts', import.meta.url), 'utf8')
    expect(serverSource).not.toContain("url.pathname === '/compression/")
  })
})

describe('recovery packet and isolation', () => {
  const history: VisibleCcMessage[] = Array.from({ length: 40 }, (_, i) => ({
    id: `m${i}`,
    from: i % 2 ? 'cc' : 'user',
    text: `第 ${i} 条可见原文 ${'内容'.repeat(80)}`,
    ts: i,
  }))

  test('injects all three layers once, with at most 16 recent messages and 4000 tokens', () => {
    const packet = buildRecoveryPacket({
      marker: 'unique-recovery-marker',
      coreMemory: '核心记忆摘要',
      rollingSummary: summary,
      visibleHistory: history,
      boundaryId: 'm39',
      recentMax: 16,
      tokenBudget: 4_000,
    })
    expect(packet.content.match(/unique-recovery-marker/g)?.length).toBe(1)
    expect(packet.content).toContain('第一层：现有核心记忆摘要')
    expect(packet.content).toContain('第二层：最新滚动对话摘要')
    expect(packet.content).toContain('第三层：最近可见原文')
    expect(packet.recent.length).toBeLessThanOrEqual(16)
    expect(packet.estimatedTokens).toBeLessThanOrEqual(4_000)
    expect(packet.content).toContain('session 没有更换')
    expect(packet.content).not.toContain('thinking')
  })

  test('full UI history is append-only and never trimmed by tidal processing', () => {
    const complete: VisibleCcMessage[] = []
    for (let i = 0; i < 500; i++) appendOnly(complete, history[i % history.length])
    expect(complete.length).toBe(500)
  })

  test('ordinary API, Codex and group surfaces are outside tidal evaluation', () => {
    expect(shouldEvaluateTidalSurface('main')).toBeTrue()
    expect(shouldEvaluateTidalSurface('api')).toBeFalse()
    expect(shouldEvaluateTidalSurface('codex')).toBeFalse()
    expect(shouldEvaluateTidalSurface('group')).toBeFalse()
    expect(shouldEvaluateTidalSurface('gomoku')).toBeFalse()
  })

  test('does not duplicate the recovery packet into a normally resumed session', () => {
    expect(shouldInjectTidalStartupRecovery('resumed')).toBeFalse()
    expect(shouldInjectTidalStartupRecovery('fresh')).toBeTrue()
    expect(shouldInjectTidalStartupRecovery(undefined)).toBeTrue()
  })

  test('concurrent messages deduplicate queue entries and only one tide can be claimed', () => {
    const state = createTidalState('session-a')
    const queued = { id: 'same-message', text: 'hello', queuedAt: Date.now() }
    expect(enqueueUnique(state, queued)).toBeTrue()
    expect(enqueueUnique(state, queued)).toBeFalse()
    expect(state.queue.length).toBe(1)
    const pending = {
      taskId: 'one', phase: 'summarizing' as const, triggerReason: 'visible_messages' as const,
      boundaryId: 'm1', boundaryTs: 1, sourceCount: DEFAULT_TIDAL_CONFIG.visibleThreshold, contextTokens: 0,
    }
    expect(claimTidalPending(state, pending)).toBeTrue()
    expect(claimTidalPending(state, { ...pending, taskId: 'two' })).toBeFalse()
    expect(state.pending?.taskId).toBe('one')
  })
})

describe('conversation clear modes', () => {
  test('keeps only messages through the completed summary boundary', () => {
    const items = [
      { id: 'before', ts: 10 },
      { id: 'boundary', ts: 20 },
      { id: 'after', ts: 30 },
    ]
    expect(retainThroughBoundary(items, 'boundary', 20).map((item) => item.id)).toEqual(['before', 'boundary'])
    expect(retainThroughBoundary(items, 'missing-imported-id', 20).map((item) => item.id)).toEqual(['before', 'boundary'])
  })

  test('preserve mode keeps the summary but drops transient tide state, while full mode removes it', () => {
    const state = createTidalState('old-session', 1)
    state.rollingSummary = summary
    state.processedBoundaryId = 'boundary'
    state.processedBoundaryTs = 20
    state.summaryRevision = 3
    state.queue = [{ id: 'after', text: 'new', queuedAt: 30 }]
    state.retryAt = 99
    state.lastContextTokens = 120_000

    const preserved = tidalStateAfterConversationClear(state, 'new-session', true, 40)
    expect(preserved.rollingSummary).toEqual(summary)
    expect(preserved.processedBoundaryId).toBe('boundary')
    expect(preserved.summaryRevision).toBe(3)
    expect(preserved.queue).toEqual([])
    expect(preserved.retryAt).toBeNull()
    expect(preserved.lastContextTokens).toBeNull()

    const cleared = tidalStateAfterConversationClear(state, 'new-session', false, 40)
    expect(cleared.rollingSummary).toBeNull()
    expect(cleared.processedBoundaryId).toBeNull()
    expect(cleared.summaryRevision).toBe(0)
  })
})
