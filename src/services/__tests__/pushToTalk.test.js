import { beforeEach, describe, expect, it, vi } from 'vitest'

const { captureMock, recognizeMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  recognizeMock: vi.fn(),
}))

vi.mock('../voiceCapture', () => ({
  captureUtterance: captureMock,
  encodePcmWav: () => new Blob(['wav'], { type: 'audio/wav' }),
  voiceCaptureConfig: { sampleRate: 16000, maxUtteranceMs: 120000 },
}))
vi.mock('../cloudSpeech', () => ({
  canUseCloudSpeech: () => true,
  recognizeCloudSpeech: recognizeMock,
}))

import { captureAndRecognizePushToTalk, shouldCancelVoiceGesture } from '../pushToTalk'
import { voiceCaptureConfig } from '../voiceCapture'

describe('paw push-to-talk', () => {
  beforeEach(() => {
    captureMock.mockReset()
    recognizeMock.mockReset()
  })

  it('does nothing until explicitly invoked, then preserves acoustic features', async () => {
    expect(captureMock).not.toHaveBeenCalled()
    expect(recognizeMock).not.toHaveBeenCalled()

    const samples = new Float32Array([0.1, 0.2])
    captureMock.mockResolvedValue(samples)
    recognizeMock.mockResolvedValue({
      text: '我回来啦',
      emotion: 'happy',
      acoustics: { pitchHz: 188, pitchRangeSemitones: 7.4, extra: 999 },
      engine: 'sensevoice+opensmile',
    })

    const onRecordingEnd = vi.fn()
    await expect(captureAndRecognizePushToTalk({ workerUrl: 'https://chat.example.com', onRecordingEnd })).resolves.toEqual({
      text: '我回来啦',
      emotion: 'happy',
      acoustics: { pitchHz: 188, pitchRangeSemitones: 7.4 },
      engine: 'sensevoice+opensmile',
      audioBlob: expect.any(Blob),
      duration: 1,
    })
    expect(captureMock).toHaveBeenCalledWith(expect.objectContaining({ manualStop: true }))
    expect(recognizeMock).toHaveBeenCalledWith(samples, expect.objectContaining({ workerUrl: 'https://chat.example.com' }))
    expect(onRecordingEnd).toHaveBeenCalledOnce()
  })

  it('supports two-minute recordings and arms cancellation only after an upward slide', () => {
    expect(voiceCaptureConfig.maxUtteranceMs).toBe(120_000)
    expect(shouldCancelVoiceGesture(700, 650)).toBe(false)
    expect(shouldCancelVoiceGesture(700, 636)).toBe(true)
    expect(shouldCancelVoiceGesture(700, 760)).toBe(false)
  })
})
