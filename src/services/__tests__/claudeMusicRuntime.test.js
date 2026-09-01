import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamChat } from '../claude'

const activeSnapshot = {
  active: true,
  song: { id: '186016', name: '晴天', artists: '周杰伦' },
  positionMs: 61_234,
  currentLyric: { timeMs: 60_000, text: '故事的小黄花' },
}

const streamDone = () => new Response('data: [DONE]\n\n', {
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
})

async function runOne(options = {}) {
  const calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/music/context')) return Response.json(options.snapshot ?? activeSnapshot)
    return streamDone()
  }))

  for await (const _chunk of streamChat({
    apiKey: 'test-key',
    apiBaseUrl: options.apiBaseUrl || 'https://api.anthropic.com',
    model: 'test-model',
    systemPrompt: '基础系统提示',
    messages: [{ role: 'user', content: '请继续刚才的话题' }],
    providerName: options.providerName || '',
  })) {
    // The [DONE] frame intentionally yields nothing.
  }
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('ordinary API model request music context', () => {
  it('injects into the actual Anthropic request body, not the persisted user message', async () => {
    const calls = await runOne()
    expect(calls).toHaveLength(2)
    const contextRequest = calls[0]
    const modelRequest = calls[1]
    expect(contextRequest.url).toBe('https://companion.xiaoman.xyz/music/context')

    const body = JSON.parse(modelRequest.init.body)
    expect(body.system).toContain('song: "晴天"')
    expect(body.system).toContain('artist: "周杰伦"')
    expect(body.system).toContain('positionMs: 61234')
    expect(body.system).toContain('currentLyric: "故事的小黄花"')
    expect(body.messages).toEqual([{ role: 'user', content: '请继续刚才的话题' }])
  })

  it('injects into the OpenAI-compatible system message too', async () => {
    const calls = await runOne({ apiBaseUrl: 'https://api.example.test/v1', providerName: 'glm' })
    const body = JSON.parse(calls[1].init.body)
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('currentLyric: "故事的小黄花"')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: '请继续刚才的话题' })
  })

  it('leaves the model body unchanged when the server says playback is inactive', async () => {
    const calls = await runOne({ snapshot: { active: false } })
    const body = JSON.parse(calls[1].init.body)
    expect(body.system).toBe('基础系统提示')
    expect(body.messages).toEqual([{ role: 'user', content: '请继续刚才的话题' }])
  })
})
