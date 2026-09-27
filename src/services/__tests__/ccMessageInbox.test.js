import { describe, expect, it } from 'vitest'
import { ccReasoningUpdates, findCcReasoningTarget } from '../ccMessageInbox'

describe('CC same-id reasoning revisions', () => {
  it('targets only the first bubble of a split server reply', () => {
    const messages = [
      {
        id: 'local-part-1', role: 'assistant', wirePartIndex: 1,
        serverWireIds: ['wire-1'], timestamp: 1001,
      },
      {
        id: 'local-part-0', role: 'assistant', wirePartIndex: 0,
        serverWireIds: ['wire-1'], timestamp: 1000,
      },
    ]

    expect(findCcReasoningTarget(messages, {
      id: 'wire-1', thinking: '真实思考', ts: 2500,
    })?.id).toBe('local-part-0')
  })

  it('builds an authoritative completed patch without changing message identity', () => {
    const target = {
      id: 'local-reply', role: 'assistant', reasoningStartedAt: 1000,
      serverWireIds: ['wire-1'], timestamp: 1100,
    }

    expect(ccReasoningUpdates(target, {
      id: 'wire-1', thinking: '第一段\n第二段', ts: 4200,
    })).toEqual({
      reasoning: '第一段\n第二段',
      reasoningStartedAt: 1000,
      reasoningCompletedAt: 4200,
      reasoningDurationMs: 3200,
      reasoningStreaming: false,
    })
  })
})
