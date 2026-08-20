import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequest } from '../../../functions/api/stt'

describe('Pages STT gateway', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('forwards the multipart body and boundary to the STT Worker', async () => {
    const upstreamFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: '你好' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', upstreamFetch)
    const form = new FormData()
    form.append('password', 'test-password')
    form.append('audio', new Blob(['wav-bytes'], { type: 'audio/wav' }), 'speech.wav')
    const request = new Request('https://eunoia.xiaoman.xyz/api/stt', { method: 'POST', body: form })

    const response = await onRequest({ request })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ text: '你好' })
    expect(upstreamFetch).toHaveBeenCalledTimes(1)
    expect(upstreamFetch.mock.calls[0][0]).toBe('https://chat.xiaoman.xyz/stt')
    expect(upstreamFetch.mock.calls[0][1].headers['Content-Type']).toContain('multipart/form-data; boundary=')
  })

  it('turns an upstream network exception into a readable response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failed')))
    const form = new FormData()
    form.append('password', 'test-password')
    form.append('audio', new Blob(['wav-bytes'], { type: 'audio/wav' }), 'speech.wav')
    const request = new Request('https://eunoia.xiaoman.xyz/api/stt', { method: 'POST', body: form })

    const response = await onRequest({ request })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({ error: 'STT gateway unavailable' })
  })
})
