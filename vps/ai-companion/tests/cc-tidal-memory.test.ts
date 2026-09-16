import { describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  DEFAULT_TIDAL_CONFIG,
  appendOnly,
  buildRecoveryPacket,
  buildVerbatimRecoveryPacket,
  claimTidalPending,
  createTidalState,
  enqueueUnique,
  firstInputTokensFromTranscript,
  guardedSummaryBeforeCompact,
  inputTokensFromMessageStart,
  loadTidalState,
  manualSummaryUpdateCandidate,
  minimumRecentSummaryChars,
  recentSummaryChars,
  renderLongTermSummary,
  renderRecentSummary,
  renderRollingSummary,
  renderTidalReviewPrompt,
  saveTidalState,
  sessionIdUnchanged,
  shouldEvaluateTidalSurface,
  tidalTrigger,
  tidalConfigForWindow,
  tidalReviewMode,
  tidalStatusSnapshot,
  thinkingFlushDecision,
  summaryInput,
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
  test('scales the 1M profile safely when the active model has a 200k window', () => {
    expect(tidalConfigForWindow(DEFAULT_TIDAL_CONFIG, 1_000_000)).toEqual(DEFAULT_TIDAL_CONFIG)
    expect(tidalConfigForWindow(DEFAULT_TIDAL_CONFIG, 200_000)).toEqual({
      tokenThreshold: 140_000,
      visibleThreshold: 240,
      rawTargetTokens: 56_000,
      rawMaxTokens: 70_000,
      recoveryTokenBudget: 82_000,
      retryMs: 5 * 60_000,
    })
  })

  test('reads real input-side usage from stream-json message_start', () => {
    const tokens = inputTokensFromMessageStart({
      type: 'stream_event',
      event: {
        type: 'message_start',
        message: { usage: { input_tokens: 7, cache_creation_input_tokens: 42_000, cache_read_input_tokens: 408_500 } },
      },
    })
    expect(tokens).toBe(450_507)
    expect(tidalTrigger(tokens, 0).reason).toBe('tokens')
  })

  test('ignores cumulative result usage so it cannot cause a false trigger', () => {
    const tokens = inputTokensFromMessageStart({ type: 'result', usage: { input_tokens: 999_999 } })
    expect(tokens).toBeNull()
    expect(tidalTrigger(tokens, 12)).toEqual({ trigger: false, reason: null })
  })

  test('visible-message fallback never overrides a reliable token waterline', () => {
    expect(tidalTrigger(82_325, 153)).toEqual({ trigger: false, reason: null })
    expect(tidalTrigger(null, 240)).toEqual({ trigger: true, reason: 'visible_messages' })
  })

  test('recovers the first real post-clear waterline without counting a zero record', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tidal-first-waterline-'))
    const path = join(dir, 'session.jsonl')
    writeFileSync(path, [
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }),
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 3, cache_creation_input_tokens: 26_982, cache_read_input_tokens: 0 } } }),
      JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 1, cache_creation_input_tokens: 7_291, cache_read_input_tokens: 26_982 } } }),
    ].join('\n'))
    expect(firstInputTokensFromTranscript(path)).toBe(26_985)
  })

  test('a scheduled retry cannot be cancelled by native compact lowering the token count', () => {
    expect(tidalTrigger(28_000, 12, DEFAULT_TIDAL_CONFIG, true)).toEqual({
      trigger: true,
      reason: 'retry_recovery',
    })
    expect(tidalTrigger(28_000, 0, DEFAULT_TIDAL_CONFIG, true)).toEqual({ trigger: false, reason: null })
  })
})

describe('lightweight thinking flush', () => {
  test('checks at +20 points but skips when the recovery packet consumes most of the gain', () => {
    expect(thinkingFlushDecision({
      baselineContextTokens: 40_000,
      currentContextTokens: 80_000,
      contextWindowSize: 200_000,
      baselineRecoveryTokens: 5_000,
      currentRecoveryTokens: 35_000,
    })).toMatchObject({ action: 'skip_low_benefit', growthPercent: 20, estimatedGainPercent: 5 })
  })

  test('flushes when a 4.6 context has at least ten points of real reclaimable gain', () => {
    expect(thinkingFlushDecision({
      baselineContextTokens: 26_985,
      currentContextTokens: 108_828,
      contextWindowSize: 200_000,
      baselineRecoveryTokens: 0,
      currentRecoveryTokens: 16_447,
    })).toMatchObject({ action: 'flush' })
  })

  test('uses percentages of the active window instead of a 4.7-only token constant', () => {
    expect(thinkingFlushDecision({
      baselineContextTokens: 200_000,
      currentContextTokens: 400_000,
      contextWindowSize: 1_000_000,
      baselineRecoveryTokens: 50_000,
      currentRecoveryTokens: 130_000,
    })).toMatchObject({ action: 'flush', growthPercent: 20, estimatedGainPercent: 12 })
  })

  test('raw recovery includes only visible messages after the full-clear marker', () => {
    const packet = buildVerbatimRecoveryPacket({
      marker: 'cc-thinking-flush:test',
      sinceTs: 200,
      visibleHistory: [
        { id: 'old', from: 'user', text: '旧排障记录', ts: 100 },
        { id: 'new-user', from: 'user', text: '清空后的问题', ts: 200 },
        { id: 'new-cc', from: 'cc', text: '清空后的回答', ts: 201 },
      ],
      tokenBudget: 10_000,
    })
    expect(packet.recent.map((message) => message.id)).toEqual(['new-user', 'new-cc'])
    expect(packet.content).not.toContain('旧排障记录')
    expect(packet.content).toContain('没有旧摘要、旧档案或更早的排障记录')
    expect(packet.fitsBudget).toBeTrue()
  })

  test('persists an interrupted post-clear recovery and reuses the packet marker', () => {
    const serverSource = readFileSync(new URL('../channel-server.ts', import.meta.url), 'utf8')
    const run = serverSource.slice(
      serverSource.indexOf('async function runThinkingFlush('),
      serverSource.indexOf('function requestThinkingFlush('),
    )
    expect(run).toContain("recoveryPending: { beforePct, stage: 'clearing', startedAt }")
    expect(run).toContain("recoveryPending: { beforePct, stage: 'recovering', startedAt }")
    expect(run).toContain("startTurn(packet.marker, 'tidal_recovery', false)")
    expect(run).toContain('sendClaudeChannelNotification(packet.marker, packet.content)')
    expect(run).not.toContain("startTurn(marker, 'tidal_recovery', false)")
    expect(serverSource).toContain('if (flushState.recoveryPending)')
  })
})

describe('CC tidal review escalation', () => {
  test('waits for +5 points to ask again and +10 points to force', () => {
    expect(tidalReviewMode(45, null)).toBe('ask')
    expect(tidalReviewMode(49.9, { baselinePercent: 45, reasked: false })).toBe('wait')
    expect(tidalReviewMode(50, { baselinePercent: 45, reasked: false })).toBe('reask')
    expect(tidalReviewMode(54.9, { baselinePercent: 45, reasked: true })).toBe('wait')
    expect(tidalReviewMode(55, { baselinePercent: 45, reasked: true })).toBe('force')
  })

  test('normal review asks explicitly about a checkpoint and forced review requires one', () => {
    const option = [{ boundaryId: 'm1', boundaryTs: 1, sourceCount: 2, preservedCount: 2, preservedTokens: 100, boundaryPreview: 'closed' }]
    const normal = renderTidalReviewPrompt(option, 'm1', 'ask')
    const forced = renderTidalReviewPrompt(option, 'm1', 'force')
    expect(normal).toContain('write_checkpoint=true')
    expect(normal).toContain('write_checkpoint=false')
    expect(forced).toContain('本次不能 defer')
    expect(forced).toContain('必须写 continuity_bridge 检查点')
  })

  test('a Claude deferral is growth-gated instead of scheduling a timer retry', () => {
    const serverSource = readFileSync(new URL('../channel-server.ts', import.meta.url), 'utf8')
    const settle = serverSource.slice(serverSource.indexOf('function tidalReviewSettled()'), serverSource.indexOf('async function injectTidalRecovery()'))
    expect(settle).toContain("deferTidalReview(pending, 'review_deferred_by_cc')")
    expect(settle).not.toContain("tidalRetry('review_deferred_by_cc'")
    expect(serverSource).toContain("mode === 'force' && defer")
    expect(serverSource).toContain("forced tidal review requires write_checkpoint=true")
  })

  test('the ordinary reply transport is always loaded after clear or compaction', () => {
    const serverSource = readFileSync(new URL('../channel-server.ts', import.meta.url), 'utf8')
    expect(serverSource).toContain("_meta: { 'anthropic/alwaysLoad': true }")
    expect(serverSource).toContain('tools: { listChanged: true }')
    expect(serverSource).toContain('mcp.sendToolListChanged()')
    expect(serverSource).toContain('const resident = brainTranscriptPath()')
    expect(serverSource).toContain('if (existsSync(resident)) return resident')
    const packet = buildRecoveryPacket({
      marker: 'cc-tidal-recovery:test',
      rollingSummary: summary,
      visibleHistory: [],
      boundaryId: 'missing',
    })
    expect(packet.content).toContain('仅本条系统恢复层保持静默')
    expect(packet.content).toContain('下一条真实用户消息仍必须通过 reply')
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

  test('server never advances recovery without confirmed compaction', () => {
    const serverSource = readFileSync(new URL('../channel-server.ts', import.meta.url), 'utf8')
    expect(serverSource).toContain("return { ok: false, compacted: false, error: 'compact_timeout_or_rejected' }")
    expect(serverSource).toContain("tidalRetry('compact_retry_scheduled', compact.compacted)")
    expect(serverSource).toContain("['compacted', 'recovery_sending', 'recovering'].includes")
  })

  test('summary-writing rules never leak into the remembered relationship', () => {
    const serverSource = readFileSync(new URL('../channel-server.ts', import.meta.url), 'utf8')
    const lunaPrompt = readFileSync(new URL('../scripts/tidal-luna-summary.sh', import.meta.url), 'utf8')
    expect(serverSource).toContain('不得把近期实例附在长期事实后面')
    expect(lunaPrompt).toContain('不能记成用户偏好、事实、约定或待办')
    expect(serverSource).not.toContain('一律固定写“你（CC）”')
    expect(lunaPrompt).not.toContain('一律固定写“你（CC）”')
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
    state.queue.push({ id: 'queued-1', text: 'later', queuedAt: 3 })
    saveTidalState(path, state)
    const loaded = loadTidalState(path, 'different-default')
    expect(loaded.sessionId).toBe('session-a')
    expect(loaded.pending?.phase).toBe('compacted')
    expect(loaded.pending?.recoveryMarker).toBe('marker-1')
    expect(loaded.processedBoundaryId).toBe('m-old')
    expect(loaded.queue.map((q) => q.id)).toEqual(['queued-1'])
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

  test('large source windows require a detailed recent layer', () => {
    expect(minimumRecentSummaryChars(29)).toBe(0)
    expect(minimumRecentSummaryChars(30)).toBe(300)
    expect(minimumRecentSummaryChars(80)).toBe(500)
    expect(minimumRecentSummaryChars(314)).toBe(700)
    expect(recentSummaryChars(summary)).toBeGreaterThan(0)
  })

  test('one-turn examples cannot leak into the durable layer', () => {
    const serverSource = readFileSync(new URL('../channel-server.ts', import.meta.url), 'utf8')
    const lunaPrompt = readFileSync(new URL('../scripts/tidal-luna-summary.sh', import.meta.url), 'utf8')
    expect(serverSource).toContain('不得把近期实例附在长期事实后面')
    expect(lunaPrompt).toContain('不得把近期实例附在长期事实后面')
    expect(lunaPrompt).toContain('“本轮梦见什么”只进近期层')
  })

  test('injects the blurred archive and exact post-boundary dialogue separately', () => {
    const packet = buildRecoveryPacket({
      marker: 'unique-recovery-marker',
      rollingSummary: summary,
      visibleHistory: history,
      boundaryId: 'm23',
      tokenBudget: 260_000,
    })
    expect(packet.content.match(/unique-recovery-marker/g)?.length).toBe(1)
    expect(packet.content).toContain('已经闭合并模糊化的早期事件档案')
    expect(packet.content).toContain('边界之后保留的连续原文')
    expect(packet.content).toContain(renderRecentSummary(summary))
    expect(packet.recent.map((message) => message.id)).toEqual(history.slice(24).map((message) => message.id))
    expect(packet.fitsBudget).toBeTrue()
    expect(packet.content).toContain('session 没有更换')
    expect(packet.content).not.toContain('thinking')
  })

  test('summary input carries a bounded long-term calibration source', () => {
    const input = summaryInput(summary, history.slice(-2), '早期关系里程碑：8月6日开始固定相处。')
    expect(input).toContain('长期记忆校准参考')
    expect(input).toContain('8月6日开始固定相处')
    expect(input).toContain('上一版分层摘要')
    expect(input).toContain('经主CC确认可以模糊化的最老闭合原文')
  })

  test('normal restart recovery uses the latest dialogue beyond an old summary boundary', () => {
    const packet = buildRecoveryPacket({
      marker: 'startup-recovery',
      rollingSummary: summary,
      visibleHistory: history,
      boundaryId: 'm19',
      tokenBudget: 260_000,
    })
    expect(packet.recent.map((message) => message.id)).toEqual(history.slice(20).map((message) => message.id))
    expect(packet.content).toContain('第 39 条可见原文')
    expect(packet.content).not.toContain('第 19 条可见原文')
  })

  test('post-clear recovery also preserves the exact suffix after the summarized boundary', () => {
    const packet = buildRecoveryPacket({
      marker: 'clear-recovery',
      rollingSummary: summary,
      visibleHistory: history,
      boundaryId: 'm19',
      tokenBudget: 260_000,
    })
    expect(packet.recent.map((message) => message.id)).toEqual(history.slice(20).map((message) => message.id))
    expect(packet.content).toContain('第 39 条可见原文')
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
