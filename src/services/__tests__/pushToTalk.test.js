import { beforeEach, describe, expect, it, vi } from 'vitest'

const { captureMock, recognizeMock } = vi.hoisted(() => ({
  captureMock: vi.fn(),
  recognizeMock: vi.fn(),
}))

vi.mock('../voiceCapture', () => ({ captureUtterance: captureMock }))
vi.mock('../cloudSpeech', () => ({
  canUseCloudSpeech: () => true,
  recognizeCloudSpeech: recognizeMock,
}))

import { captureAndRecognizePushToTalk } from '../pushToTalk'

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

    await expect(captureAndRecognizePushToTalk({ workerUrl: 'https://chat.example.com' })).resolves.toEqual({
      text: '我回来啦',
      emotion: 'happy',
      acoustics: { pitchHz: 188, pitchRangeSemitones: 7.4 },
      engine: 'sensevoice+opensmile',
    })
    expect(captureMock).toHaveBeenCalledWith(expect.objectContaining({ manualStop: true }))
    expect(recognizeMock).toHaveBeenCalledWith(samples, expect.objectContaining({ workerUrl: 'https://chat.example.com' }))
  })
})
