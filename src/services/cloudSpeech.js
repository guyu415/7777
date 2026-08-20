import { encodePcmWav } from './voiceCapture'

export function canUseCloudSpeech(workerUrl) {
  return !!workerUrl && !!localStorage.getItem('auth.password') && !!navigator.mediaDevices?.getUserMedia
}

export async function recognizeCloudSpeech(samples, { workerUrl, signal } = {}) {
  const base = String(workerUrl || '').replace(/\/$/, '')
  const password = localStorage.getItem('auth.password') || ''
  if (!base || !password) throw new Error('Cloudflare STT 尚未配置')
  const form = new FormData()
  form.append('password', password)
  form.append('audio', encodePcmWav(samples), 'speech.wav')
  const response = await fetch(`${base}/stt`, {
    method: 'POST',
    body: form,
    signal,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `Cloudflare STT 请求失败 (${response.status})`)
  return { text: String(payload.text || '').trim() }
}
