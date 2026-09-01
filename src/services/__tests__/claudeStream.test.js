import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamChat } from '../claude'

function mockSseResponse(parts) {
  const encoder = new TextEncoder()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part))
      controller.close()
    },
  }), { status: 200 })))
}

async function collectText(stream) {
  let text = ''
  for await (const chunk of stream) text += chunk.text || ''
  return text
}

describe('streamChat SSE parsing', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the final SSE frame when the response has no trailing newline', async () => {
    mockSseResponse([
      'data:{"choices":[{"delta":{"content":"完"}}]}\n',
      'data:{"choices":[{"delta":{"content":"整结尾"}}]}',
    ])

    const text = await collectText(streamChat({
      apiKey: 'test', apiBaseUrl: 'https://example.test/v1', model: 'test-model', messages: [],
    }))

    expect(text).toBe('完整结尾')
  })

  it('shows an explicit notice when the provider stops at its output limit', async () => {
    mockSseResponse([
      'data: {"choices":[{"delta":{"content":"正文"},"finish_reason":"length"}]}\n',
      'data: [DONE]\n',
    ])

    const text = await collectText(streamChat({
      apiKey: 'test', apiBaseUrl: 'https://example.test/v1', model: 'test-model', messages: [],
    }))

    expect(text).toContain('正文')
    expect(text).toContain('输出上限')
  })
})
