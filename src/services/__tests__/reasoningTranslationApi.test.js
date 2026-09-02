import { afterEach, describe, expect, it, vi } from 'vitest'

describe('thinking translation API', () => {
  const stubBrowserStorage = () => vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  })

  afterEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it('sends the complete segment with cookie credentials and optional context', async () => {
    stubBrowserStorage()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '这是完整译文。' }) })
    vi.stubGlobal('fetch', fetchMock)
    const { translateThinking } = await import('../companion.js')
    const controller = new AbortController()
    await expect(translateThinking({ text: '  The answer may be uncertain.\n', context: 'Previous sentence.', signal: controller.signal })).resolves.toBe('这是完整译文。')
    expect(fetchMock).toHaveBeenCalledWith('https://companion.xiaoman.xyz/thinking/translate', expect.objectContaining({
      credentials: 'include', method: 'POST', signal: controller.signal,
    }))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ text: '  The answer may be uncertain.\n', context: 'Previous sentence.' })
  })

  it('turns an empty backend result into a local failure for raw fallback', async () => {
    stubBrowserStorage()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: '' }) }))
    const { translateThinking } = await import('../companion.js')
    await expect(translateThinking({ text: 'The request failed.' })).rejects.toThrow('thinking translation returned no text')
  })
})
