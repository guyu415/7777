import { describe, expect, it } from 'vitest'
import { downsampleAudio, encodePcmWav, mergeAudioChunks, rootMeanSquare } from '../voiceCapture'
import { formatVoiceAcoustics, isIOSUserAgent, normalizeVoiceAcoustics, normalizeVoiceEmotion, voiceEmotionContext } from '../localSenseVoice'

describe('local voice helpers', () => {
  it('downsamples microphone audio without changing its duration', () => {
    const source = new Float32Array(48000).fill(0.25)
    const output = downsampleAudio(source, 48000, 16000)
    expect(output).toHaveLength(16000)
    expect(output[500]).toBeCloseTo(0.25)
  })

  it('merges chunks and removes only the requested trailing samples', () => {
    const output = mergeAudioChunks([new Float32Array([1, 2]), new Float32Array([3, 4])], 1)
    expect([...output]).toEqual([1, 2, 3])
  })

  it('computes a stable RMS level', () => {
    expect(rootMeanSquare(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1)
    expect(rootMeanSquare(new Float32Array(10))).toBe(0)
  })

  it('encodes mono 16 kHz PCM as a valid WAV payload', async () => {
    const wav = encodePcmWav(new Float32Array([0, 1, -1]))
    const view = new DataView(await wav.arrayBuffer())
    expect(wav.type).toBe('audio/wav')
    expect(String.fromCharCode(...new Uint8Array(view.buffer, 0, 4))).toBe('RIFF')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(46, true)).toBe(32767)
    expect(view.getInt16(48, true)).toBe(-32768)
  })

  it('normalizes SenseVoice tags and keeps uncertainty in the AI hint', () => {
    expect(normalizeVoiceEmotion('<|SAD|>')).toBe('sad')
    expect(normalizeVoiceEmotion('<|NEUTRAL|>')).toBe('neutral')
    expect(voiceEmotionContext('sad')).toContain('emotion~难过')
    expect(voiceEmotionContext('neutral')).toBe('')
    expect(voiceEmotionContext('contextual')).toBe('')
  })

  it('keeps objective openSMILE measurements bounded and compact', () => {
    expect(normalizeVoiceAcoustics({ pitchHz: 129, pitchRangeSemitones: 3.9, hnrDb: 5.2, extra: 99 })).toEqual({
      pitchHz: 129, pitchRangeSemitones: 3.9, hnrDb: 5.2,
    })
    expect(normalizeVoiceAcoustics({ pitchHz: 9999 })).toBeNull()
    expect(formatVoiceAcoustics({ pitchHz: 129, pitchRangeSemitones: 3.9, hnrDb: 5.2 }))
      .toBe('音高 129Hz · 起伏 3.9 半音 · 谐噪比 5.2dB')
    expect(voiceEmotionContext('neutral', { pitchHz: 129 })).toContain('f0=129Hz')
  })

  it('recognizes iPhone and iPad user agents for the memory safety fallback', () => {
    expect(isIOSUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X)')).toBe(true)
    expect(isIOSUserAgent('Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X)')).toBe(true)
    expect(isIOSUserAgent('Mozilla/5.0 (Linux; Android 15)')).toBe(false)
  })
})
