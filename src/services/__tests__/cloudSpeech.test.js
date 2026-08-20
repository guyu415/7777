import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloudSpeechEndpoint, recognizeCloudSpeech } from '../cloudSpeech'

describe('cloud speech transport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('uses a same-origin gateway on the production PWA', () => {
    expect(cloudSpeechEndpoint('https://chat.xiaoman.xyz', {
      hostname: 'eunoia.xiaoman.xyz',
    })).toBe('/api/stt')
    expect(cloudSpeechEndpoint('https://chat.xiaoman.xyz', {
      hostname: 'localhost',
    })).toBe('https://chat.xiaoman.xyz/stt')
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
    })).resolves.toEqual({ text: '你好', emotion: 'unknown', event: '', language: '', acoustics: null, engine: 'unknown' })
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

  it('preserves a real acoustic emotion returned by SenseVoice', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-password' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      text: '别烦我', emotion: 'angry', event: 'SPEECH', language: 'zh', engine: 'sensevoice+opensmile',
      acoustics: { pitchHz: 180, pitchRangeSemitones: 8.2, hnrDb: 12.4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })))

    await expect(recognizeCloudSpeech(new Float32Array([0.1]), {
      workerUrl: 'https://chat.example.com',
    })).resolves.toMatchObject({ text: '别烦我', emotion: 'angry', engine: 'sensevoice+opensmile', acoustics: { pitchHz: 180 } })
  })
})
