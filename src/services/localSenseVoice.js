const MODEL_REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
const MODEL_BASES = [
  `https://hf-mirror.com/${MODEL_REPO}/resolve/main`,
  `https://huggingface.co/${MODEL_REPO}/resolve/main`,
]

let sherpaModulePromise = null
let initializePromise = null
let releasePromise = null
let initialized = false

export function canUseLocalSenseVoice() {
  if (typeof window === 'undefined') return false
  if (!window.WebAssembly || !navigator.mediaDevices?.getUserMedia) return false
  // The combined runtime starts with a large WASM heap. Keep the explicit
  // low-memory signal as a guard, but do not blanket-block iOS: Safari does
  // not expose deviceMemory, and recent iPhones can run the INT8 model. If a
  // particular device cannot allocate it, initialization fails softly and
  // the call hook returns to the improved browser-STT path.
  if (navigator.deviceMemory && navigator.deviceMemory < 4) return false
  return true
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

export function voiceEmotionContext(emotion) {
  const label = VOICE_EMOTION_LABELS[emotion]
  if (!label || emotion === 'neutral' || emotion === 'unknown') return ''
  return `本轮来自语音输入；声音模型给出的粗略语气标签是“${label}”。这只是可能出错的声音线索，请结合原话和上下文自然理解，不要机械复述标签，也不要声称确定知道用户内心。`
}
