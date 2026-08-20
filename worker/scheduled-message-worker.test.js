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

  it('protects Workers AI usage with the existing user secret', async () => {
    const request = new Request('https://chat.xiaoman.xyz/stt', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Eunoia-Password': 'wrong' }, body: wav,
    })
    const response = await handleSpeechTranscription(request, { USER_PASSWORD: 'right', AI: { run() {} } })
    expect(response.status).toBe(401)
  })

  it('passes bounded WAV bytes to Whisper Large V3 Turbo', async () => {
    const calls = []
    const request = new Request('https://chat.xiaoman.xyz/stt', {
      method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Eunoia-Password': 'right' }, body: wav,
    })
    const response = await handleSpeechTranscription(request, {
      USER_PASSWORD: 'right',
      AI: { run: async (...args) => { calls.push(args); return { text: '你好，世界。' } } },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ text: '你好，世界。' })
    expect(calls[0][0]).toBe('@cf/openai/whisper-large-v3-turbo')
    expect(calls[0][1].audio).toHaveLength(wav.length)
    expect(calls[0][1].language).toBe('zh')
  })
})
