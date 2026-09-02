import { describe, it, expect } from 'vitest'
import { pruneReasoningBeyondTurns } from '../../utils/pruneReasoning'

// 造一段 n 轮对话：每轮一条 user + 一条带思维链的 assistant。
function makeRounds(n) {
  const msgs = []
  for (let i = 1; i <= n; i++) {
    msgs.push({ id: `u${i}`, role: 'user', content: `问题${i}` })
    msgs.push({ id: `a${i}`, role: 'assistant', content: `回答${i}`, reasoning: `思考${i}`, reasoningStreaming: false })
  }
  return msgs
}

describe('pruneReasoningBeyondTurns', () => {
  it('不足 5 轮时原样保留，不改任何消息', () => {
    const msgs = makeRounds(5)
    const { changed, messages } = pruneReasoningBeyondTurns(msgs)
    expect(changed).toHaveLength(0)
    expect(messages).toBe(msgs)
  })

  it('第 6 轮出现后，最早一轮的思维链被清掉，近 5 轮的保留', () => {
    const { changed, messages } = pruneReasoningBeyondTurns(makeRounds(6))
    expect(changed.map(m => m.id)).toEqual(['a1'])
    const byId = Object.fromEntries(messages.map(m => [m.id, m]))
    expect(byId.a1.reasoning).toBeUndefined()
    expect(byId.a1.reasoningStreaming).toBeUndefined()
    expect(byId.a1.content).toBe('回答1') // 只清思维链，正文不动
    for (let i = 2; i <= 6; i++) expect(byId[`a${i}`].reasoning).toBe(`思考${i}`)
  })

  it('长对话里只有近 5 轮保留思维链', () => {
    const { changed, messages } = pruneReasoningBeyondTurns(makeRounds(20))
    expect(changed.map(m => m.id)).toEqual(Array.from({ length: 15 }, (_, i) => `a${i + 1}`))
    const kept = messages.filter(m => m.reasoning !== undefined).map(m => m.id)
    expect(kept).toEqual(['a16', 'a17', 'a18', 'a19', 'a20'])
  })

  it('一轮多条 assistant 气泡（VPS 多气泡/主动消息）按所在轮次一起处理', () => {
    const msgs = [
      { id: 'u1', role: 'user', content: 'q1' },
      { id: 'a1a', role: 'assistant', content: 'r1a', reasoning: 't1a' },
      { id: 'a1b', role: 'assistant', content: 'r1b', reasoning: 't1b' },
      ...makeRounds(5).map(m => ({ ...m, id: `x-${m.id}` })),
    ]
    const { changed, messages } = pruneReasoningBeyondTurns(msgs)
    expect(changed.map(m => m.id)).toEqual(['a1a', 'a1b'])
    const byId = Object.fromEntries(messages.map(m => [m.id, m]))
    expect(byId['a1a'].reasoning).toBeUndefined()
    expect(byId['a1b'].reasoning).toBeUndefined()
    expect(byId['x-a5'].reasoning).toBe('思考5')
  })

  it('没有思维链的旧消息不进 changed（不做无谓持久化）', () => {
    const msgs = makeRounds(8).map(m => (m.id === 'a1' || m.id === 'a2' ? (({ reasoning, reasoningStreaming, ...rest }) => rest)(m) : m))
    const { changed } = pruneReasoningBeyondTurns(msgs)
    expect(changed.map(m => m.id)).toEqual(['a3'])
  })

  it('保留 wireIds 等其他字段', () => {
    const msgs = makeRounds(6)
    msgs[1] = {
      ...msgs[1], wireIds: ['m1', 'm2'], reasoningStartedAt: 100,
      reasoningCompletedAt: 2200, reasoningDurationMs: 2100,
    }
    const { changed } = pruneReasoningBeyondTurns(msgs)
    expect(changed[0].wireIds).toEqual(['m1', 'm2'])
    expect(changed[0].reasoningStartedAt).toBeUndefined()
    expect(changed[0].reasoningCompletedAt).toBeUndefined()
    expect(changed[0].reasoningDurationMs).toBeUndefined()
  })
})
