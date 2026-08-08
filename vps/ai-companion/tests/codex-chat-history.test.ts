import { describe, expect, test } from 'bun:test'
import { splitCodexReplyText, splitCompletedCodexMessage } from '../codex-chat-history'

describe('Codex chat display parity', () => {
  test('splits assistant paragraphs and explicit markers like the CC window', () => {
    expect(splitCodexReplyText('第一条\n\n第二条[SPLIT]第三条')).toEqual(['第一条', '第二条', '第三条'])
    expect(splitCodexReplyText('- a\n- b')).toEqual(['- a\n- b'])
  })

  test('keeps the original id/reasoning on the first bubble only', () => {
    let seq = 0
    const parts = splitCompletedCodexMessage({
      id: 'm1', from: 'codex', text: '一\n\n二', ts: 10, streaming: false, reasoning: '摘要',
    }, () => `new-${++seq}`)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toMatchObject({ id: 'm1', text: '一', reasoning: '摘要' })
    expect(parts[1]).toMatchObject({ id: 'new-1', text: '二' })
    expect(parts[1].reasoning).toBeUndefined()
  })
})
