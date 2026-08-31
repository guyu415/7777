import { describe, expect, it } from 'vitest'
import {
  appendTimelineMessage,
  canonicalizeTimeline,
  isSuppressibleAssistantPlaceholder,
  reconcileTimelineSnapshot,
} from './messageTimeline'

describe('message timeline', () => {
  it('normalizes seconds and puts missing timestamps at the tail instead of the front', () => {
    const now = 1_800_000_000_000
    const result = canonicalizeTimeline([
      { id: 'old', role: 'user', content: 'old', timestamp: 1_700_000_000 },
      { id: 'missing', role: 'assistant', content: 'new', timestamp: undefined },
      { id: 'middle', role: 'assistant', content: 'middle', timestamp: 1_750_000_000_000 },
    ], { now })
    expect(result.map(message => message.id)).toEqual(['old', 'middle', 'missing'])
    expect(result[0].timestamp).toBe(1_700_000_000_000)
  })

  it('drops finalized empty assistant bubbles but suppresses a live empty placeholder', () => {
    const empty = { id: 'empty', role: 'assistant', type: 'text', content: '', timestamp: 1_800_000_000_000, streaming: false }
    const live = { id: 'live', role: 'assistant', type: 'text', content: '', timestamp: 1_800_000_000_001, streaming: true }
    expect(canonicalizeTimeline([empty])).toEqual([])
    expect(isSuppressibleAssistantPlaceholder(live)).toBe(true)
  })

  it('dedupes by wire id and preserves the richer local bubble', () => {
    const result = canonicalizeTimeline([
      { id: 'local', conversationId: 'cc', role: 'assistant', type: 'text', content: 'hello', timestamp: 1_800_000_000_000, wireIds: ['wire-1'], reasoning: 'r' },
      { id: 'wire-1', conversationId: 'cc', role: 'assistant', type: 'text', content: 'hello', timestamp: 1_800_000_000_100, source: 'cc-proactive' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('local')
    expect(result[0].wireIds).toContain('wire-1')
    expect(result[0].reasoning).toBe('r')
  })

  it('heals legacy CC duplicates that predate wireIds', () => {
    const result = canonicalizeTimeline([
      { id: 'local-old', conversationId: 'cc', role: 'assistant', type: 'text', content: 'same reply', timestamp: 1_800_000_000_000 },
      { id: 'server-old', conversationId: 'cc', role: 'assistant', type: 'text', content: 'same reply', timestamp: 1_800_000_005_000, source: 'cc-proactive' },
    ])
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('local-old')
    expect(result[0].wireIds).toContain('server-old')
  })

  it('keeps a message that arrived after a stale snapshot started loading', () => {
    const current = [
      { id: 'a', conversationId: 'cc', role: 'user', content: 'a', timestamp: 1_800_000_001_000 },
      { id: 'fresh', conversationId: 'cc', role: 'assistant', content: 'fresh', timestamp: 1_800_000_003_000 },
    ]
    const snapshot = [
      { id: 'a', conversationId: 'cc', role: 'user', content: 'a', timestamp: 1_800_000_001_000 },
      { id: 'b', conversationId: 'cc', role: 'assistant', content: 'b', timestamp: 1_800_000_002_000 },
    ]
    const result = reconcileTimelineSnapshot(current, snapshot)
    expect(result.map(message => message.id)).toEqual(['a', 'b', 'fresh'])
  })

  it('inserts live messages chronologically instead of blindly appending', () => {
    const result = appendTimelineMessage([
      { id: 'late', role: 'assistant', content: 'late', timestamp: 1_800_000_003_000 },
      { id: 'early', role: 'user', content: 'early', timestamp: 1_800_000_001_000 },
    ], { id: 'middle', role: 'assistant', content: 'middle', timestamp: 1_800_000_002_000 })
    expect(result.map(message => message.id)).toEqual(['early', 'middle', 'late'])
  })
})
