import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeAudioBase64, handleNeteaseControlApi, handleSpeechTranscription, isFixedVpsSession, ordinaryProactiveEnabled } from './scheduled-message-worker.js'

describe('ordinary proactive target separation', () => {
  it('treats both CC and Codex fixed runtimes as non-API targets', () => {
    expect(isFixedVpsSession({ providerName: 'claude-code-vps' })).toBe(true)
    expect(isFixedVpsSession({ providerName: 'codex-vps' })).toBe(true)
    expect(isFixedVpsSession({ providerName: 'anthropic' })).toBe(false)
    expect(isFixedVpsSession({ providerName: '' })).toBe(false)
  })

  it('keeps old behaviour for settings written before the global switch', () => {
    expect(ordinaryProactiveEnabled({})).toBe(true)
    expect(ordinaryProactiveEnabled({ apiProactiveEnabled: true })).toBe(true)
    expect(ordinaryProactiveEnabled({ apiProactiveEnabled: false })).toBe(false)
  })
})

describe('Cloudflare speech transcription', () => {
  const wav = new Uint8Array(64).fill(1)
  const requestWith = (password) => {
    const form = new FormData()
    form.append('password', password)
    form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'speech.wav')
    return new Request('https://chat.xiaoman.xyz/stt', { method: 'POST', body: form })
  }

  afterEach(() => vi.restoreAllMocks())

  it('protects Workers AI usage with the existing user secret', async () => {
    const response = await handleSpeechTranscription(requestWith('wrong'), {
      USER_PASSWORD: 'right', CHAT_KV: { get: async () => null }, AI: { run() {} },
    })
    expect(response.status).toBe(401)
  })

  it('passes bounded WAV bytes as the current Whisper base64 schema', async () => {
    const calls = []
    const response = await handleSpeechTranscription(requestWith('right'), {
      USER_PASSWORD: 'right',
      AI: { run: async (...args) => { calls.push(args); return { text: '你好，世界。' } } },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      text: '你好，世界。', emotion: 'unknown', event: '', language: 'zh', acoustics: null, engine: 'whisper',
    })
    expect(calls[0][0]).toBe('@cf/openai/whisper-large-v3-turbo')
    expect(typeof calls[0][1].audio).toBe('string')
    expect(Uint8Array.from(atob(calls[0][1].audio), char => char.charCodeAt(0))).toEqual(wav)
    expect(calls[0][1].language).toBe('zh')
  })

  it('base64-encodes audio larger than the JavaScript spread limit', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => index % 251)
    const encoded = encodeAudioBase64(bytes)
    const decoded = Uint8Array.from(atob(encoded), char => char.charCodeAt(0))
    expect(decoded).toEqual(bytes)
  })

  it('accepts an existing synced user when the scheduled-user secret differs', async () => {
    const response = await handleSpeechTranscription(requestWith('phone-login'), {
      USER_PASSWORD: 'scheduled-user',
      CHAT_KV: { get: async (key) => key === 'user:phone-login:settings' ? '{}' : null },
      AI: { run: async () => ({ text: '可以了' }) },
    })
    expect(response.status).toBe(200)
  })

  it('prefers VPS SenseVoice and preserves openSMILE acoustic measurements', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      text: '我真的生气了', emotion: 'angry', event: 'SPEECH', language: 'zh', engine: 'sensevoice+opensmile',
      acoustics: { pitchHz: 180, pitchRangeSemitones: 8.2, hnrDb: 12.4 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const aiRun = vi.fn()
    const response = await handleSpeechTranscription(requestWith('right'), {
      USER_PASSWORD: 'right', VPS_SERVICE_KEY: 'service-key',
      SENSEVOICE_URL: 'https://companion.example/stt/sensevoice', AI: { run: aiRun },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      text: '我真的生气了', emotion: 'angry', engine: 'sensevoice+opensmile', acoustics: { pitchHz: 180 },
    })
    expect(upstream).toHaveBeenCalledWith('https://companion.example/stt/sensevoice', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'X-VPS-Key': 'service-key' }),
    }))
    expect(aiRun).not.toHaveBeenCalled()
  })

  it('falls back to Whisper without inventing an emotion when VPS is down', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('VPS unavailable'))
    const response = await handleSpeechTranscription(requestWith('right'), {
      USER_PASSWORD: 'right', VPS_SERVICE_KEY: 'service-key',
      AI: { run: async () => ({ text: '只有转写' }) },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ text: '只有转写', emotion: 'unknown', engine: 'whisper' })
  })
})

describe('NetEase phone control catalog search', () => {
  afterEach(() => vi.restoreAllMocks())

  it('returns song ids for app handoff without requesting an audio URL', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      result: { songs: [
        { id: 1, name: '测试歌曲 (翻唱版)', artists: [{ name: '其他人' }], album: { name: '翻唱专辑' }, duration: 230000 },
        { id: 1855080368, name: '测试歌曲', artists: [{ name: '测试歌手' }], album: { name: '测试专辑' }, duration: 240000 },
      ] },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })).mockResolvedValueOnce(new Response(JSON.stringify({
      songs: [{ id: 1855080368, album: { picUrl: 'https://img.example/cover.jpg' } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const request = new Request('https://chat.xiaoman.xyz/netease/search?keywords=test&title=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%9B%B2&artist=%E6%B5%8B%E8%AF%95%E6%AD%8C%E6%89%8B&limit=5', {
      headers: { Referer: 'https://chat.xiaoman.xyz/' },
    })
    const response = await handleNeteaseControlApi(request, {})
    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.ok).toBe(true)
    expect(payload.songs[0]).toMatchObject({ id: 1855080368, name: '测试歌曲', artists: '测试歌手', cover: 'https://img.example/cover.jpg' })
    expect(upstream).toHaveBeenCalledTimes(2)
    expect(upstream.mock.calls[0][0]).toBe('https://music.163.com/api/search/get')
  })

  it('returns LRC text without ever requesting media bytes', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      lrc: { lyric: '[00:01.00]第一句' }, tlyric: { lyric: '[00:01.00]First line' },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const response = await handleNeteaseControlApi(new Request('https://chat.xiaoman.xyz/netease/lyric?id=186016', {
      headers: { Referer: 'https://chat.xiaoman.xyz/' },
    }), {})
    expect(await response.json()).toMatchObject({ ok: true, lrc: '[00:01.00]第一句', tlyric: '[00:01.00]First line' })
    expect(upstream.mock.calls[0][0]).toContain('/api/song/lyric?id=186016')
  })

  it('forwards calibrated playback context through the signed VPS bridge', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: true, estimated: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    const response = await handleNeteaseControlApi(new Request('https://chat.xiaoman.xyz/netease/playback', {
      method: 'POST', headers: { Referer: 'https://chat.xiaoman.xyz/', 'Content-Type': 'application/json' },
      body: JSON.stringify({ songId: '186016', name: '晴天', artists: '周杰伦', positionMs: 5000 }),
    }), { VPS_SERVICE_KEY: 'secret' })
    expect(response.status).toBe(200)
    expect(upstream).toHaveBeenCalledWith('https://companion.xiaoman.xyz/netease/playback', expect.objectContaining({
      method: 'POST', headers: expect.objectContaining({ 'X-VPS-Key': 'secret' }),
    }))
  })
})
