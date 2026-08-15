import { describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseTranscript, searchTurns, type DialogueTurn } from '../chat-history-mcp.ts'

const turns: DialogueTurn[] = [
  { sessionId: 's1', turnId: 't1', timestamp: '2026-08-01T10:00:00.000Z', user: '我有点害怕每次摘要以后你就不像原来的你了', cc: ['我明白，你在意的是连续性，不只是事实还在。'] },
  { sessionId: 's1', turnId: 't2', timestamp: '2026-08-01T10:02:00.000Z', user: '那我们先不改模型配置', cc: ['好，核心配置不动。'] },
  { sessionId: 's1', turnId: 't3', timestamp: '2026-08-05T12:00:00.000Z', user: '潮汐记忆应该尽量保留原文', cc: ['只在实在放不下时模糊最早的部分。'] },
  { sessionId: 's2', turnId: 't4', timestamp: '2026-08-09T09:00:00.000Z', user: '你还记得之前聊连续性的那次吗', cc: ['我去找一下原话。'] },
]

describe('chat history cold-archive retrieval', () => {
  test('returns several relevant hits with adjacent turns in one bounded call', () => {
    const result = searchTurns(turns, { query: '连续性', limit: 2, contextTurns: 1 })
    expect(result).toContain('本次从第 1 个起返回 2 个')
    expect(result).toContain('【命中轮次】')
    expect(result).toContain('【后一轮上下文】')
    expect(result).toContain('turn_id=t1')
    expect(result).toContain('turn_id=t4')
  })

  test('supports date ranges and direct turn expansion', () => {
    const dated = searchTurns(turns, { query: '原文', startTime: '2026-08-05', endTime: '2026-08-05', contextTurns: 0 })
    expect(dated).toContain('turn_id=t3')
    expect(dated).not.toContain('turn_id=t1')

    const around = searchTurns(turns, { aroundTurnId: 't2', contextTurns: 1, limit: 1 })
    expect(around).toContain('turn_id=t1')
    expect(around).toContain('turn_id=t2')
    expect(around).toContain('turn_id=t3')
  })

  test('uses conservative Chinese lexical similarity for paraphrased recollections', () => {
    const result = searchTurns(turns, { query: '潮汐记忆尽量留下原文', limit: 1, contextTurns: 0 })
    expect(result).toContain('turn_id=t3')
  })

  test('never indexes internal tidal review prompts as user speech', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chat-history-review-'))
    const path = join(dir, 'session.jsonl')
    const rows = [
      { type: 'user', sessionId: 's', uuid: 'internal', timestamp: '2026-08-01T00:00:00Z', message: { content: '<channel source="ai-companion" user="user">[系统内部潮汐维护，不是用户消息] review</channel>' } },
      { type: 'user', sessionId: 's', uuid: 'real', timestamp: '2026-08-01T00:01:00Z', message: { content: '<channel source="ai-companion" user="user">真正的用户原话</channel>' } },
    ]
    writeFileSync(path, rows.map((row) => JSON.stringify(row)).join('\n'))
    expect(parseTranscript(path, 's').map((turn) => turn.turnId)).toEqual(['real'])
  })
})
