import { describe, expect, test } from 'bun:test'
import {
  classifyXinchaoTurn,
  parseXinchaoSemanticResult,
  visibleTurnExcerpt,
} from '../xinchao-semantic-reporter'

describe('xinchao semantic reporter', () => {
  test('parses plain or fenced JSON and maps none to no event', () => {
    expect(parseXinchaoSemanticResult('{"interaction_type":"sharing","confidence":0.91}'))
      .toEqual({ interactionType: 'sharing', confidence: 0.91 })
    expect(parseXinchaoSemanticResult('```json\n{"interaction_type":"none","confidence":0.7}\n```'))
      .toEqual({ interactionType: null, confidence: 0.7 })
  })

  test('rejects invented labels and invalid confidence', () => {
    expect(() => parseXinchaoSemanticResult('{"interaction_type":"happy","confidence":0.8}')).toThrow()
    expect(() => parseXinchaoSemanticResult('{"interaction_type":"sharing","confidence":2}')).toThrow()
  })

  test('strips control characters and enforces the visible-text cap', () => {
    expect(visibleTurnExcerpt('\u0000 你好\u0007 ', 10)).toBe('你好')
    expect(visibleTurnExcerpt('123456', 4)).toBe('1234')
  })

  test('sends only the current visible pair to the free classifier', async () => {
    let requestBody: any = null
    const fakeFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"interaction_type":"companionship","confidence":0.88}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as typeof fetch

    const result = await classifyXinchaoTurn({
      userText: '今天陪我聊会儿',
      assistantText: '当然，我在。',
      apiKey: 'test-key',
      fetchImpl: fakeFetch,
    })

    expect(result).toEqual({ interactionType: 'companionship', confidence: 0.88 })
    expect(requestBody.model).toBe('Qwen/Qwen2.5-7B-Instruct')
    expect(requestBody.max_tokens).toBe(80)
    expect(requestBody.messages).toHaveLength(2)
    expect(requestBody.messages[1].content).toContain('今天陪我聊会儿')
    expect(requestBody.messages[1].content).toContain('当然，我在。')
  })
})
