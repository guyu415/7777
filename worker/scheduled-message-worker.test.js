import { describe, expect, it } from 'vitest'
import { handleSpeechTranscription, isFixedVpsSession, ordinaryProactiveEnabled } from './scheduled-message-worker.js'

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

  it('protects Workers AI usage with the existing user secret', async () => {
    const response = await handleSpeechTranscription(requestWith('wrong'), {
      USER_PASSWORD: 'right', CHAT_KV: { get: async () => null }, AI: { run() {} },
    })
    expect(response.status).toBe(401)
  })

  it('passes bounded WAV bytes to Whisper Large V3 Turbo', async () => {
    const calls = []
    const response = await handleSpeechTranscription(requestWith('right'), {
      USER_PASSWORD: 'right',
      AI: { run: async (...args) => { calls.push(args); return { text: '你好，世界。' } } },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: '你好，世界。' })
    expect(calls[0][0]).toBe('@cf/openai/whisper-large-v3-turbo')
    expect(calls[0][1].audio).toHaveLength(wav.length)
    expect(calls[0][1].language).toBe('zh')
  })

  it('accepts an existing synced user when the scheduled-user secret differs', async () => {
    const response = await handleSpeechTranscription(requestWith('phone-login'), {
      USER_PASSWORD: 'scheduled-user',
      CHAT_KV: { get: async (key) => key === 'user:phone-login:settings' ? '{}' : null },
      AI: { run: async () => ({ text: '可以了' }) },
    })
    expect(response.status).toBe(200)
  })
})
