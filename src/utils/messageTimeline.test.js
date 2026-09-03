import { describe, expect, it } from 'vitest'
import {
  appendTimelineMessage,
  canonicalizeTimeline,
  isSuppressibleAssistantPlaceholder,
  reduceMessageTimeline,
  reconcileTimelineSnapshot,
  messageServerIdentityKeys,
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

  it('does not resurrect persisted loading placeholders after a reload', () => {
    const result = reduceMessageTimeline([], {
      type: 'snapshot',
      finalizeTransient: true,
      messages: [
        { id: 'empty-stream', role: 'assistant', type: 'text', content: '', timestamp: 1_800_000_000_000, streaming: true },
        { id: 'stuck-voice', role: 'assistant', type: 'text', content: 'voice text', voiceText: 'voice text', timestamp: 1_800_000_000_001, voiceLoading: true },
      ],
    })
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'stuck-voice', content: 'voice text', voiceLoading: false, voiceFailed: true })
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

  it('preserves a completed local reasoning translation across a server replay', () => {
    const result = canonicalizeTimeline([
      {
        id: 'local', conversationId: 'cc', role: 'assistant', type: 'text',
        content: '答复', reasoning: 'Thinking in English.', timestamp: 1_800_000_000_000,
        wireIds: ['wire-translation'], reasoningTranslation: '用英语思考。',
        reasoningTranslationSourceHash: 'abc123', reasoningTranslationUpdatedAt: 1234,
      },
      {
        id: 'wire-translation', conversationId: 'cc', role: 'assistant', type: 'text',
        content: '答复', reasoning: 'Thinking in English.', timestamp: 1_800_000_000_100,
        source: 'cc-proactive',
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      reasoningTranslation: '用英语思考。',
      reasoningTranslationSourceHash: 'abc123',
      reasoningTranslationUpdatedAt: 1234,
    })
  })

  it('keeps display fragments distinct while sharing one server identity', () => {
    const result = canonicalizeTimeline([
      { id: 'local-1', role: 'assistant', content: 'one', timestamp: 1000, wireIds: ['wire::part:0'], serverWireIds: ['wire'] },
      { id: 'local-2', role: 'assistant', content: 'two', timestamp: 1001, wireIds: ['wire::part:1'], serverWireIds: ['wire'] },
    ])
    expect(result.map(message => message.content)).toEqual(['one', 'two'])
    expect(messageServerIdentityKeys(result[0])).toEqual(['wire'])
    expect(messageServerIdentityKeys(result[1])).toEqual(['wire'])
  })

  it('never guesses that equal text means equal messages', () => {
    const result = canonicalizeTimeline([
      { id: 'local-old', conversationId: 'cc', role: 'assistant', type: 'text', content: 'same reply', timestamp: 1_800_000_000_000 },
      { id: 'server-old', conversationId: 'cc', role: 'assistant', type: 'text', content: 'same reply', timestamp: 1_800_000_005_000, source: 'cc-proactive' },
    ])
    expect(result.map(message => message.id)).toEqual(['local-old', 'server-old'])
  })

  it('can heal pre-wire-id duplicates only during an explicit legacy migration', () => {
    const result = canonicalizeTimeline([
      { id: 'local-old', conversationId: 'cc', role: 'assistant', type: 'text', content: 'same reply', timestamp: 1_800_000_000_000 },
      { id: 'server-old', conversationId: 'cc', role: 'assistant', type: 'text', content: 'same reply', timestamp: 1_800_000_005_000, source: 'cc-proactive' },
    ], { healLegacyDuplicates: true })
    expect(result).toHaveLength(1)
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

  it('keeps live arrival order even when transport timestamps are skewed', () => {
    const result = appendTimelineMessage([
      { id: 'late', role: 'assistant', content: 'late', timestamp: 1_800_000_003_000 },
      { id: 'early', role: 'user', content: 'early', timestamp: 1_800_000_001_000 },
    ], { id: 'middle', role: 'assistant', content: 'middle', timestamp: 1_800_000_002_000 })
    expect(result.map(message => message.id)).toEqual(['late', 'early', 'middle'])
  })

  it('keeps repeated live text when stable ids differ', () => {
    let timeline = appendTimelineMessage([], { id: 'reply-1', role: 'assistant', content: '嗯', timestamp: 3000 })
    timeline = appendTimelineMessage(timeline, { id: 'reply-2', role: 'assistant', content: '嗯', timestamp: 2000 })
    expect(timeline.map(message => message.id)).toEqual(['reply-1', 'reply-2'])
  })

  it('places a reply after its parent turn despite server clock skew', () => {
    const result = canonicalizeTimeline([
      { id: 'older', conversationId: 'cc', role: 'assistant', content: 'older', timestamp: 500 },
      { id: 'reply-a', conversationId: 'cc', role: 'assistant', content: 'answer', timestamp: 1000, replyToTurnId: 'user-a' },
      { id: 'user-a', conversationId: 'cc', role: 'user', content: 'A', timestamp: 2000 },
    ])
    expect(result.map(message => message.id)).toEqual(['older', 'user-a', 'reply-a'])
  })

  it('keeps every reply call for a turn after its user message in stable order', () => {
    const result = canonicalizeTimeline([
      { id: 'reply-1', conversationId: 'cc', role: 'assistant', content: 'one', timestamp: 1000, replyToTurnId: 'user-a' },
      { id: 'reply-2', conversationId: 'cc', role: 'assistant', content: 'two', timestamp: 1000, replyToTurnId: 'user-a' },
      { id: 'user-a', conversationId: 'cc', role: 'user', content: 'A', timestamp: 2000 },
      { id: 'user-b', conversationId: 'cc', role: 'user', content: 'B', timestamp: 3000 },
    ])
    expect(result.map(message => message.id)).toEqual(['user-a', 'reply-1', 'reply-2', 'user-b'])
  })

  it('does not move an orphan reply or attach across conversations', () => {
    const result = canonicalizeTimeline([
      { id: 'reply', conversationId: 'one', role: 'assistant', content: 'answer', timestamp: 1000, replyToTurnId: 'same-id' },
      { id: 'same-id', conversationId: 'two', role: 'user', content: 'A', timestamp: 2000 },
    ])
    expect(result.map(message => message.id)).toEqual(['reply', 'same-id'])
  })

  it('updates a stable id in place without moving it by timestamp', () => {
    const timeline = appendTimelineMessage([
      { id: 'reply', role: 'assistant', content: 'draft', timestamp: 3000, streaming: true },
      { id: 'next', role: 'user', content: 'next', timestamp: 4000 },
    ], { id: 'reply', role: 'assistant', content: 'done', timestamp: 9000, streaming: false })
    expect(timeline.map(message => message.id)).toEqual(['reply', 'next'])
    expect(timeline[0]).toMatchObject({ content: 'done', streaming: false })
  })

  it('reduces snapshot, live and patch events through one mutation vocabulary', () => {
    let timeline = reduceMessageTimeline([], {
      type: 'snapshot',
      messages: [{ id: 'a', role: 'user', content: 'a', timestamp: 1_800_000_001_000 }],
    })
    timeline = reduceMessageTimeline(timeline, {
      type: 'upsert',
      message: { id: 'b', role: 'assistant', content: 'draft', timestamp: 1_800_000_002_000, streaming: true },
    })
    timeline = reduceMessageTimeline(timeline, {
      type: 'patch', id: 'b', updates: { content: 'done', streaming: false },
    })
    expect(timeline.map(message => [message.id, message.content, message.streaming])).toEqual([
      ['a', 'a', undefined],
      ['b', 'done', false],
    ])
  })

  it('causally orders one recovered merge batch without sorting the live timeline', () => {
    const timeline = reduceMessageTimeline([], {
      type: 'merge',
      messages: [
        { id: 'reply-a', conversationId: 'cc', role: 'assistant', content: 'answer', timestamp: 1000, replyToTurnId: 'user-a' },
        { id: 'user-a', conversationId: 'cc', role: 'user', content: 'A', timestamp: 2000 },
      ],
    })
    expect(timeline.map(message => message.id)).toEqual(['user-a', 'reply-a'])
  })
})
