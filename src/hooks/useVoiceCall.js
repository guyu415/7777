import { useState, useRef, useCallback } from 'react'
import { useStore, saveMessage } from '../store'
import { streamChat } from '../services/claude'
import { streamChatViaCompanion, streamChatViaCodex } from '../services/companion'
import { fetchTTSAudio } from '../services/tts'
import { saveSessionMsgs } from '../services/sync'
import { captureUtterance } from '../services/voiceCapture'
import { canUseCloudSpeech, recognizeCloudSpeech } from '../services/cloudSpeech'
import {
  canUseLocalSenseVoice,
  localSenseVoiceUnavailableReason,
  initializeLocalSenseVoice,
  recognizeLocalSpeech,
  releaseLocalSenseVoice,
  VOICE_EMOTION_LABELS,
  voiceEmotionContext,
} from '../services/localSenseVoice'

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
export const supportsVoiceCall = !!SpeechRecognitionAPI || !!navigator.mediaDevices?.getUserMedia

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const CALL_RULES = `

【语音通话模式】现在你和主人正在语音通话，你的回复会被直接转成语音朗读出来，所以：
1. 只输出口语化的纯文本，一到三句话，简短自然，像打电话一样你一句我一句。
2. 绝对不要使用任何标记或格式：不要 [VOICE]、[AC:...]、[LETTER]、[SPLIT]、<i>动作</i>、markdown、emoji、颜文字。
3. 不要写动作描写和旁白，只说"嘴里说出来的话"。`

// 去掉一切不适合朗读的标记（兜底，即使模型没听话）
function cleanForSpeech(text) {
  return text
    .replace(/\[LETTER[\s\S]*?\[\/LETTER\]/g, '')
    .replace(/\{\{LETTER_CARD:[^}]*\}\}/g, '')
    .replace(/\[AC:[^\]]*\]/g, '')
    .replace(/\[MUSIC:[^\]]*\]/g, '')
    .replace(/\[\/?VOICE\]/g, '')
    .replace(/\[SPLIT\]/g, ' ')
    .replace(/<\/?i>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// 通话状态机：listening（听你说）→ thinking（AI 思考）→ speaking（播放语音）→ listening…
export function useVoiceCall() {
  const [status, setStatus] = useState('idle') // idle | listening | thinking | speaking | muted
  const [userCaption, setUserCaption] = useState('')
  const [aiCaption, setAiCaption] = useState('')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [muted, setMuted] = useState(false)
  const [voiceEmotion, setVoiceEmotion] = useState('')
  const [speechEngine, setSpeechEngine] = useState('browser') // browser | local | cloud
  const [modelStatus, setModelStatus] = useState('idle') // idle | loading | ready | cloud | fallback
  const [modelProgress, setModelProgress] = useState(0)
  const [modelFallbackReason, setModelFallbackReason] = useState('')

  const activeRef = useRef(false)
  const mutedRef = useRef(false)
  const statusRef = useRef('idle')
  const recRef = useRef(null)
  const captureAbortRef = useRef(null)
  const abortRef = useRef(null)
  const audioElRef = useRef(null)
  const audioCtxRef = useRef(null)
  const sourceRef = useRef(null)
  const timerRef = useRef(null)
  const cfgRef = useRef(null)
  const sessionIdRef = useRef('main')
  const visHandlerRef = useRef(null)
  const localReadyRef = useRef(false)
  const cloudReadyRef = useRef(false)

  const setSt = (s) => { statusRef.current = s; setStatus(s) }

  // 优先 WebAudio：AudioContext 在通话按钮的点击手势里已解锁，
  // 之后可以无手势自由播放（iOS 对无手势的 audio.play() 很苛刻）
  const playBlob = async (blob) => {
    const ctx = audioCtxRef.current
    if (ctx) {
      try {
        if (ctx.state !== 'running') await ctx.resume()
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer())
        await new Promise((resolve) => {
          const node = ctx.createBufferSource()
          node.buffer = buf
          node.connect(ctx.destination)
          node.onended = resolve
          sourceRef.current = node
          node.start(0)
        })
        sourceRef.current = null
        return
      } catch (e) {
        console.warn('[CALL] WebAudio 播放失败，回退 <audio>:', e.message)
      }
    }
    await new Promise((resolve) => {
      const audio = audioElRef.current
      if (!audio) return resolve()
      const url = URL.createObjectURL(blob)
      audio.muted = false
      audio.src = url
      audio.onended = () => { URL.revokeObjectURL(url); resolve() }
      audio.onerror = () => { URL.revokeObjectURL(url); resolve() }
      audio.play().catch((e) => {
        console.warn('[CALL] audio.play 被拒:', e.message)
        URL.revokeObjectURL(url)
        resolve()
      })
    })
  }

  const preloadLocalModel = () => {
    const unavailableReason = localSenseVoiceUnavailableReason()
    if (unavailableReason) {
      const cloudReady = unavailableReason === 'ios-memory' && canUseCloudSpeech(cfgRef.current?.workerUrl)
      cloudReadyRef.current = cloudReady
      setSpeechEngine(cloudReady ? 'cloud' : 'browser')
      setModelStatus(cloudReady ? 'cloud' : 'fallback')
      setModelFallbackReason(cloudReady ? '' : unavailableReason)
      return
    }
    setModelStatus('loading')
    setModelProgress(0)
    initializeLocalSenseVoice(({ loaded, total }) => {
      if (!activeRef.current) return
      if (total > 0) setModelProgress(Math.min(100, Math.round(loaded / total * 100)))
    }).then((ready) => {
      if (!activeRef.current || !ready) return
      localReadyRef.current = true
      setModelStatus('ready')
      setModelFallbackReason('')
      setModelProgress(100)
      setError('')
      // Firefox has microphone capture but no Web Speech API. Its first turn
      // waits for the local model instead of having a browser-STT fallback.
      if (!SpeechRecognitionAPI && !mutedRef.current) setTimeout(() => listenLocal(), 0)
    }).catch((e) => {
      if (!activeRef.current) return
      console.warn('[CALL] 本地 SenseVoice 加载失败，回退浏览器识别:', e.message)
      localReadyRef.current = false
      setSpeechEngine('browser')
      setModelStatus('fallback')
      setModelFallbackReason('load-error')
      setError('本地语音模型暂不可用，已切换系统识别')
      setTimeout(() => setError(''), 4000)
    })
  }

  const listenBrowser = useCallback(() => {
    if (!activeRef.current) return
    if (mutedRef.current) { setSt('muted'); return }
    if (!SpeechRecognitionAPI) {
      setError('本地模型不可用，且此浏览器不支持系统语音识别')
      return
    }
    setSpeechEngine('browser')
    setSt('listening')
    setUserCaption('')
    setVoiceEmotion('')
    let finalText = ''
    let heard = '' // finals + 当前 interim（iOS 经常不标 isFinal，必须兜底）
    let silenceTimer = null
    let maxTimer = null
    const rec = new SpeechRecognitionAPI()
    rec.lang = 'zh-CN'
    rec.interimResults = true
    rec.maxAlternatives = 3
    // iOS 的识别器不会在停顿后自动结束（安卓才会），所以用 continuous
    // 模式自己判停：有内容且 0.8s 没有新结果就主动 stop。
    // 原来的 1.4s 是通话体感卡顿的主要固定延迟。
    rec.continuous = true
    const stopRec = () => { try { rec.stop() } catch {} }
    rec.onresult = (e) => {
      let interim = ''
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          if (i >= e.resultIndex) finalText += e.results[i][0].transcript
        } else {
          interim += e.results[i][0].transcript
        }
      }
      heard = (finalText + interim).trim() || heard
      setUserCaption(heard)
      clearTimeout(silenceTimer)
      if (heard) silenceTimer = setTimeout(stopRec, 800)
    }
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // 锁屏/切后台时 iOS 会掐断麦克风并抛同样的错误——不是真的没权限，
        // 静默暂停，等 visibilitychange 恢复；只有前台时才当作权限被拒
        if (document.visibilityState === 'hidden') return
        setError('麦克风权限被拒绝，请在系统设置里允许')
        endCall()
      }
      // no-speech / aborted 等由 onend 的重听逻辑兜底
    }
    rec.onend = () => {
      clearTimeout(silenceTimer)
      clearTimeout(maxTimer)
      recRef.current = null
      if (!activeRef.current || mutedRef.current) return
      if (document.visibilityState === 'hidden') { setSt('paused'); return } // 锁屏暂停，回前台再续
      const text = (finalText.trim() || heard).trim()
      if (text) handleTurn(text, { engine: 'browser' })
      else setTimeout(() => listen(), 180) // 没听到内容，继续听
    }
    recRef.current = rec
    maxTimer = setTimeout(stopRec, 30_000) // 单句上限 30s
    try { rec.start() } catch { setTimeout(() => listen(), 350) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const listenLocal = useCallback(async () => {
    if (!activeRef.current) return
    if (mutedRef.current) { setSt('muted'); return }
    setSpeechEngine('local')
    setSt('listening')
    setUserCaption('')
    setVoiceEmotion('')
    const controller = new AbortController()
    captureAbortRef.current = controller
    try {
      const samples = await captureUtterance({
        signal: controller.signal,
        onSpeechStart: () => { if (activeRef.current) setUserCaption('正在听…') },
      })
      captureAbortRef.current = null
      if (!activeRef.current || mutedRef.current) return
      if (!samples.length) {
        setTimeout(() => listen(), 180)
        return
      }
      setSt('recognizing')
      setUserCaption('正在识别…')
      const result = await recognizeLocalSpeech(samples)
      if (!activeRef.current) return
      if (!result.text) {
        setUserCaption('')
        setTimeout(() => listen(), 180)
        return
      }
      const emotion = result.emotion || 'unknown'
      setVoiceEmotion(emotion)
      handleTurn(result.text, { engine: 'local', emotion, event: result.event })
    } catch (e) {
      captureAbortRef.current = null
      if (e.name === 'AbortError' || !activeRef.current) return
      if (e.name === 'NotAllowedError') {
        setError('麦克风权限被拒绝，请在系统设置里允许')
        endCall()
        return
      }
      console.warn('[CALL] 本地识别失败，回退浏览器识别:', e.message)
      localReadyRef.current = false
      setSpeechEngine('browser')
      setModelStatus('fallback')
      setModelFallbackReason('runtime-error')
      setError('本地识别失败，已切换系统识别')
      setTimeout(() => setError(''), 3500)
      setTimeout(() => listen(), 200)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const listenCloud = useCallback(async () => {
    if (!activeRef.current) return
    if (mutedRef.current) { setSt('muted'); return }
    setSpeechEngine('cloud')
    setModelStatus('cloud')
    setSt('listening')
    setUserCaption('')
    setVoiceEmotion('')
    const controller = new AbortController()
    captureAbortRef.current = controller
    try {
      const samples = await captureUtterance({
        signal: controller.signal,
        onSpeechStart: () => { if (activeRef.current) setUserCaption('正在听…') },
      })
      if (!activeRef.current || mutedRef.current) return
      if (!samples.length) {
        captureAbortRef.current = null
        setTimeout(() => listen(), 180)
        return
      }
      setSt('recognizing')
      setUserCaption('云端正在识别…')
      const result = await recognizeCloudSpeech(samples, {
        workerUrl: cfgRef.current?.workerUrl,
        signal: controller.signal,
      })
      captureAbortRef.current = null
      if (!activeRef.current) return
      if (!result.text) {
        setUserCaption('')
        setTimeout(() => listen(), 180)
        return
      }
      // Whisper returns text only. Do not attach a made-up emotion hint: it
      // adds tokens without providing any acoustic evidence.
      handleTurn(result.text, { engine: 'cloud' })
    } catch (e) {
      captureAbortRef.current = null
      if (e.name === 'AbortError' || !activeRef.current) return
      if (e.name === 'NotAllowedError') {
        setError('麦克风权限被拒绝，请在系统设置里允许')
        endCall()
        return
      }
      console.warn('[CALL] Cloudflare STT 失败，保持云端并恢复监听:', e.message)
      // Do not silently fall back to webkitSpeechRecognition here. In an iOS
      // home-screen app it can never deliver onresult/onend after cloud capture,
      // leaving the next turn stuck forever. The request already retries the
      // same WAV once; resume cloud listening so a transient edge failure cannot
      // permanently disable the call.
      cloudReadyRef.current = true
      setSpeechEngine('cloud')
      setModelStatus('cloud')
      setModelFallbackReason('cloud-retry')
      setError(`云端识别暂时失败：${e.message || '未知错误'}；请再说一次`)
      setTimeout(() => setError(''), 4500)
      setTimeout(() => { if (activeRef.current && !mutedRef.current) listen() }, 700)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const listen = useCallback(() => {
    if (localReadyRef.current) return listenLocal()
    if (cloudReadyRef.current) return listenCloud()
    return listenBrowser()
  }, [listenBrowser, listenCloud, listenLocal])

  const handleTurn = useCallback(async (text, voiceMeta = {}) => {
    const cfg = cfgRef.current
    const sessionId = sessionIdRef.current
    setSt('thinking')
    setUserCaption(text)
    setAiCaption('')

    const isClaudeVps = cfg.providerName === 'claude-code-vps'
    const isCodexVps = cfg.providerName === 'codex-vps'
    const isPersistentVps = isClaudeVps || isCodexVps

    // VPS runtimes own their history server-side. Persisting a second local
    // copy here was the other half of the split-brain bug: the call looked
    // like it belonged to the open chat while its model turn went elsewhere.
    if (!isPersistentVps) {
      const state = useStore.getState()
      const userMsg = { id: genId(), conversationId: sessionId, role: 'user', type: 'text', content: text, timestamp: Date.now() }
      state.addMessage(userMsg)
      try { await saveMessage(userMsg) } catch {}
    }

    // 上下文：本会话最近 24 条（含刚说的这句），首条必须是 user
    let ctx = useStore.getState().messages
      .filter(m => m.conversationId === sessionId && !m.streaming && !m.voiceLoading)
      .slice(-24)
    while (ctx.length && ctx[0].role === 'assistant') ctx = ctx.slice(1)

    // ── 流水线：AI 边生成边按句切分，句子一完成立刻送 TTS 并按序播放，
    // 后续句子在播放的同时并行合成，大幅缩短"文字→出声"的等待 ──
    const ttsOpts = { apiKey: cfg.ttsApiKey, groupId: cfg.ttsGroupId, voiceId: cfg.ttsVoiceId, model: cfg.ttsModel }
    const blobQueue = [] // 按序的 TTS Promise（已 catch，失败为 null）
    let queueClosed = false

    const pushSeg = (raw) => {
      const seg = cleanForSpeech(raw)
      if (!seg) return
      blobQueue.push(fetchTTSAudio(seg, ttsOpts).catch((e) => {
        console.warn('[CALL] TTS 失败，该句仅显示文字:', e.message)
        setError(`语音合成失败：${e.message}`)
        setTimeout(() => setError(''), 4000)
        return null
      }))
    }

    const consumer = (async () => {
      let i = 0
      let started = false
      while (activeRef.current) {
        if (i < blobQueue.length) {
          const blob = await blobQueue[i++]
          if (!activeRef.current) return
          if (blob) {
            if (!started) { started = true; setSt('speaking') }
            await playBlob(blob)
          }
        } else if (queueClosed) {
          return
        } else {
          await new Promise(r => setTimeout(r, 100))
        }
      }
    })()

    const controller = new AbortController()
    abortRef.current = controller
    let full = ''
    let segBuf = ''
    try {
      const chunkSource = isCodexVps
        ? streamChatViaCodex({ text, sessionId, prompt: cfg.systemPrompt, signal: controller.signal, voiceEmotion: voiceMeta.emotion })
        : isClaudeVps
          ? streamChatViaCompanion({ text, signal: controller.signal, voiceEmotion: voiceMeta.emotion })
          : streamChat({
              apiKey: cfg.apiKey, apiBaseUrl: cfg.baseUrl, model: cfg.model,
              systemPrompt: cfg.systemPrompt + CALL_RULES + (voiceEmotionContext(voiceMeta.emotion) ? `\n\n【本轮语音线索】${voiceEmotionContext(voiceMeta.emotion)}` : ''),
              messages: ctx,
              workerUrl: cfg.workerUrl, useWorkerProxy: cfg.useWorkerProxy,
              signal: controller.signal,
              disableThinking: true, webSearch: false, providerName: cfg.providerName,
            })
      for await (const chunk of chunkSource) {
        if (!chunk.text) continue
        full += chunk.text
        segBuf += chunk.text
        setAiCaption(cleanForSpeech(full)) // 字幕跟着生成实时更新
        // 句末标点即成句，切出去合成
        let cut
        while ((cut = segBuf.search(/[。！？!?…\n]/)) !== -1) {
          pushSeg(segBuf.slice(0, cut + 1))
          segBuf = segBuf.slice(cut + 1)
        }
      }
    } catch (e) {
      queueClosed = true
      if (!activeRef.current) return
      if (e.name !== 'AbortError') {
        setError(`AI 回复失败：${e.message}`)
        setTimeout(() => { setError(''); listen() }, 2000)
      }
      return
    }
    abortRef.current = null
    if (!activeRef.current) { queueClosed = true; return }

    const spoken = cleanForSpeech(full) || '嗯嗯，我在听～'
    if (segBuf.trim()) pushSeg(segBuf) // 结尾没有标点的残句
    if (!blobQueue.length) pushSeg(spoken) // 一句都没切出来的兜底
    queueClosed = true

    if (!isPersistentVps) {
      const aiMsg = { id: genId(), conversationId: sessionId, role: 'assistant', type: 'text', content: spoken, timestamp: Date.now() }
      useStore.getState().addMessage(aiMsg)
      try { await saveMessage(aiMsg) } catch {}
    }
    setAiCaption(spoken)
    if (!isPersistentVps) {
      useStore.getState().updateSession(sessionId, { lastMsgPreview: spoken.slice(0, 40), lastMsgTime: Date.now() })
    }

    await consumer // 等所有句子播完
    if (activeRef.current) setTimeout(() => listen(), 180)
  }, [listen])

  // audioKit：调用方在用户点击的调用栈里创建并解锁的 { el: <audio>, ctx: AudioContext }
  const startCall = useCallback(({ sessionId, audioKit, ...cfg }) => {
    if (!SpeechRecognitionAPI && !navigator.mediaDevices?.getUserMedia) { setError('此浏览器不支持语音识别，无法通话'); return false }
    const isPersistentVps = cfg.providerName === 'claude-code-vps' || cfg.providerName === 'codex-vps'
    if (!isPersistentVps && !cfg.apiKey) { setError('请先在设置中配置 API Key'); return false }
    if (!cfg.ttsApiKey || !cfg.ttsGroupId) { setError('请先在设置中配置语音（TTS）密钥'); return false }
    sessionIdRef.current = sessionId || 'main'
    cfgRef.current = cfg
    audioElRef.current = audioKit?.el || new Audio()
    audioCtxRef.current = audioKit?.ctx || null
    activeRef.current = true
    mutedRef.current = false
    setMuted(false)
    setError('')
    setSeconds(0)
    setUserCaption('')
    setAiCaption('')
    setVoiceEmotion('')
    localReadyRef.current = false
    const unavailableReason = localSenseVoiceUnavailableReason()
    const cloudReady = unavailableReason === 'ios-memory' && canUseCloudSpeech(cfg.workerUrl)
    cloudReadyRef.current = cloudReady
    setSpeechEngine(cloudReady ? 'cloud' : 'browser')
    setModelStatus(cloudReady ? 'cloud' : unavailableReason ? 'fallback' : 'loading')
    setModelFallbackReason(cloudReady ? '' : unavailableReason)
    setModelProgress(0)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    // 锁屏/切后台：iOS 会掐断麦克风，安静暂停；回到前台自动恢复聆听
    const onVis = () => {
      if (!activeRef.current) return
      if (document.visibilityState === 'hidden') {
        setSt('paused')
        try { recRef.current?.abort() } catch {}
        captureAbortRef.current?.abort()
        captureAbortRef.current = null
      } else {
        setError('')
        const c = audioCtxRef.current
        if (c && c.state !== 'running') c.resume().catch(() => {})
        if (!mutedRef.current && statusRef.current !== 'thinking' && statusRef.current !== 'speaking') {
          setTimeout(() => { if (activeRef.current) listen() }, 300)
        }
      }
    }
    visHandlerRef.current = onVis
    document.addEventListener('visibilitychange', onVis)
    preloadLocalModel()
    listen()
    return true
  }, [listen])

  const endCall = useCallback(() => {
    activeRef.current = false
    clearInterval(timerRef.current)
    if (visHandlerRef.current) {
      document.removeEventListener('visibilitychange', visHandlerRef.current)
      visHandlerRef.current = null
    }
    try { recRef.current?.abort() } catch {}
    recRef.current = null
    captureAbortRef.current?.abort()
    captureAbortRef.current = null
    abortRef.current?.abort()
    abortRef.current = null
    try { sourceRef.current?.stop() } catch {}
    sourceRef.current = null
    const audio = audioElRef.current
    if (audio) { try { audio.pause() } catch {} }
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) { try { ctx.close() } catch {} }
    localReadyRef.current = false
    cloudReadyRef.current = false
    releaseLocalSenseVoice().catch(() => {})
    setSt('idle')
    // 普通 API 会话的通话内容整体同步到云端（一次写入）。VPS 会话
    // 已由服务端持久化，重复上传本地副本会重新制造两套历史。
    const password = localStorage.getItem('auth.password')
    const sessionId = sessionIdRef.current
    const providerName = cfgRef.current?.providerName
    if (password && providerName !== 'claude-code-vps' && providerName !== 'codex-vps') {
      const msgs = useStore.getState().messages.filter(m => m.conversationId === sessionId && !m.streaming)
      if (msgs.length) saveSessionMsgs(password, sessionId, msgs).catch(() => {})
    }
  }, [])

  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    mutedRef.current = next
    setMuted(next)
    if (next) {
      try { recRef.current?.abort() } catch {}
      captureAbortRef.current?.abort()
      captureAbortRef.current = null
      if (statusRef.current === 'listening') setSt('muted')
    } else if (activeRef.current && (statusRef.current === 'muted' || statusRef.current === 'listening')) {
      listen()
    }
  }, [listen])

  return {
    status, userCaption, aiCaption, error, seconds, muted,
    voiceEmotion, voiceEmotionLabel: VOICE_EMOTION_LABELS[voiceEmotion] || '',
    speechEngine, modelStatus, modelProgress, modelFallbackReason,
    startCall, endCall, toggleMute,
  }
}
