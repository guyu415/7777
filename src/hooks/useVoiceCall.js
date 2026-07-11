import { useState, useRef, useCallback } from 'react'
import { useStore, saveMessage } from '../store'
import { streamChat } from '../services/claude'
import { fetchTTSAudio } from '../services/tts'
import { saveSessionMsgs } from '../services/sync'

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
export const supportsVoiceCall = !!SpeechRecognitionAPI

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

  const activeRef = useRef(false)
  const mutedRef = useRef(false)
  const statusRef = useRef('idle')
  const recRef = useRef(null)
  const abortRef = useRef(null)
  const audioElRef = useRef(null)
  const audioCtxRef = useRef(null)
  const sourceRef = useRef(null)
  const timerRef = useRef(null)
  const cfgRef = useRef(null)
  const sessionIdRef = useRef('main')
  const visHandlerRef = useRef(null)

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

  const listen = useCallback(() => {
    if (!activeRef.current) return
    if (mutedRef.current) { setSt('muted'); return }
    setSt('listening')
    setUserCaption('')
    let finalText = ''
    let heard = '' // finals + 当前 interim（iOS 经常不标 isFinal，必须兜底）
    let silenceTimer = null
    let maxTimer = null
    const rec = new SpeechRecognitionAPI()
    rec.lang = 'zh-CN'
    rec.interimResults = true
    // iOS 的识别器不会在停顿后自动结束（安卓才会），所以用 continuous
    // 模式自己判停：有内容且 1.4s 没有新结果就主动 stop
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
      if (heard) silenceTimer = setTimeout(stopRec, 1400)
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
      if (text) handleTurn(text)
      else setTimeout(() => listen(), 300) // 没听到内容，继续听
    }
    recRef.current = rec
    maxTimer = setTimeout(stopRec, 30_000) // 单句上限 30s
    try { rec.start() } catch { setTimeout(() => listen(), 500) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTurn = useCallback(async (text) => {
    const cfg = cfgRef.current
    const sessionId = sessionIdRef.current
    setSt('thinking')
    setUserCaption(text)
    setAiCaption('')

    const state = useStore.getState()
    const userMsg = { id: genId(), conversationId: sessionId, role: 'user', type: 'text', content: text, timestamp: Date.now() }
    state.addMessage(userMsg)
    try { await saveMessage(userMsg) } catch {}

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
      for await (const chunk of streamChat({
        apiKey: cfg.apiKey, apiBaseUrl: cfg.baseUrl, model: cfg.model,
        systemPrompt: cfg.systemPrompt + CALL_RULES,
        messages: ctx,
        workerUrl: cfg.workerUrl, useWorkerProxy: cfg.useWorkerProxy,
        signal: controller.signal,
        disableThinking: true, webSearch: false, providerName: cfg.providerName,
      })) {
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

    const aiMsg = { id: genId(), conversationId: sessionId, role: 'assistant', type: 'text', content: spoken, timestamp: Date.now() }
    useStore.getState().addMessage(aiMsg)
    try { await saveMessage(aiMsg) } catch {}
    setAiCaption(spoken)
    useStore.getState().updateSession(sessionId, { lastMsgPreview: spoken.slice(0, 40), lastMsgTime: Date.now() })

    await consumer // 等所有句子播完
    if (activeRef.current) setTimeout(() => listen(), 250)
  }, [listen])

  // audioKit：调用方在用户点击的调用栈里创建并解锁的 { el: <audio>, ctx: AudioContext }
  const startCall = useCallback(({ sessionId, audioKit, ...cfg }) => {
    if (!SpeechRecognitionAPI) { setError('此浏览器不支持语音识别，无法通话'); return false }
    if (!cfg.apiKey) { setError('请先在设置中配置 API Key'); return false }
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
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
    // 锁屏/切后台：iOS 会掐断麦克风，安静暂停；回到前台自动恢复聆听
    const onVis = () => {
      if (!activeRef.current) return
      if (document.visibilityState === 'hidden') {
        try { recRef.current?.abort() } catch {}
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
    abortRef.current?.abort()
    abortRef.current = null
    try { sourceRef.current?.stop() } catch {}
    sourceRef.current = null
    const audio = audioElRef.current
    if (audio) { try { audio.pause() } catch {} }
    const ctx = audioCtxRef.current
    audioCtxRef.current = null
    if (ctx) { try { ctx.close() } catch {} }
    setSt('idle')
    // 通话内容整体同步到云端（一次写入）
    const password = localStorage.getItem('auth.password')
    const sessionId = sessionIdRef.current
    if (password) {
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
      if (statusRef.current === 'listening') setSt('muted')
    } else if (activeRef.current && (statusRef.current === 'muted' || statusRef.current === 'listening')) {
      listen()
    }
  }, [listen])

  return { status, userCaption, aiCaption, error, seconds, muted, startCall, endCall, toggleMute }
}
