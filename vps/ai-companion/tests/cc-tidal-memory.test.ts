import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
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
  saveTidalState,
  sessionIdUnchanged,
  shouldEvaluateTidalSurface,
  tidalTrigger,
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
