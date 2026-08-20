const MODEL_REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
const MODEL_BASES = [
  `https://hf-mirror.com/${MODEL_REPO}/resolve/main`,
  `https://huggingface.co/${MODEL_REPO}/resolve/main`,
]

let sherpaModulePromise = null
let initializePromise = null
let releasePromise = null
let initialized = false

export function isIOSUserAgent(userAgent = '') {
  return /iPad|iPhone|iPod/.test(userAgent)
}

export function localSenseVoiceUnavailableReason() {
  if (typeof window === 'undefined') return 'unsupported'
  if (!window.WebAssembly || !navigator.mediaDevices?.getUserMedia) return 'unsupported'
  // The combined runtime allocates a large WASM heap. iOS WebKit killed the
  // installed PWA during real-device initialization, so keep it on the
  // optimized system-STT path instead of retrying the same crash on launch.
  if (isIOSUserAgent(navigator.userAgent)) return 'ios-memory'
  if (navigator.deviceMemory && navigator.deviceMemory < 4) return 'low-memory'
  return ''
}

export function canUseLocalSenseVoice() {
  return !localSenseVoiceUnavailableReason()
}

async function loadSherpa(onProgress) {
  if (!sherpaModulePromise) {
    sherpaModulePromise = import('./sherpaWebAdapter').then(async (mod) => {
      // Keep SenseVoice on the main WASM instance. The wrapper's worker
      // convenience API currently returns text only and drops the model's
      // emotion/event fields that this feature specifically needs.
      mod.configureSherpaOnnx({
        useWorker: false,
        // Pin this explicitly: the package's ESM build cannot reliably read
        // its own package.json version in every browser bundler.
        wasmBasePath: 'https://cdn.jsdelivr.net/npm/@siteed/sherpa-onnx.rn@1.3.1/wasm/',
      })
      const ok = await mod.loadWasmModule({
        debug: false,
        onProgress: (event) => onProgress?.({ phase: event.phase || 'runtime', loaded: event.loaded || 0, total: event.total || 0 }),
      })
      if (!ok) throw new Error('本地语音引擎加载失败')
      return mod
    }).catch((error) => {
      sherpaModulePromise = null
      throw error
    })
  }
  return sherpaModulePromise
}

export async function initializeLocalSenseVoice(onProgress) {
  if (releasePromise) await releasePromise
  if (initialized) return true
  if (!canUseLocalSenseVoice()) return false
  if (!initializePromise) {
    initializePromise = (async () => {
      const mod = await loadSherpa(onProgress)
      let lastError
      for (const modelBaseUrl of MODEL_BASES) {
        try {
          const result = await mod.ASR.initialize({
            modelDir: '/eunoia/sensevoice',
            modelType: 'sense_voice',
            streaming: false,
            modelBaseUrl,
            modelFiles: { model: 'model.int8.onnx', tokens: 'tokens.txt' },
            language: 'zh',
            useItn: true,
            debug: false,
            onProgress: (event) => onProgress?.({ phase: 'model', loaded: event.loaded || 0, total: event.total || 0 }),
          })
          if (!result?.success) throw new Error(result?.error || 'SenseVoice 初始化失败')
          initialized = true
          return true
        } catch (error) {
          lastError = error
          try { await mod.ASR.release() } catch {}
        }
      }
      throw lastError || new Error('SenseVoice 模型下载失败')
    })().finally(() => {
      if (!initialized) initializePromise = null
    })
  }
  return initializePromise
}

export async function recognizeLocalSpeech(samples) {
  if (!initialized) throw new Error('SenseVoice 尚未就绪')
  const mod = await loadSherpa()
  // AsrService's public convenience result intentionally narrows the native
  // SenseVoice JSON to {text}. The pinned web wrapper keeps the underlying
  // OfflineRecognizer on its API object, whose authoritative result also
  // includes emotion/event. Use that result without retaining the stream.
  const recognizer = mod.ASR?.api?.asrOfflineRecognizer
  if (!recognizer) throw new Error('SenseVoice 识别器不可用')
  const stream = recognizer.createStream()
  let result
  try {
    stream.acceptWaveform(16000, samples)
    recognizer.decode(stream)
    result = recognizer.getResult(stream)
  } finally {
    stream.free()
  }
  return {
    text: String(result?.text || '').trim(),
    emotion: normalizeVoiceEmotion(result?.emotion),
    event: String(result?.event || '').trim(),
  }
}

export async function releaseLocalSenseVoice() {
  // Do not race a model download/initialization. If the call ends during the
  // first load, keep the completed model warm for the next call; a page close
  // still releases the WASM heap. Once ready, normal hang-up frees it.
  if (!initialized) return
  initialized = false
  initializePromise = null
  releasePromise = (async () => {
    try {
      const mod = await sherpaModulePromise
      await mod?.ASR?.release()
    } catch {}
  })().finally(() => { releasePromise = null })
  await releasePromise
}

export function normalizeVoiceEmotion(value) {
  const raw = String(value || '').replace(/[<|>_\s-]/g, '').toLowerCase()
  if (!raw || raw.includes('unk')) return 'unknown'
  if (raw.includes('happy') || raw.includes('joy')) return 'happy'
  if (raw.includes('sad')) return 'sad'
  if (raw.includes('angry') || raw.includes('anger')) return 'angry'
  if (raw.includes('fear')) return 'fearful'
  if (raw.includes('surprise')) return 'surprised'
  if (raw.includes('disgust')) return 'disgusted'
  if (raw.includes('neutral')) return 'neutral'
  return 'unknown'
}

export const VOICE_EMOTION_LABELS = {
  happy: '开心',
  sad: '难过',
  angry: '生气',
  fearful: '紧张',
  surprised: '惊讶',
  disgusted: '反感',
  neutral: '平静',
  unknown: '未判断',
}

const ACOUSTIC_BOUNDS = {
  pitchHz: [50, 900], pitchRangeSemitones: [0, 36], loudnessDb: [-100, 20],
  rhythmPeaksPerSecond: [0, 20], hnrDb: [-30, 60], jitterPercent: [0, 20], shimmerDb: [0, 10],
}

export function normalizeVoiceAcoustics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const result = {}
  for (const [key, [min, max]] of Object.entries(ACOUSTIC_BOUNDS)) {
    const number = Number(value[key])
    if (Number.isFinite(number) && number >= min && number <= max) result[key] = number
  }
  return Object.keys(result).length ? result : null
}

export function formatVoiceAcoustics(value) {
  const acoustics = normalizeVoiceAcoustics(value)
  if (!acoustics) return ''
  return [
    acoustics.pitchHz !== undefined ? `音高 ${acoustics.pitchHz}Hz` : '',
    acoustics.pitchRangeSemitones !== undefined ? `起伏 ${acoustics.pitchRangeSemitones} 半音` : '',
    acoustics.loudnessDb !== undefined ? `相对响度 ${acoustics.loudnessDb}dB` : '',
    acoustics.rhythmPeaksPerSecond !== undefined ? `节奏 ${acoustics.rhythmPeaksPerSecond}/秒` : '',
    acoustics.hnrDb !== undefined ? `谐噪比 ${acoustics.hnrDb}dB` : '',
    acoustics.jitterPercent !== undefined ? `音高微抖 ${acoustics.jitterPercent}%` : '',
    acoustics.shimmerDb !== undefined ? `响度微抖 ${acoustics.shimmerDb}dB` : '',
  ].filter(Boolean).join(' · ')
}

export function voiceEmotionContext(emotion, acousticsValue) {
  const label = VOICE_EMOTION_LABELS[emotion]
  const acoustics = normalizeVoiceAcoustics(acousticsValue)
  const fields = [
    label && emotion !== 'neutral' && emotion !== 'unknown' ? `emotion~${label}` : '',
    acoustics?.pitchHz !== undefined ? `f0=${acoustics.pitchHz}Hz` : '',
    acoustics?.pitchRangeSemitones !== undefined ? `range=${acoustics.pitchRangeSemitones}st` : '',
    acoustics?.loudnessDb !== undefined ? `level=${acoustics.loudnessDb}dB` : '',
    acoustics?.rhythmPeaksPerSecond !== undefined ? `rhythm=${acoustics.rhythmPeaksPerSecond}/s` : '',
    acoustics?.hnrDb !== undefined ? `HNR=${acoustics.hnrDb}dB` : '',
    acoustics?.jitterPercent !== undefined ? `jitter=${acoustics.jitterPercent}%` : '',
    acoustics?.shimmerDb !== undefined ? `shimmer=${acoustics.shimmerDb}dB` : '',
  ].filter(Boolean)
  return fields.length ? `[voice acoustics; ${fields.join('; ')}; objective cues, not certain feelings]` : ''
}
