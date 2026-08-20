import { encodePcmWav } from './voiceCapture'

const REQUEST_TIMEOUT_MS = 20_000
const NETWORK_RETRY_DELAY_MS = 300

export function canUseCloudSpeech(workerUrl) {
  return !!workerUrl && !!localStorage.getItem('auth.password') && !!navigator.mediaDevices?.getUserMedia
}

function waitForRetry(signal) {
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    const timer = setTimeout(finish, NETWORK_RETRY_DELAY_MS)
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' }))
    }
    if (!signal) return
    if (signal.aborted) return onAbort()
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

async function postAudio(url, password, wav, signal) {
  const controller = new AbortController()
  const forwardAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', forwardAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const form = new FormData()
    form.append('password', password)
    form.append('audio', wav, 'speech.wav')
    return await fetch(url, { method: 'POST', body: form, signal: controller.signal })
  } catch (error) {
    if (signal?.aborted) throw signal.reason || Object.assign(new Error('Aborted'), { name: 'AbortError' })
    if (controller.signal.aborted) throw new Error('请求超时')
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', forwardAbort)
  }
}

export async function recognizeCloudSpeech(samples, { workerUrl, signal } = {}) {
  const base = String(workerUrl || '').replace(/\/$/, '')
  const password = localStorage.getItem('auth.password') || ''
  if (!base || !password) throw new Error('Cloudflare STT 尚未配置')
  const wav = encodePcmWav(samples)
  let lastError
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await postAudio(`${base}/stt`, password, wav, signal)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const error = new Error(payload.error || `Cloudflare STT 请求失败 (${response.status})`)
        error.retryable = response.status >= 500
        // A generated Cloudflare 5xx can be a transient edge/AI failure. Retry
        // the same audio once, just like a Safari "Load failed" network error.
        if (response.status >= 500 && attempt === 0) {
          lastError = error
          await waitForRetry(signal)
          continue
        }
        throw error
      }
      return { text: String(payload.text || '').trim() }
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) throw error
      if (error?.retryable === false) throw error
      lastError = error
      if (attempt === 0) {
        await waitForRetry(signal)
        continue
      }
    }
  }
  throw new Error(`网络连接失败（${lastError?.message || 'Load failed'}）`)
}
