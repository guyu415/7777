import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  normalizeRewindMessageIds,
  planConversationRewind,
  tidalStateAfterRewind,
} from '../conversation-rewind.ts'

const channelLine = (id: string, uuid = id, parentUuid: string | null = null) => JSON.stringify({
  uuid,
  parentUuid,
  type: 'user',
  message: { role: 'user', content: `<channel source="ai-companion" chat_id="web" message_id="${id}">hello</channel>` },
})

describe('conversation rewind planning', () => {
  it('cuts before the selected user checkpoint and removes every later wire', () => {
    const plan = planConversationRewind({
      history: [
        { id: 'u1', from: 'user', ts: 100 },
        { id: 'a1', turnId: 'u1', from: 'cc', ts: 110 },
        { id: 'u2', from: 'user', ts: 120 },
        { id: 'a2', turnId: 'u2', from: 'cc', ts: 130 },
      ],
      transcriptLines: [
        channelLine('u1'),
        JSON.stringify({ type: 'assistant', uuid: 'a1-uuid', parentUuid: 'u1' }),
        channelLine('u2', 'u2', 'a1-uuid'),
      ],
      messageIds: ['u2'],
      requestedAt: 999,
    })
    expect(plan.transcriptCutoffLine).toBe(2)
    expect(plan.keptHistory.map(item => item.id)).toEqual(['u1', 'a1'])
    expect(plan.removedIds).toEqual(['u2', 'a2'])
    expect(plan.keptIds).toEqual(['u1', 'a1'])
    expect(plan.branchTailUuid).toBe('a1-uuid')
    expect(plan.marker).toEqual({ resetAt: 999, mode: 'after_summary', boundaryId: 'a1', boundaryTs: 110 })
  })

  it('rejects assistant-only and copied message ids', () => {
    expect(() => planConversationRewind({
      history: [{ id: 'a1', from: 'cc', ts: 100 }],
      transcriptLines: [channelLine('a1')],
      messageIds: ['a1'],
    })).toThrow('user_message_not_found')
    expect(() => planConversationRewind({
      history: [{ id: 'u1', from: 'user', ts: 100 }],
      transcriptLines: [JSON.stringify({ type: 'user', message: { role: 'user', content: 'copied message_id="u1"' } })],
      messageIds: ['u1'],
    })).toThrow('transcript_checkpoint_not_found')
  })

  it('cuts at the selected turn parent so an abandoned physical tail cannot become the resumed leaf', () => {
    const plan = planConversationRewind({
      history: [
        { id: 'u1', from: 'user', ts: 100 },
        { id: 'a1', from: 'cc', ts: 110 },
        { id: 'u2', from: 'user', ts: 120 },
      ],
      transcriptLines: [
        channelLine('u1'),
        JSON.stringify({ type: 'assistant', uuid: 'a1-uuid', parentUuid: 'u1' }),
        JSON.stringify({ type: 'assistant', uuid: 'abandoned-leaf', parentUuid: 'u1' }),
        channelLine('u2', 'u2', 'a1-uuid'),
      ],
      messageIds: ['u2'],
    })
    expect(plan.transcriptCutoffLine).toBe(2)
    expect(plan.branchTailUuid).toBe('a1-uuid')
  })

  it('normalizes ids and resets unsafe tidal summaries', () => {
    expect(normalizeRewindMessageIds([' x ', 'x', '', 3])).toEqual(['x'])
    const reset = tidalStateAfterRewind({ rollingSummary: { text: 'future' }, processedBoundaryId: 'future', processedBoundaryTs: 500 }, 'same-id', 400, ['past'], 700)
    expect(reset.sessionId).toBe('same-id')
    expect(reset.rollingSummary).toBeNull()
    expect(reset.pending).toBeNull()
    const kept = tidalStateAfterRewind({ rollingSummary: { text: 'past' }, processedBoundaryId: 'past', processedBoundaryTs: 300, summaryRevision: 2, lastRun: { status: 'success' } }, 'same-id', 400, ['past'], 700)
    expect(kept.rollingSummary).toEqual({ text: 'past' })
    expect(kept.summaryRevision).toBe(2)
    expect(kept.lastContextTokens).toBeNull()
    expect(kept.lastRun).toBeNull()
  })

  it('drops a tidal summary whose timestamp fits but whose boundary belongs to the abandoned branch', () => {
    const reset = tidalStateAfterRewind({
      rollingSummary: { text: 'other branch' },
      processedBoundaryId: 'removed-id',
      processedBoundaryTs: 300,
    }, 'same-id', 400, ['retained-id'], 700)
    expect(reset.rollingSummary).toBeNull()
    expect(reset.processedBoundaryId).toBeNull()
  })

  it('applies a backup-first same-session branch cut across transcript, history, tidal state and reset marker', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'eunoia-rewind-'))
    try {
      const root = join(fixture, 'root')
      const home = join(fixture, 'home')
      const state = join(root, 'state')
      const transcriptDir = join(home, '.claude', 'projects', '-opt-ai-companion')
      mkdirSync(state, { recursive: true })
      mkdirSync(join(root, 'config'), { recursive: true })
      mkdirSync(transcriptDir, { recursive: true })
      const sessionId = 'same-session-id'
      const transcriptPath = join(transcriptDir, `${sessionId}.jsonl`)
      writeFileSync(join(state, 'brain-session-id'), `${sessionId}\n`)
      writeFileSync(transcriptPath, [
        channelLine('u1'),
        JSON.stringify({ type: 'assistant', uuid: 'a1-uuid', parentUuid: 'u1' }),
        channelLine('u2', 'u2', 'a1-uuid'),
        JSON.stringify({ type: 'assistant', uuid: 'a2-uuid', parentUuid: 'u2' }),
      ].join('\n') + '\n')
      writeFileSync(join(state, 'chat-history.json'), JSON.stringify([
        { id: 'u1', from: 'user', ts: 100 },
        { id: 'a1', from: 'cc', ts: 110 },
        { id: 'u2', from: 'user', ts: 120 },
        { id: 'a2', from: 'cc', ts: 130 },
      ]))
      writeFileSync(join(state, 'cc-tidal-memory.json'), JSON.stringify({
        version: 1, sessionId, rollingSummary: { ongoing: 'past only' },
        processedBoundaryId: 'u1', processedBoundaryTs: 100,
        pending: null, queue: [{ id: 'stale', text: 'stale' }], summaryRevision: 2,
      }))
      writeFileSync(join(state, 'thinking-flush.json'), JSON.stringify({ baselinePct: 77 }))
      writeFileSync(join(state, 'conversation-rewind-request.json'), JSON.stringify({
        version: 1,
        requestId: 'rewind-test-1234',
        sessionId,
        messageIds: ['u2'],
        requestedAt: 999,
      }))

      const testDir = dirname(fileURLToPath(import.meta.url))
      const run = spawnSync(process.execPath, [join(testDir, '..', 'scripts', 'apply-conversation-rewind.ts')], {
        env: { ...process.env, AI_COMPANION_ROOT: root, AI_COMPANION_HOME: home },
        encoding: 'utf8',
      })
      expect(run.status, run.stderr).toBe(0)
      expect(readFileSync(join(state, 'brain-session-id'), 'utf8').trim()).toBe(sessionId)
      expect(readFileSync(transcriptPath, 'utf8')).not.toContain('message_id="u2"')
      expect(JSON.parse(readFileSync(join(state, 'chat-history.json'), 'utf8')).map((item: any) => item.id)).toEqual(['u1', 'a1'])
      const tidal = JSON.parse(readFileSync(join(state, 'cc-tidal-memory.json'), 'utf8'))
      expect(tidal.processedBoundaryId).toBe('u1')
      expect(tidal.queue).toEqual([])
      const result = JSON.parse(readFileSync(join(state, 'conversation-rewind-result.json'), 'utf8'))
      expect(result).toMatchObject({ ok: true, sessionId, branchTailUuid: 'a1-uuid', removedCount: 2 })
      const marker = JSON.parse(readFileSync(join(root, 'config', 'cc-reset-marker.json'), 'utf8'))
      expect(marker).toMatchObject({ mode: 'after_summary', boundaryId: 'a1', boundaryTs: 110 })
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
