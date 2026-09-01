import { describe, expect, it } from 'vitest'
import { messageListItemCount, shouldShowPendingReply } from '../messageListModel'

describe('message list pending reply model', () => {
  it('adds a presentation-only pending row while the transport is waiting', () => {
    const messages = [{ id: 'user-1', role: 'user', content: 'hi' }]
    expect(shouldShowPendingReply(messages, true)).toBe(true)
    expect(messageListItemCount(messages, true)).toBe(2)
  })

  it('does not add a duplicate row when a real assistant activity exists', () => {
    const messages = [
      { id: 'user-1', role: 'user', content: 'hi' },
      { id: 'assistant-1', role: 'assistant', content: '', streaming: true },
    ]
    expect(shouldShowPendingReply(messages, true)).toBe(false)
  })

  it('never creates a row after loading ends', () => {
    expect(shouldShowPendingReply([], false)).toBe(false)
    expect(messageListItemCount([], false)).toBe(0)
  })
})
