const TARGET_SAMPLE_RATE = 16000
const PRE_ROLL_MS = 320
const END_SILENCE_MS = 720
const KEEP_TRAILING_MS = 180
const MIN_SPEECH_MS = 180
const MAX_UTTERANCE_MS = 30000

export function rootMeanSquare(samples) {
  if (!samples?.length) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

export function downsampleAudio(samples, sourceRate, targetRate = TARGET_SAMPLE_RATE) {
  if (!samples?.length || sourceRate === targetRate) return new Float32Array(samples || [])
  const ratio = sourceRate / targetRate
  const length = Math.max(1, Math.round(samples.length / ratio))
  const output = new Float32Array(length)
  let sourceOffset = 0
  for (let i = 0; i < length; i += 1) {
    const nextOffset = Math.min(samples.length, Math.round((i + 1) * ratio))
    let sum = 0
    let count = 0
    while (sourceOffset < nextOffset) {
      sum += samples[sourceOffset]
      sourceOffset += 1
      count += 1
    }
    output[i] = count ? sum / count : 0
  }
  return output
}

export function mergeAudioChunks(chunks, trimEndSamples = 0) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const kept = Math.max(0, total - trimEndSamples)
  const output = new Float32Array(kept)
  let offset = 0
  for (const chunk of chunks) {
    if (offset >= kept) break
    const count = Math.min(chunk.length, kept - offset)
    output.set(chunk.subarray(0, count), offset)
    offset += count
  }
  return output
}

export function encodePcmWav(samples, sampleRate = TARGET_SAMPLE_RATE) {
  const pcmBytes = samples.length * 2
  const buffer = new ArrayBuffer(44 + pcmBytes)
  const view = new DataView(buffer)
  const writeAscii = (offset, value) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }
  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, 'data')
  view.setUint32(40, pcmBytes, true)
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

function abortError() {
  try { return new DOMException('Aborted', 'AbortError') } catch { return Object.assign(new Error('Aborted'), { name: 'AbortError' }) }
}

/**
 * Capture one utterance locally. A lightweight adaptive energy gate keeps a
 * short pre-roll and ends the sentence after ~720 ms of silence. SenseVoice
 * performs the actual recognition; this gate only chooses the audio boundary.
 */
export async function captureUtterance({ signal, stopSignal, manualStop = false, onSpeechStart, onLevel } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器不支持本地麦克风采集')
  if (signal?.aborted) throw abortError()

  const media = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  })
  let ctx
  let source
  let processor
  let silentGain
  try {
    const AudioContextAPI = window.AudioContext || window.webkitAudioContext
    if (!AudioContextAPI) throw new Error('浏览器不支持 Web Audio')
    ctx = new AudioContextAPI({ sampleRate: TARGET_SAMPLE_RATE })
    if (ctx.state !== 'running') await ctx.resume()
    source = ctx.createMediaStreamSource(media)
    processor = ctx.createScriptProcessor(2048, 1, 1)
    silentGain = ctx.createGain()
    silentGain.gain.value = 0
  } catch (error) {
    for (const track of media.getTracks()) track.stop()
    if (ctx) await ctx.close().catch(() => {})
    throw error
  }

  return await new Promise((resolve, reject) => {
    const chunks = []
    const preRoll = []
    let preRollSamples = 0
    let speechSamples = 0
    let silenceSamples = 0
    let noiseFloor = 0.006
    let voicedFrames = 0
    let heardSpeech = false
    let settled = false

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      stopSignal?.removeEventListener('abort', onStop)
      processor.onaudioprocess = null
      try { source.disconnect() } catch {}
      try { processor.disconnect() } catch {}
      try { silentGain.disconnect() } catch {}
      for (const track of media.getTracks()) track.stop()
      ctx.close().catch(() => {})
    }
    const finish = () => {
      if (settled) return
      settled = true
      cleanup()
      if (!heardSpeech || speechSamples < TARGET_SAMPLE_RATE * MIN_SPEECH_MS / 1000) {
        resolve(new Float32Array())
        return
      }
      const trim = Math.max(0, silenceSamples - TARGET_SAMPLE_RATE * KEEP_TRAILING_MS / 1000)
      resolve(mergeAudioChunks(chunks, Math.floor(trim)))
    }
    const fail = (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => fail(abortError())
    // Push-to-talk uses a separate stop signal: releasing the button finishes
    // and keeps the captured samples, while a real abort still discards them.
    const onStop = () => finish()
    signal?.addEventListener('abort', onAbort, { once: true })
    stopSignal?.addEventListener('abort', onStop, { once: true })
    if (stopSignal?.aborted) queueMicrotask(onStop)

    processor.onaudioprocess = (event) => {
      const raw = event.inputBuffer.getChannelData(0)
      const samples = downsampleAudio(raw, ctx.sampleRate)
      const rms = rootMeanSquare(samples)
      onLevel?.(Math.min(1, rms * 12))
      const threshold = Math.max(0.012, noiseFloor * 2.7)
      const voiced = rms >= threshold

      if (!heardSpeech) {
        if (!voiced) noiseFloor = noiseFloor * 0.96 + rms * 0.04
        voicedFrames = voiced ? voicedFrames + 1 : 0
        preRoll.push(samples)
        preRollSamples += samples.length
        const maxPreRoll = TARGET_SAMPLE_RATE * PRE_ROLL_MS / 1000
        while (preRollSamples > maxPreRoll && preRoll.length > 1) preRollSamples -= preRoll.shift().length
        if (voicedFrames >= 2) {
          heardSpeech = true
          chunks.push(...preRoll)
          speechSamples += preRollSamples
          preRoll.length = 0
          onSpeechStart?.()
        }
        return
      }

      chunks.push(samples)
      speechSamples += samples.length
      silenceSamples = voiced ? 0 : silenceSamples + samples.length
      if ((!manualStop && silenceSamples >= TARGET_SAMPLE_RATE * END_SILENCE_MS / 1000)
        || speechSamples >= TARGET_SAMPLE_RATE * MAX_UTTERANCE_MS / 1000) finish()
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(ctx.destination)
  })
}

export const voiceCaptureConfig = {
  sampleRate: TARGET_SAMPLE_RATE,
  endSilenceMs: END_SILENCE_MS,
}
