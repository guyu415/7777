import { afterEach, describe, expect, it, vi } from 'vitest'
import { recognizeCloudSpeech } from '../cloudSpeech'

describe('cloud speech transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('retries a transient Safari Load failed without losing the utterance', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-password' })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Load failed'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: '你好' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(recognizeCloudSpeech(new Float32Array([0.1]), {
      workerUrl: 'https://chat.example.com',
    })).resolves.toEqual({ text: '你好' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(FormData)
    expect(fetchMock.mock.calls[1][1].body).toBeInstanceOf(FormData)
  })

  it('does not retry an authentication response', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-password' })
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(recognizeCloudSpeech(new Float32Array([0.1]), {
      workerUrl: 'https://chat.example.com',
    })).rejects.toThrow('unauthorized')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
