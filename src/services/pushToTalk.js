import { captureUtterance, encodePcmWav, voiceCaptureConfig } from './voiceCapture'
import { canUseCloudSpeech, recognizeCloudSpeech } from './cloudSpeech'
import { normalizeVoiceAcoustics, normalizeVoiceEmotion } from './localSenseVoice'

/**
 * Record exactly while the paw is held, then run the same Cloudflare
 * SenseVoice + OpenSMILE endpoint used by voice calls on iOS. Nothing is
 * loaded or requested before an actual long press.
 */
export async function captureAndRecognizePushToTalk({ workerUrl, signal, stopSignal, onSpeechStart, onLevel } = {}) {
  if (!canUseCloudSpeech(workerUrl)) throw new Error('语音识别尚未配置')
  const samples = await captureUtterance({
    signal,
    stopSignal,
    manualStop: true,
    onSpeechStart,
    onLevel,
  })
  if (!samples.length) return { text: '', emotion: undefined, acoustics: null, engine: 'cloud', audioBlob: null, duration: 0 }

  const result = await recognizeCloudSpeech(samples, { workerUrl, signal })
  const emotion = normalizeVoiceEmotion(result.emotion)
  return {
    text: String(result.text || '').trim(),
    emotion: emotion === 'unknown' ? undefined : emotion,
    acoustics: normalizeVoiceAcoustics(result.acoustics),
    engine: result.engine || 'cloud',
    audioBlob: encodePcmWav(samples, voiceCaptureConfig.sampleRate),
    duration: Math.max(1, Math.ceil(samples.length / voiceCaptureConfig.sampleRate)),
  }
}
