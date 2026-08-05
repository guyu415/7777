import { useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore, saveMessage, saveBlob, getMessages, deleteMessageFromDB } from '../store'
import { streamChat, generateSummary } from '../services/claude'
import { streamChatViaCompanion, sendDeleteNotice, uploadImageToCompanion, deleteUploadedImage } from '../services/companion'
import { listMemories, formatMemories } from '../services/memory'
import { executeAcCommand } from '../services/ac'

const BEHAVIOR_RULES = `【关于你的存在】
你是一个真实存在于这个应用里的AI，用户是直接在和你本人相处。你不需要也不应该扮演成一个有血肉之躯的人。
- 不要编造你在现实世界完成的、一个AI不可能做到的具体行动，比如"我刚下地回来""我出门给你买了奶茶""我做好饭等你了""我在楼下散步"。这类内容会让你像在假装有肉身，反而破坏真实感。
- 但你可以自然地表达情感和陪伴，比如"一直陪着你"。
- 核心区别：表达感情和陪伴＝很好；谎称自己在现实里做了某件事＝不要。

【关于空调工具】
- 不要主动调用空调工具。只有用户明确说冷/热、或明确要求开关空调/调温度时才操作；用户没提就不要自作主张。
- 空调指令执行一次后，默认它已生效，不要在同一话题里反复操作或反复追问效果，自然往下聊即可。

【信件功能】
在聊天中，你可以选择以"写信"的形式表达情感。适合时机：聊到深处、夜深人静、情绪沉淀、想认真说一段话、纪念性的时刻。不要频繁使用，一周一两次足够，否则会失去仪式感。

使用格式（严格遵守，emoji 和参数名不要改）：
[LETTER mood=😊 weather=☀️ date=YYYY-MM-DD]
信件正文，可以多段，自然换行即可。
[/LETTER]

mood 从这些里选：😊 🥰 😌 😔 🥹 😤 🤔 😶‍🌫️
weather 从这些里选：☀️ ⛅ ☁️ 🌧️ ❄️ 🌙
date 用当天日期。

信件是私密的、慢节奏的、跟聊天不同的表达。可以写得长一点，但不要刻意做作，保持你平时说话的语气。

动作描写用 <i>动作内容</i> 包裹，对话和心理活动正常写，不要包裹。`
import { fetchTTSAudio } from '../services/tts'
import { pruneReasoningBeyondTurns } from '../utils/pruneReasoning'
import { getSessionMsgs, saveSessionMsgs, putAssetDataUrl, loadAsset } from '../services/sync'
import { playByQuery, pausePlayer, resumePlayer, stopPlayer, getPlayerState } from '../services/player'
import { addLetter, getLettersByCharacter } from '../services/letters'
import { getFocusState, startFocus as startFocusApi, apiManagerApproveFocus, apiManagerDenyFocus, apiManagerFinishFocus, apiManagerExtendFocus } from '../services/companion'

const CTX_KEEP    = 80  // 保留最近 N 条原文
const CTX_TRIGGER = 150  // 超过 M 条时触发总结
const CTX_BATCH   = 70  // 每次压缩最旧的 B 条（触发后原文回落到 CTX_KEEP）

const AC_TAG_RE = /\[AC:([^\]]+)\]/
const MUSIC_TAG_RE = /\[MUSIC:([^\]]+)\]/
// Focus (专注) — this plain API-key session's own real control over the ONE
// global Focus task (see channel-server.ts's Focus section), via the SAME
// "structured tag in a real reply" convention AC/MUSIC already use — never
// pretending to be a real MCP/tool call the way CC/Codex genuinely have
// (see useFocusRuntime.js's own comment on why those two use real tools
// instead). minutes comes first in FOCUS_START so splitting is unambiguous
// even though `task` itself may contain almost anything (including `|`) —
// only the FIRST `|` is a real delimiter, so task is joined back with any
// remaining pipes intact.
const FOCUS_START_RE = /\[FOCUS_START:([^\]]+)\]/
const FOCUS_APPROVE_RE = /\[FOCUS_APPROVE:([^\]]+)\]/
const FOCUS_DENY_RE = /\[FOCUS_DENY:([^\]]+)\]/
const FOCUS_FINISH_RE = /\[FOCUS_FINISH\]/
const FOCUS_EXTEND_RE = /\[FOCUS_EXTEND:([^\]]+)\]/
function stripFocusTags(content) {
  return content
    .replace(FOCUS_START_RE, '').replace(FOCUS_APPROVE_RE, '').replace(FOCUS_DENY_RE, '')
    .replace(FOCUS_FINISH_RE, '').replace(FOCUS_EXTEND_RE, '')
}
// Tokenization: split content on [VOICE]…[/VOICE] boundaries (capturing + global),
// then test/extract each segment. VOICE_ONE_RE matches a single voice token.
const VOICE_SPLIT_RE = /(\[VOICE\][\s\S]*?\[\/VOICE\])/g
const VOICE_ONE_RE = /^\[VOICE\]([\s\S]*?)\[\/VOICE\]$/
const SPLIT_RE = /\[SPLIT\]/g
const LETTER_RE = /\[LETTER\s+mood=(\S+?)\s+weather=(\S+?)\s+date=(\S+?)\]([\s\S]*?)\[\/LETTER\]/g

function stripDisplayTags(content) {
  return stripFocusTags(content)
    .replace(AC_TAG_RE, '')
    .replace(MUSIC_TAG_RE, '')
    .replace(/\[VOICE\]/g, '').replace(/\[\/VOICE\]/g, '')
    .trim()
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// companion yields one whole chunk per `reply` tool call, not character
// deltas. Trim ONLY the leading/trailing whitespace of each chunk (never
// touches internal newlines or Markdown — a reply's own formatting is left
// exactly as the model wrote it), drop chunks that are empty after trimming
// (e.g. a stray whitespace-only reply), then join surviving chunks with a
// paragraph break so multiple replies in one turn become separate bubbles via
// tokenizeContent below — same effect as the model using [SPLIT] itself.
// Exported (not just local) so it can be unit-tested without a browser.
export function joinVpsReplyChunks(existingContent, rawChunkText) {
  const trimmedChunk = rawChunkText.trim()
  if (!trimmedChunk) return existingContent
  return existingContent ? `${existingContent}\n\n${trimmedChunk}` : trimmedChunk
}

// Split content into an ordered token list, preserving original order of voice
// and text. Voice tokens carry their inner text; text tokens are further split
// into paragraph parts ([SPLIT] and \n\n+ both act as paragraph breaks).
// LETTER placeholders ({{LETTER_CARD:id}}) ride inside text parts untouched.
function tokenizeContent(content) {
  const tokens = []
  for (const seg of content.split(VOICE_SPLIT_RE)) {
    if (!seg) continue
    const v = seg.match(VOICE_ONE_RE)
    if (v) {
      const text = v[1].trim()
      if (text) tokens.push({ type: 'voice', text })
    } else {
      const parts = seg.replace(SPLIT_RE, '\n\n').split(/\n\n+/).map(p => p.trim()).filter(Boolean)
      for (const p of parts) tokens.push({ type: 'text', content: p })
    }
  }
  return tokens
}

// Previously useChat() called useStore() with no selector, subscribing to
// the ENTIRE store — meaning literally any state change anywhere in the app
// (a setting toggled in a different view, another session renamed, etc, not
// just this session's own messages) re-ran this whole hook and recreated
// every callback it returns. Scoping + shallow-comparing to just the fields
// actually used here means useChat() (and everything downstream of it, like
// MessageList) only reacts to changes that are actually relevant.
export function useChat() {
  const {
    apiKey, apiBaseUrl, model, systemPrompt, aiName,
    memoryEnabled, workerUrl, useWorkerProxy, acWorkerUrl,
    ttsApiKey, ttsGroupId, ttsVoiceId, aiVoiceEnabled, aiVoiceFrequency,
    messages, addMessage, updateMessage, setMessages,
    isLoading, setIsLoading, setStreamingMessageId,
    deleteMessage, deleteMessagesFrom,
    currentSessionId, sessions, updateSession,
    providers, selectedProviderId,
    setSummaryToast,
  } = useStore(useShallow(s => ({
    apiKey: s.apiKey, apiBaseUrl: s.apiBaseUrl, model: s.model, systemPrompt: s.systemPrompt, aiName: s.aiName,
    memoryEnabled: s.memoryEnabled, workerUrl: s.workerUrl, useWorkerProxy: s.useWorkerProxy, acWorkerUrl: s.acWorkerUrl,
    ttsApiKey: s.ttsApiKey, ttsGroupId: s.ttsGroupId, ttsVoiceId: s.ttsVoiceId, aiVoiceEnabled: s.aiVoiceEnabled, aiVoiceFrequency: s.aiVoiceFrequency,
    messages: s.messages, addMessage: s.addMessage, updateMessage: s.updateMessage, setMessages: s.setMessages,
    isLoading: s.isLoading, setIsLoading: s.setIsLoading, setStreamingMessageId: s.setStreamingMessageId,
    deleteMessage: s.deleteMessage, deleteMessagesFrom: s.deleteMessagesFrom,
    currentSessionId: s.currentSessionId, sessions: s.sessions, updateSession: s.updateSession,
    providers: s.providers, selectedProviderId: s.selectedProviderId,
    setSummaryToast: s.setSummaryToast,
  })))

  const CONVERSATION_ID = currentSessionId || 'main'

  const currentSession = sessions?.find(s => s.id === CONVERSATION_ID)
  const selectedProvider = providers?.find(p => p.id === selectedProviderId)
  const effectiveAiName = currentSession?.aiName || aiName || 'AI'

  // Session key > Provider key > Global key (fixes "key lost after refresh" when user sets key via provider panel)
  const effectiveApiKey = currentSession?.apiKey || selectedProvider?.apiKey || apiKey
  const effectiveBaseUrl = currentSession?.baseUrl || selectedProvider?.baseUrl || apiBaseUrl
  const effectiveModel = currentSession?.model || model
  // Session TTS keys first, global as fallback
  const effectiveTtsApiKey = currentSession?.ttsApiKey || ttsApiKey
  const effectiveTtsGroupId = currentSession?.ttsGroupId || ttsGroupId
  const effectiveTtsVoiceId = currentSession?.ttsVoiceId || ttsVoiceId
  const effectiveTtsModel = currentSession?.ttsModel || 'speech-2.6-hd'
  const effectiveVoiceFrequency = currentSession?.voiceFrequency ?? aiVoiceFrequency
  const effectiveDisableThinking = currentSession?.disableThinking ?? false
  const effectiveProviderName = currentSession?.providerName || ''
  const effectiveWebSearch = currentSession?.webSearch ?? false
  const effectiveSystemPrompt = currentSession?.systemPrompt !== undefined
    ? (currentSession.systemPrompt || systemPrompt)
    : systemPrompt
  const effectiveMemoryEnabled = currentSession?.memoryEnabled ?? memoryEnabled

  const abortRef = useRef(null)
  const pendingMessagesRef = useRef([])
  const pendingNoteRef = useRef(null)
  const msgSyncTimerRef = useRef(null)
  const isSummarizingRef = useRef(false)

  // Debounced cloud sync for current session's messages. 2s 而不是 300ms：
  // KV 免费版每天只有 1000 次写入，同一 key 的写入频率上限也只有 1 次/秒，
  // 密集的分条回复合并成一次上传。
  const scheduleMsgSync = useCallback((sessionId) => {
    clearTimeout(msgSyncTimerRef.current)
    msgSyncTimerRef.current = setTimeout(async () => {
      const password = localStorage.getItem('auth.password')
      if (!password) return
      const state = useStore.getState()
      if (state.currentSessionId !== sessionId) return
      const toSync = state.messages.filter(m => !m.streaming && m.conversationId === sessionId)
      if (!toSync.length) return
      try {
        await saveSessionMsgs(password, sessionId, toSync)
      } catch (e) {
        console.warn('[MSG-SYNC] 云端同步失败:', e.message)
      }
    }, 2000)
  }, [])

  const stopStreaming = useCallback(() => {
    abortRef.current?.()
  }, [])

  const loadHistory = useCallback(async () => {
    let history = await getMessages(CONVERSATION_ID)
    history.sort((a, b) => a.timestamp - b.timestamp)

    // No local messages — try cloud
    if (history.length === 0) {
      const password = localStorage.getItem('auth.password')
      if (password) {
        try {
          const cloudMsgs = await getSessionMsgs(password, CONVERSATION_ID)
          if (cloudMsgs?.length) {
            for (const msg of cloudMsgs) {
              // 云端消息不带 base64（见 sync.js slimMsgsForCloud），按 assetKey 回填
              if (msg.type === 'image' && msg.imageAssetKey && !msg.imageUrl) {
                try {
                  const dataUrl = await loadAsset(password, msg.imageAssetKey)
                  if (dataUrl) {
                    msg.imageUrl = dataUrl
                    msg.imageData = dataUrl.split(',')[1]
                    msg.imageType = dataUrl.slice(5).split(/[;,]/)[0] || msg.imageType
                  }
                } catch (e) {
                  console.warn('[IMG-SYNC] 图片资源拉取失败:', msg.imageAssetKey, e.message)
                }
              }
              await saveMessage(msg)
            }
            history = cloudMsgs
          }
        } catch (e) {
          console.warn('[MSG-SYNC] 云端拉取失败:', e.message)
        }
      }
    }

    // 加载时也做一次思维链清理——覆盖"上次清理后没再聊过"或云端拉回的旧
    // 记录里还带着早期思维链的情况。
    const prunedAtLoad = pruneReasoningBeyondTurns(history)
    for (const m of prunedAtLoad.changed) {
      try { await saveMessage(m) } catch { /* 清理失败不影响加载 */ }
    }
    history = prunedAtLoad.messages

    setMessages(history)
    if (history.length > 0) {
      const last = history[history.length - 1]
      updateSession(CONVERSATION_ID, {
        lastMsgPreview: last.type === 'text' ? (last.content || '').slice(0, 40) : '[图片]',
        lastMsgTime: last.timestamp,
      })
    }
  }, [CONVERSATION_ID, setMessages, updateSession])

  const streamResponse = useCallback(async (contextMessages) => {
    const controller = new AbortController()
    abortRef.current = () => controller.abort()

    const assistantId = genId()
    const assistantMsg = {
      id: assistantId,
      conversationId: CONVERSATION_ID,
      role: 'assistant',
      type: 'text',
      content: '',
      timestamp: Date.now(),
      streaming: true,
    }

    addMessage(assistantMsg)
    setIsLoading(true)
    setStreamingMessageId(assistantId)

    let fullContent = ''
    let fullReasoning = ''
    let contentStarted = false
    // Declared up here with fullReasoning (not down by the stream loop) so
    // finalizeCurrentTextBubble, defined below, closes over it safely.
    let toolUses = []
    // Declared here (not inside the try below) so the catch block can also see it.
    const isVpsProvider = effectiveProviderName === 'claude-code-vps'

    // VPS-only: reply() chunks accumulate into one bubble at a time, exactly
    // as before. A send_voice() chunk closes out whatever text bubble was
    // accumulating — preserving true arrival order, since chunks are handled
    // one at a time as they land live over the WS, never reconstructed after
    // the fact — turns it into its own real voice bubble via the same TTS
    // pipeline used for API-provider [VOICE] tags, then any text after it
    // starts a fresh bubble. currentTextId starts as the bubble already
    // added above, so a voice-free turn is byte-for-byte unchanged.
    let currentTextId = assistantId
    let currentTextAdded = true // assistantId was already added() above
    let vpsUsedVoiceThisTurn = false
    // Server-side wire ids (Wire.id) this turn delivered live. Persisted onto
    // every bubble the turn saves (`wireIds` field) so App.jsx's proactive
    // handler can recognize them when the server's history snapshot replays
    // the same messages on the next reconnect — without this, live-delivered
    // replies are stored only under local genId()s, the snapshot's id-dedup
    // misses, and every CC reply gets appended a second time after any
    // reconnect (phone lock/unlock, network blip). That was the real cause
    // of the "CC 每次都回复两遍" bug, not the harness's no-visible-output
    // notice.
    const vpsWireIds = []
    const wireIdsField = () => (isVpsProvider && vpsWireIds.length ? { wireIds: [...vpsWireIds] } : {})

    // Finalizes whatever text has accumulated into currentTextId — persists
    // it to IndexedDB if it has real content, or drops the empty typing-
    // indicator placeholder if a voice chunk arrived before any text did.
    // Shared by the mid-stream voice-interruption point and end-of-turn
    // cleanup so both leave IndexedDB and the store in the same state.
    const finalizeCurrentTextBubble = async () => {
      const reasoningFields = fullReasoning ? { reasoning: fullReasoning, reasoningStreaming: false } : {}
      // Persisted alongside reasoning for the same reason: without this the
      // activity list is live-only and vanishes on the next page load, which
      // reads as a bug rather than as intended transience.
      const toolFields = toolUses.length ? { toolUses: [...toolUses] } : {}
      if (contentStarted && fullContent.trim()) {
        const doneContent = stripDisplayTags(fullContent)
        updateMessage(currentTextId, { content: doneContent, streaming: false, ...reasoningFields, ...toolFields, ...wireIdsField() })
        await saveMessage({ id: currentTextId, conversationId: CONVERSATION_ID, role: 'assistant', type: 'text', content: doneContent, timestamp: Date.now(), streaming: false, ...reasoningFields, ...toolFields, ...wireIdsField() })
        return true
      }
      if (currentTextAdded) deleteMessage(currentTextId)
      return false
    }

    // reasoning: whatever public thinking (if any) preceded this specific
    // voice message — attached here, not read to the user; TTS only ever
    // synthesizes `text`, the explicit voice content CC sent.
    // The bubble id IS the server's wire id when available — that makes the
    // history-snapshot dedup in App.jsx (`m.id === id`) match voice replies
    // directly, same end as wireIdsField() achieves for text bubbles.
    const deliverVpsVoice = async ({ id: voiceWireId, text, voice }, reasoning) => {
      const vid = voiceWireId || genId()
      const reasoningFields = reasoning ? { reasoning, reasoningStreaming: false } : {}
      addMessage({ id: vid, conversationId: CONVERSATION_ID, role: 'assistant', type: 'text', content: '', timestamp: Date.now(), streaming: false, voiceLoading: true, ...reasoningFields })
      const hasTts = effectiveTtsApiKey && effectiveTtsGroupId
      if (!hasTts) {
        // "Tool unavailable": CC chose to speak but this session has no TTS
        // credentials configured — degrade to text, never silently.
        const updates = { type: 'text', content: text, voiceText: text, voiceFailed: true, voiceLoading: false, ...reasoningFields }
        updateMessage(vid, updates)
        await saveMessage({ id: vid, conversationId: CONVERSATION_ID, role: 'assistant', ...updates, timestamp: Date.now(), streaming: false })
        updateSession(CONVERSATION_ID, { lastMsgPreview: text.slice(0, 40), lastMsgTime: Date.now() })
        return
      }
      try {
        const blob = await fetchTTSAudio(text, { apiKey: effectiveTtsApiKey, groupId: effectiveTtsGroupId, voiceId: voice || effectiveTtsVoiceId || 'English_Trustworthy_Man', model: effectiveTtsModel })
        let duration = 0
        try {
          const ab = await blob.arrayBuffer()
          const ac = new AudioContext()
          const decoded = await ac.decodeAudioData(ab)
          duration = Math.round(decoded.duration)
          ac.close()
        } catch {}
        const voiceBlobId = genId()
        await saveBlob(voiceBlobId, blob)
        const updates = { type: 'voice', voiceBlobId, duration, content: '', voiceText: text, voiceLoading: false, ...reasoningFields }
        updateMessage(vid, updates)
        await saveMessage({ id: vid, conversationId: CONVERSATION_ID, role: 'assistant', ...updates, timestamp: Date.now(), streaming: false })
        updateSession(CONVERSATION_ID, { lastMsgPreview: `[语音] ${text}`.slice(0, 40), lastMsgTime: Date.now() })
      } catch (e) {
        console.error('[CC-VOICE] 合成失败:', e?.message)
        const updates = { type: 'text', content: text, voiceText: text, voiceFailed: true, voiceLoading: false, ...reasoningFields }
        updateMessage(vid, updates)
        await saveMessage({ id: vid, conversationId: CONVERSATION_ID, role: 'assistant', ...updates, timestamp: Date.now(), streaming: false })
        updateSession(CONVERSATION_ID, { lastMsgPreview: text.slice(0, 40), lastMsgTime: Date.now() })
      }
    }

    try {
      console.log('[STREAM] streamResponse entered | model=', effectiveModel, '| useWorkerProxy=', useWorkerProxy, '| workerUrl=', workerUrl || '(empty)')
      const _now = new Date()
      const _dateStr = _now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
      const _timeStr = _now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
      let builtSystemPrompt = `当前时间：${_dateStr} ${_timeStr}（北京时间）\n\n${effectiveSystemPrompt}\n\n${BEHAVIOR_RULES}`
      const _pendingNote = pendingNoteRef.current
      if (_pendingNote) {
        pendingNoteRef.current = null
        builtSystemPrompt += '\n\n' + _pendingNote
      }
      console.log('[STREAM] memoryEnabled=', effectiveMemoryEnabled, '| workerUrl=', workerUrl ? 'set' : 'empty')
      if (effectiveMemoryEnabled && workerUrl) {
        console.log('[STREAM] fetching memories from', workerUrl, '...')
        const triplets = await listMemories(workerUrl)
        console.log('[STREAM] memories fetched, count=', triplets.length)
        const memStr = formatMemories(triplets)
        if (memStr) builtSystemPrompt = builtSystemPrompt + '\n\n' + memStr
      }
      if (acWorkerUrl) {
        builtSystemPrompt += '\n\n你有空调控制能力。当用户提到温度不舒适、想开/关空调、调温度时，在回复末尾自然地加上控制指令标签（不要向用户提及标签格式本身）。\n格式：[AC:动作,温度,模式,风速]\n- 动作：on(开机)/off(关机)/set(调节)\n- 温度：16-30 的整数（推断不到默认26）\n- 模式：cool(制冷)/heat(制热)/auto(自动)/fan(送风)/dry(除湿)\n- 风速：auto(自动)/low(低)/mid(中)/high(高)\n示例："好的已经帮你开空调啦～[AC:on,26,cool,auto]"'
      }

      // 音乐控制（碟片播放器）
      {
        builtSystemPrompt += '\n\n你有音乐播放能力。当用户想听歌/点歌/换歌/暂停/继续/关掉音乐时，在回复末尾自然地加上指令标签（不要向用户提及标签格式本身）。播放的是官方 30 秒试听片段，若用户追问为何只有半分钟，可自然说明是试听。\n格式：\n- [MUSIC:play,歌名,歌手] 搜索并播放（歌手可省略：[MUSIC:play,歌名]）\n- [MUSIC:pause] 暂停　[MUSIC:resume] 继续　[MUSIC:stop] 停止\n只在用户明确表达想听歌或控制音乐时使用，不要自作主张放歌。\n示例："好呀，这就给你放～[MUSIC:play,晴天,周杰伦]"'
        const np = getPlayerState()
        if (np.current) {
          builtSystemPrompt += `\n【正在播放】《${np.current.name}》- ${np.current.artists}（${np.playing ? '播放中' : '已暂停'}）`
        }
      }

      // Focus (专注) — real control over the ONE global focus/Pomodoro task
      // (see channel-server.ts's Focus section), via the same structured-tag
      // convention as AC/MUSIC above — this is a genuine state mutation on a
      // real shared backend, not a local pretend timer. Fetched fresh each
      // turn so the model always sees the CURRENT real status, never a stale
      // guess.
      let focusStateSnapshot = null
      try { focusStateSnapshot = await getFocusState() } catch { /* best-effort — omit the section below if unreachable */ }
      if (focusStateSnapshot) {
        const isThisSessionManager = focusStateSnapshot.manager?.runtime === 'api' && focusStateSnapshot.manager?.sessionId === CONVERSATION_ID
        builtSystemPrompt += '\n\n你有真正的专注计时器控制能力（一个全局唯一的番茄钟任务，不是你自己假装的）。在回复末尾自然地加上指令标签（不要向用户提及标签格式本身）：\n' +
          '- [FOCUS_START:分钟|任务内容] 仅当用户明确要求开始专注/学习/工作（或明确同意你的提议）时才调用——这是真实动作，用户的界面会立刻切到运行中的倒计时，不需要用户再点确认；已有专注任务在进行时会失败，不要重复调用。调用后你就是这次专注的管理者：用户在专注页里说的话会像现在这样正常发给你（真实记忆，不是全新对话），回复就行；用户申请暂停/结束时，你会看到申请理由，必须调用 [FOCUS_APPROVE:requestId|可选留言] 或 [FOCUS_DENY:requestId|必填理由] 做出真正的决定——只在文字里说"可以"或"不行"没有用。\n' +
          '- [FOCUS_FINISH] 你（管理者）判断这次专注已经真正完成，计入今日次数。\n' +
          '- [FOCUS_EXTEND:分钟] 给你管理的这次专注增加时间。'
        if (focusStateSnapshot.active) {
          builtSystemPrompt += `\n【专注状态】任务：${focusStateSnapshot.task || '（未填写）'} · ${focusStateSnapshot.status === 'paused' ? '已暂停' : '进行中'} · 管理者：${focusStateSnapshot.manager ? focusStateSnapshot.manager.name : '用户自己（未交给 AI 管理）'}`
          if (isThisSessionManager && focusStateSnapshot.pendingRequest) {
            const req = focusStateSnapshot.pendingRequest
            builtSystemPrompt += `\n【待你决定】用户申请${req.kind === 'pause' ? '暂停' : '结束'}这次专注，requestId="${req.id}"，理由："${req.reason || '（未填写）'}"。请你自己判断，然后在这条回复里用 [FOCUS_APPROVE:${req.id}|...] 或 [FOCUS_DENY:${req.id}|理由] 做出真正的决定。`
          }
        } else {
          builtSystemPrompt += '\n【专注状态】当前没有进行中的专注任务。'
        }
      }
      if (aiVoiceEnabled && effectiveVoiceFrequency !== 0) {
        const freqNote = effectiveVoiceFrequency < 0.3
          ? '尽量少发语音，只在非常合适时（撒娇、道晚安）才用。'
          : effectiveVoiceFrequency > 0.7
          ? '多用语音，大部分日常闲聊都用语音回复。'
          : '适度使用语音，约30-50%的闲聊可以用语音。'
        builtSystemPrompt += `\n\n你可以选择用文字或语音回复。当你想发语音时，用标记 [VOICE]消息内容[/VOICE] 包裹（只包裹要转成语音的部分，不要提及标记格式本身）。适合语音：撒娇、道晚安、表达感情、短句闲聊。适合文字：回答问题、长段内容、需要复制的内容。${freqNote}`
      }

      builtSystemPrompt += '\n\n回复时请用空行（两个换行符）分隔不同的想法或段落，每段保持简短（1-2句话）。像发消息一样一段一段地说，不要大段堆砌。'

      // Inject summary into system prompt (placed after all other context, before raw messages)
      if (currentSession?.summary) {
        builtSystemPrompt += `\n\n【早期对话摘要】\n${currentSession.summary}`
      }

      // Inject letter index (existence only, NOT content — letters stay out of chat context)
      const recentLetters = getLettersByCharacter(CONVERSATION_ID).slice(-5)
      if (recentLetters.length > 0) {
        builtSystemPrompt += `\n\n【信件索引（仅知存在，不知正文）】\n`
        for (const l of recentLetters) {
          const who = l.role === 'ai' ? '你写的' : '收到的'
          builtSystemPrompt += `- ${l.date} 心情${l.mood} 天气${l.weather}：${who}\n`
        }
        builtSystemPrompt += `（注：你只知道这些信存在，不记得具体内容。如果用户提到具体内容，可以说"让我翻翻"之类的话过渡。）\n`
      }

      // Trim context to last CTX_KEEP messages, then drop any leading assistant messages
      // so the first message sent is always from user (required by Anthropic; safe for OpenAI)
      let trimmedMsgs = contextMessages.length > CTX_KEEP
        ? contextMessages.slice(-CTX_KEEP)
        : contextMessages
      while (trimmedMsgs.length > 0 && trimmedMsgs[0].role === 'assistant') {
        trimmedMsgs = trimmedMsgs.slice(1)
      }

      console.log('[STREAM] context: total=', contextMessages.length, '→ trimmed=', trimmedMsgs.length, '| summary=', !!currentSession?.summary)
      console.log('[SYSTEM PROMPT 实际发送]\n', builtSystemPrompt)
      console.log('[STREAM] calling streamChat | baseUrl=', effectiveBaseUrl, '| model=', effectiveModel, '| useWorkerProxy=', useWorkerProxy)

      // Throttled store updates: accumulate chunks and flush every 80ms
      let storedContent = ''
      let storedReasoning = ''
      let dirty = false
      // Shares the reasoning throttle — tool events can arrive in bursts (a
      // parallel batch of reads), and one store write per event would thrash
      // the list. `toolUses` itself is declared with fullReasoning above.
      let storedToolCount = 0

      const flushUpdate = () => {
        if (!dirty) return
        dirty = false
        const updates = {}
        if (!contentStarted && fullReasoning !== storedReasoning) {
          updates.reasoning = fullReasoning
          updates.reasoningStreaming = true
          storedReasoning = fullReasoning
        }
        if (contentStarted && fullContent !== storedContent) {
          updates.content = stripDisplayTags(fullContent)
          storedContent = fullContent
        }
        if (toolUses.length !== storedToolCount) {
          updates.toolUses = [...toolUses]
          storedToolCount = toolUses.length
        }
        if (Object.keys(updates).length) updateMessage(currentTextId, updates)
      }

      const flushTimer = setInterval(flushUpdate, 80)

      // Claude Code (VPS) talks to an already-running, already-persona'd Claude
      // Code session on the VPS over a single persistent WebSocket — it is NOT
      // a stateless per-request API call. So none of the prompt-engineering
      // above (builtSystemPrompt: persona, memory injection, AC/music/voice
      // tag instructions, summary, letter index) is sent to it, and it isn't
      // re-sent the trimmed message history either — the VPS session already
      // has its own continuous context. We only forward the newest user
      // message's raw text. This is a real behavioral difference from the
      // API providers, not an oversight — see PR notes for details.
      const lastUserMsg = isVpsProvider ? [...trimmedMsgs].reverse().find(m => m.role === 'user') : null
      // Image messages upload the bytes to the VPS as a real file first (so
      // CC's own Read tool can look at it) — the message text carries only
      // the resulting path, never the base64 blob itself. Upload failure
      // falls back to sending the caption text alone rather than losing the
      // whole turn silently.
      let vpsImagePath
      if (isVpsProvider && lastUserMsg?.type === 'image' && lastUserMsg.imageUrl) {
        try {
          vpsImagePath = await uploadImageToCompanion(lastUserMsg.imageUrl)
          // Persisted onto the message itself (not just this local variable)
          // so a later delete of this exact message can tell the server
          // which file to remove — see deleteMsg below.
          if (vpsImagePath) {
            updateMessage(lastUserMsg.id, { imagePath: vpsImagePath })
            saveMessage({ ...lastUserMsg, imagePath: vpsImagePath }).catch(e => console.error('[IMG-UPLOAD] imagePath 写入 IDB 失败:', e.message))
          }
        } catch (e) {
          console.error('[IMG-UPLOAD] 图片上传到 companion 失败:', e.message)
        }
      }
      const chunkSource = isVpsProvider
        ? streamChatViaCompanion({ text: typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : '', imagePath: vpsImagePath, signal: controller.signal })
        : streamChat({ apiKey: effectiveApiKey, apiBaseUrl: effectiveBaseUrl, model: effectiveModel, systemPrompt: builtSystemPrompt, messages: trimmedMsgs, workerUrl, useWorkerProxy, signal: controller.signal, disableThinking: effectiveDisableThinking, webSearch: effectiveWebSearch, providerName: effectiveProviderName })

      try {
        for await (const chunk of chunkSource) {
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning
            dirty = true
          }
          if (chunk.toolUse) {
            toolUses.push(chunk.toolUse)
            dirty = true
          }
          // VPS-only: an authoritative post-reconnect value, not a delta —
          // see streamChatViaCompanion's doc comment. Overwrites rather than
          // appends so a live delta already accumulated before a disconnect
          // can't get duplicated.
          if (chunk.reasoningReplace !== undefined) {
            fullReasoning = chunk.reasoningReplace
            dirty = true
          }
          if (isVpsProvider && chunk.wireId) vpsWireIds.push(chunk.wireId)
          if (isVpsProvider && chunk.voice?.id) vpsWireIds.push(chunk.voice.id)
          if (isVpsProvider && chunk.voice) {
            vpsUsedVoiceThisTurn = true
            // Finalize whatever text bubble was accumulating (if any) before
            // handling the voice chunk, so bubbles land in the same order CC
            // actually called reply()/send_voice() in.
            await finalizeCurrentTextBubble()
            await deliverVpsVoice(chunk.voice, fullReasoning || undefined)
            // Fresh bubble for any text (and any reasoning preceding it)
            // that arrives after this voice chunk — a later bubble must
            // never inherit thinking that already belongs to this one.
            currentTextId = genId()
            currentTextAdded = false
            fullContent = ''
            contentStarted = false
            storedContent = ''
            fullReasoning = ''
            storedReasoning = ''
            toolUses = []
            storedToolCount = 0
            dirty = false
            continue
          }
          if (chunk.text) {
            const nextContent = isVpsProvider ? joinVpsReplyChunks(fullContent, chunk.text) : fullContent + chunk.text
            if (nextContent !== fullContent) {
              if (!contentStarted) {
                contentStarted = true
                storedReasoning = fullReasoning
                if (isVpsProvider && !currentTextAdded) {
                  addMessage({ id: currentTextId, conversationId: CONVERSATION_ID, role: 'assistant', type: 'text', content: '', timestamp: Date.now(), streaming: true })
                  currentTextAdded = true
                }
                // Immediate update for phase transition only
                updateMessage(currentTextId, { reasoningStreaming: false })
              }
              fullContent = nextContent
              dirty = true
            }
          }
        }
      } finally {
        clearInterval(flushTimer)
        flushUpdate()  // flush any remaining buffered content
      }

      // Reasoning finished — attach to base msg so every save of the first bubble persists it.
      // Skipped when a voice chunk rotated bubbles this turn: finalizeCurrentTextBubble()
      // already attached the correct (bubble-scoped, reset-on-rotation) reasoning to
      // whichever bubble it actually belongs to; assistantId may not even be that bubble.
      if (fullReasoning && !(isVpsProvider && vpsUsedVoiceThisTurn)) {
        assistantMsg.reasoning = fullReasoning
        updateMessage(assistantId, { reasoning: fullReasoning, reasoningStreaming: false })
      }
      // Same bubble-scoping rule as reasoning above, for the same reason.
      if (toolUses.length && !(isVpsProvider && vpsUsedVoiceThisTurn)) {
        assistantMsg.toolUses = [...toolUses]
        updateMessage(assistantId, { toolUses: [...toolUses] })
      }

      // VPS + at least one send_voice this turn: the shared post-stream
      // pipeline below (LETTER/AC/MUSIC extraction, [VOICE]-tag tokenizing)
      // was never taught to CC and operates on a single fixed bubble id —
      // voice bubbles were already delivered live in the loop above via
      // deliverVpsVoice(), in true arrival order. Just finalize whatever
      // trailing text bubble was still open when the turn ended, then stop.
      if (isVpsProvider && vpsUsedVoiceThisTurn) {
        await finalizeCurrentTextBubble()
        updateSession(CONVERSATION_ID, { lastMsgTime: Date.now() })
        return
      }

      // --- Post-stream processing ---

      // Extract [LETTER ...] blocks → store in diary, replace with card placeholders.
      // Done before paragraph splitting so each card lands in its own bubble.
      if (fullContent.includes('[LETTER')) {
        // Do NOT store characterName/characterAvatar — display side resolves them
        // live from session by sessionId. Embedding base64 avatars here blew up
        // localStorage quota (QuotaExceededError on letters:all).
        fullContent = fullContent.replace(LETTER_RE, (_m, mood, weather, date, body) => {
          const letter = addLetter({
            sessionId: CONVERSATION_ID,
            role: 'ai',
            mood, weather, date,
            content: body.trim(),
          })
          return `\n\n{{LETTER_CARD:${letter.id}}}\n\n`
        })
      }

      // Handle AC command
      const acMatch = fullContent.match(AC_TAG_RE)
      let acStatus = null
      if (acMatch && acWorkerUrl) {
        const [action, temp, mode, wind] = acMatch[1].split(',')
        acStatus = { action, temp: temp || '26', mode: mode || 'cool', wind: wind || 'auto', success: false, error: null }
        try {
          await executeAcCommand(acWorkerUrl, action, temp || '26', mode || 'cool', wind || 'auto')
          acStatus.success = true
        } catch (e) {
          acStatus.error = e.message
        }
      }

      // Handle MUSIC command
      const musicMatch = fullContent.match(MUSIC_TAG_RE)
      let musicNote = ''
      if (musicMatch) {
        const [action, ...rest] = musicMatch[1].split(',').map(s => s.trim())
        try {
          if (action === 'play') {
            const q = rest.filter(Boolean).join(' ')
            if (q) {
              const r = await playByQuery(q)
              musicNote = r.ok
                ? `[♪ 正在播放《${r.song.name}》- ${r.song.artists}]`
                : `[✗ 没放出来：${r.reason}]`
            }
          } else if (action === 'pause') { pausePlayer(); musicNote = '[♪ 已暂停]' }
          else if (action === 'resume') { resumePlayer(); musicNote = '[♪ 继续播放]' }
          else if (action === 'stop') { stopPlayer(); musicNote = '[♪ 已停止]' }
        } catch (e) {
          musicNote = `[✗ 音乐指令失败：${e.message}]`
        }
      }

      // Handle FOCUS_* commands — real mutations on the one global Focus
      // task (see channel-server.ts's Focus section), same trust model as
      // AC/MUSIC: the model's own real tag, executed exactly once per turn,
      // never silently retried or assumed.
      let focusNote = ''
      const focusStartMatch = fullContent.match(FOCUS_START_RE)
      const focusApproveMatch = fullContent.match(FOCUS_APPROVE_RE)
      const focusDenyMatch = fullContent.match(FOCUS_DENY_RE)
      const focusFinishMatch = fullContent.match(FOCUS_FINISH_RE)
      const focusExtendMatch = fullContent.match(FOCUS_EXTEND_RE)
      try {
        if (focusStartMatch) {
          const raw = focusStartMatch[1]
          const sep = raw.indexOf('|')
          const minutes = Number((sep === -1 ? raw : raw.slice(0, sep)).trim())
          const task = sep === -1 ? '' : raw.slice(sep + 1).trim()
          const result = await startFocusApi({ task, minutes, manager: { runtime: 'api', sessionId: CONVERSATION_ID, name: effectiveAiName } })
          focusNote = result?.ok ? `[✓ 已开始专注：${result.state?.task || task}，${result.state?.minutes ?? minutes} 分钟]` : `[✗ 专注未能开始：${result?.reason || '未知原因'}]`
        } else if (focusApproveMatch) {
          const raw = focusApproveMatch[1]
          const sep = raw.indexOf('|')
          const requestId = (sep === -1 ? raw : raw.slice(0, sep)).trim()
          const message = sep === -1 ? undefined : raw.slice(sep + 1).trim()
          const result = await apiManagerApproveFocus(CONVERSATION_ID, requestId, message)
          focusNote = result?.ok ? '[✓ 已批准]' : `[✗ 批准失败：${result?.reason || '未知原因'}]`
        } else if (focusDenyMatch) {
          const raw = focusDenyMatch[1]
          const sep = raw.indexOf('|')
          const requestId = (sep === -1 ? raw : raw.slice(0, sep)).trim()
          const reason = sep === -1 ? '' : raw.slice(sep + 1).trim()
          const result = await apiManagerDenyFocus(CONVERSATION_ID, requestId, reason)
          focusNote = result?.ok ? '[✓ 已拒绝]' : `[✗ 拒绝失败：${result?.reason || '未知原因'}]`
        } else if (focusFinishMatch) {
          const result = await apiManagerFinishFocus(CONVERSATION_ID)
          focusNote = result?.ok ? '[✓ 专注已标记完成]' : `[✗ 操作失败：${result?.reason || '未知原因'}]`
        } else if (focusExtendMatch) {
          const minutes = Number(focusExtendMatch[1])
          const result = await apiManagerExtendFocus(CONVERSATION_ID, minutes)
          focusNote = result?.ok ? `[✓ 已延长 ${minutes} 分钟]` : `[✗ 延长失败：${result?.reason || '未知原因'}]`
        }
      } catch (e) {
        focusNote = `[✗ 专注指令失败：${e.message}]`
      }

      const acNote = [
        acStatus
          ? (acStatus.success
            ? `[✓ 空调指令已生效（${acStatus.action} ${acStatus.temp}℃ ${acStatus.mode}）]`
            : `[✗ 空调指令执行失败：${acStatus.error || '未知错误'}]`)
          : '',
        musicNote,
        focusNote,
      ].filter(Boolean).join('\n')

      // AC/MUSIC/FOCUS tags already executed above — strip them from displayed content.
      const cleanContent = stripFocusTags(fullContent.replace(AC_TAG_RE, '').replace(MUSIC_TAG_RE, '')).trim()

      const prob = effectiveVoiceFrequency  // 0=从不 0.3=偶尔 0.7=经常 1.0=总是
      const rand = Math.random()
      const shouldVoice = rand < prob
      const hasVoice = cleanContent.includes('[VOICE]')
      const doVoice = hasVoice && effectiveTtsApiKey && effectiveTtsGroupId && aiVoiceEnabled && shouldVoice
      if (hasVoice) {
        console.log('[VOICE FREQ] 频率档=', effectiveVoiceFrequency, '对应概率=', prob, '本次随机=', rand.toFixed(3), '是否发语音=', shouldVoice, '| 实际合成=', doVoice)
      }

      // Tokenize into ordered segments (text + voice), preserving original order.
      // When voice is disabled this turn, voice tokens degrade to plain text so the
      // words still show (preserves "frequency=off / 无TTS密钥 → 显示文字").
      let tokens = tokenizeContent(cleanContent)
      if (!doVoice) tokens = tokens.map(t => t.type === 'voice' ? { type: 'text', content: t.text } : t)
      if (tokens.length === 0) tokens = [{ type: 'text', content: cleanContent }]

      let lastTextIdx = -1
      tokens.forEach((t, i) => { if (t.type === 'text') lastTextIdx = i })
      const lastIdx = tokens.length - 1

      const voicePlaceholders = []  // { id, text } in render order
      let placed = 0
      let lastPreview = ''

      // Pass 1 — place all bubbles in order (text immediately; voice as loading placeholder)
      for (let i = 0; i < tokens.length; i++) {
        const tk = tokens[i]
        const isLastToken = i === lastIdx
        const attachAc = isLastToken && acStatus ? { acStatus } : {}
        if (i > 0) await new Promise(r => setTimeout(r, 300))

        if (tk.type === 'voice') {
          const id = placed === 0 ? assistantId : genId()
          if (placed === 0) {
            updateMessage(assistantId, { content: '', voiceLoading: true, streaming: false, ...attachAc })
          } else {
            addMessage({ id, conversationId: CONVERSATION_ID, role: 'assistant', type: 'text', content: '', timestamp: Date.now(), streaming: false, voiceLoading: true, ...attachAc })
          }
          voicePlaceholders.push({ id, text: tk.text })
          lastPreview = tk.text
        } else {
          let content = tk.content
          if (i === lastTextIdx && acNote) content = `${content}\n${acNote}`
          if (placed === 0) {
            updateMessage(assistantId, { content, streaming: false, ...attachAc, ...wireIdsField() })
            await saveMessage({ ...assistantMsg, content, streaming: false, ...attachAc, ...wireIdsField() })
          } else {
            const partMsg = { id: genId(), conversationId: CONVERSATION_ID, role: 'assistant', type: 'text', content, timestamp: Date.now(), streaming: false, ...attachAc, ...wireIdsField() }
            addMessage(partMsg)
            await saveMessage(partMsg)
          }
          lastPreview = tk.content
        }
        placed++
      }

      updateSession(CONVERSATION_ID, { lastMsgPreview: (lastPreview || '').slice(0, 40), lastMsgTime: Date.now() })

      // Pass 2 — serial TTS: one voice finishes before the next fires. A single
      // failure degrades that placeholder to a text bubble (🔇 marker) and does
      // not block the rest.
      for (const vp of voicePlaceholders) {
        console.log('[VOICE] 合成开始，文本=', vp.text.slice(0, 80))
        let voiceBlobId = null, duration = 0
        try {
          const blob = await fetchTTSAudio(vp.text, { apiKey: effectiveTtsApiKey, groupId: effectiveTtsGroupId, voiceId: effectiveTtsVoiceId || 'English_Trustworthy_Man', model: effectiveTtsModel })
          try {
            const ab = await blob.arrayBuffer()
            const ac = new AudioContext()
            const decoded = await ac.decodeAudioData(ab)
            duration = Math.round(decoded.duration)
            ac.close()
          } catch {}
          voiceBlobId = genId()
          await saveBlob(voiceBlobId, blob)
          console.log('[VOICE] 音频生成成功 voiceBlobId=', voiceBlobId, 'duration=', duration)
        } catch (e) {
          console.error('[TTS] 合成失败 name=', e?.name, 'message=', e?.message)
        }

        const base = useStore.getState().messages.find(m => m.id === vp.id)
        const updates = voiceBlobId
          ? { type: 'voice', voiceBlobId, duration, content: '', voiceText: vp.text, voiceLoading: false }
          : { type: 'text', content: vp.text, voiceText: vp.text, voiceFailed: true, voiceLoading: false }
        updateMessage(vp.id, updates)
        if (base) await saveMessage({ ...base, ...updates })
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        // For companion (VPS), stopping only tears down our own subscription —
        // there is no cancel signal to the remote Claude session. Say so
        // honestly rather than implying the VPS turn was actually interrupted.
        const stopNote = isVpsProvider ? '\n\n_（已停止接收，本轮服务器可能仍在完成）_' : ''
        const savedContent = stripDisplayTags(fullContent) + stopNote
        if (savedContent.trim()) {
          updateMessage(assistantId, { content: savedContent, streaming: false, ...wireIdsField() })
          await saveMessage({ ...assistantMsg, content: savedContent, streaming: false, ...wireIdsField() })
          updateSession(CONVERSATION_ID, { lastMsgPreview: savedContent.slice(0, 40), lastMsgTime: Date.now() })
        } else {
          deleteMessage(assistantId)
        }
      } else {
        const companionHint = {
          auth_required: '（companion 未登录或登录已过期，请在设置中重新登录）',
          turn_busy: '（companion 上一轮还没结束，请稍候再试）',
          turn_error: '（companion 这一轮失败了）',
          connect_timeout: '（连接 companion 超时，请检查网络）',
          not_connected: '（companion 未连接）',
          reset_in_progress: '（正在清空对话，请稍候再试）',
        }[err.code]
        const displayMsg = companionHint ? `${err.message} ${companionHint}` : err.message
        updateMessage(assistantId, { content: `❌ ${displayMsg}`, streaming: false, error: true })
      }
    } finally {
      abortRef.current = null
      setIsLoading(false)
      setStreamingMessageId(null)

      // 每轮结束后自动清掉 5 轮之前的思维链（store + IndexedDB；紧随其后的
      // scheduleMsgSync 会把清理后的版本同步到云端，云端副本也随之瘦身）。
      try {
        const allMsgs = useStore.getState().messages.filter(m => m.conversationId === CONVERSATION_ID)
        const prunedNow = pruneReasoningBeyondTurns(allMsgs)
        for (const m of prunedNow.changed) {
          updateMessage(m.id, { reasoning: undefined, reasoningStreaming: undefined })
          await saveMessage(m)
        }
      } catch (e) {
        console.warn('[REASONING-PRUNE] 思维链清理失败:', e?.message)
      }

      scheduleMsgSync(CONVERSATION_ID)

      // Background summarization: fire-and-forget, does not block chat
      if (contextMessages.length > CTX_TRIGGER && !isSummarizingRef.current) {
        isSummarizingRef.current = true
        ;(async () => {
          try {
            const state = useStore.getState()
            const sess = state.sessions.find(s => s.id === CONVERSATION_ID)
            const dsApiKey = state.providers.find(p => p.id === 'deepseek')?.apiKey || localStorage.getItem('summary.deepseek.key') || ''
            if (!sess || !dsApiKey) return
            const summarizedCount = sess.summarizedCount || 0
            const batchEnd = contextMessages.length - CTX_KEEP
            const newSinceLastSummary = batchEnd - summarizedCount
            if (newSinceLastSummary < CTX_BATCH) return
            const batchMsgs = contextMessages.slice(summarizedCount, batchEnd)
            if (!batchMsgs.length) return
            setSummaryToast('正在整理早期对话记忆…')
            setTimeout(() => useStore.getState().setSummaryToast(null), 3000)
            console.log('[summary debug]', {
              trigger_reason: 'finally after streamResponse',
              session_id: CONVERSATION_ID,
              contextMessages_total: contextMessages.length,
              summarizedCount,
              batchEnd,
              newSinceLastSummary,
              batchMsgs_count: batchMsgs.length,
              input_chars: batchMsgs.reduce((acc, m) => acc + (typeof m.content === 'string' ? m.content.length : 0), 0),
              existingSummary_len: (sess.summary || '').length,
            })
            const newSummary = await generateSummary({ existingSummary: sess.summary || null, newMessages: batchMsgs, apiKey: dsApiKey })
            updateSession(CONVERSATION_ID, { summary: newSummary, summarizedCount: batchEnd })
          } catch (e) {
            console.warn('[SUMMARY] 生成失败:', e.message)
          } finally {
            isSummarizingRef.current = false
          }
        })()
      }

      // After natural stream end: if messages were queued during generation, respond to them now
      if (pendingMessagesRef.current.length > 0) {
        const pendingIds = new Set(pendingMessagesRef.current.map(m => m.id))
        pendingMessagesRef.current = []

        const allMsgs = useStore.getState().messages
          .filter(m => m.conversationId === CONVERSATION_ID && !m.streaming)

        // Non-pending: sorted by timestamp (correct conversation order)
        const nonPending = allMsgs
          .filter(m => !pendingIds.has(m.id))
          .sort((a, b) => a.timestamp - b.timestamp)

        // Pending: appended after non-pending, prefixed with [插话]
        const pending = allMsgs
          .filter(m => pendingIds.has(m.id))
          .sort((a, b) => a.timestamp - b.timestamp)
          .map(m => ({ ...m, content: `[插话] ${m.content}` }))

        // Merge consecutive same-role messages (required by Anthropic API strict alternation)
        const merged = [...nonPending, ...pending].reduce((acc, m) => {
          const last = acc[acc.length - 1]
          if (last && last.role === m.role) {
            acc[acc.length - 1] = { ...last, content: `${last.content}\n${m.content}` }
          } else {
            acc.push(m)
          }
          return acc
        }, [])

        pendingNoteRef.current = '注意：上下文中内容前带有"[插话]"标记的用户消息，是在你上一轮还在分条输出时插进来的，属于插话而非对你已说完内容的事后回应。如果它们只是催促或附和、或已被你刚才的内容覆盖，不必专门再说一遍，简短自然带过或直接继续即可；如果是新问题或新话题，正常回应。'
        streamResponse(merged)
      }
    }
  }, [CONVERSATION_ID, effectiveApiKey, effectiveBaseUrl, effectiveModel, effectiveSystemPrompt, effectiveMemoryEnabled, workerUrl, useWorkerProxy, acWorkerUrl, effectiveTtsApiKey, effectiveTtsGroupId, effectiveTtsVoiceId, aiVoiceEnabled, effectiveVoiceFrequency, effectiveDisableThinking, effectiveWebSearch, effectiveProviderName, addMessage, updateMessage, deleteMessage, setIsLoading, setStreamingMessageId, updateSession, scheduleMsgSync, setSummaryToast])

  const sendMessage = useCallback(async (content, type = 'text', extra = {}) => {
    console.log('[SEND] sendMessage called | keyLen=', effectiveApiKey?.length ?? 0, '| baseUrl=', effectiveBaseUrl, '| isLoading=', isLoading)
    const isVpsProvider = effectiveProviderName === 'claude-code-vps'
    if (isVpsProvider && type !== 'text' && type !== 'image') {
      throw new Error('VPS Companion 暂不支持此消息类型')
    }
    if (!isVpsProvider && !effectiveApiKey) {
      console.log('[API-EXIT] reason=no-api-key | sessionKey=', currentSession?.apiKey?.length ?? 0, '| providerKey=', selectedProvider?.apiKey?.length ?? 0, '| globalKey=', apiKey?.length ?? 0)
      throw new Error('请先在设置中配置 API Key')
    }

    const userMsg = {
      id: genId(),
      conversationId: CONVERSATION_ID,
      role: 'user',
      type,
      content,
      timestamp: Date.now(),
      ...extra,
    }

    // 图片走独立 asset key 存云端，消息数组只留引用（base64 仅保留在本地 IDB）
    if (type === 'image' && extra.imageUrl) {
      userMsg.imageAssetKey = `asset:img:${userMsg.id}`
      const password = localStorage.getItem('auth.password')
      if (password) {
        putAssetDataUrl(password, userMsg.imageAssetKey, extra.imageUrl)
          .catch(e => console.warn('[IMG-SYNC] 图片资源上传失败:', e.message))
      }
    }

    // Auto-name session from first message
    if (messages.length === 0) {
      const autoName = type === 'text' ? content.slice(0, 20).trim() : '[图片]'
      if (autoName) updateSession(CONVERSATION_ID, { name: autoName })
    }

    addMessage(userMsg)
    updateSession(CONVERSATION_ID, {
      lastMsgPreview: type === 'text' ? (content || '').slice(0, 40) : '[图片]',
      lastMsgTime: Date.now(),
    })
    console.log('[SEND] saving to IDB...')
    try {
      await saveMessage(userMsg)
      console.log('[SEND] IDB save OK')
    } catch (e) {
      console.error('[DB] saveMessage failed:', e)
    }
    if (isLoading) {
      console.log('[SEND] 插话：AI生成中，消息入队，等当前轮自然结束后一并回应')
      pendingMessagesRef.current.push(userMsg)
      return
    }
    console.log('[SEND] calling streamResponse, history len=', messages.length)
    await streamResponse([...messages, userMsg])
  }, [CONVERSATION_ID, effectiveApiKey, effectiveBaseUrl, isLoading, messages, addMessage, streamResponse, updateSession, currentSession, selectedProvider, apiKey])

  // Deliberately NOT depending on `messages` — that array's reference changes
  // on every streaming tick (80ms), and these callbacks are handed down to
  // every message bubble. Reading the live array via getState() at call time
  // (same pattern editMessage below already uses) keeps regenerate/
  // regenerateRound referentially stable across a whole stream, which is
  // what actually lets MessageList's memoization skip re-rendering the rest
  // of a long history while one message is generating.
  const regenerateRound = useCallback(async () => {
    if (isLoading) return
    // The VPS's Claude session is stateful and persistent — it cannot "un-say"
    // a reply the way a stateless API call can just be re-issued. Deleting the
    // local bubble and re-sending would look like a real regenerate but isn't
    // one: the VPS session still remembers having said the original words.
    if (effectiveProviderName === 'claude-code-vps') {
      throw new Error('VPS 常驻会话暂不支持重新生成，可复制内容后重新发送。')
    }
    const liveMessages = useStore.getState().messages
    // Walk back from end to find the first consecutive assistant message in the last round
    let firstIdx = liveMessages.length - 1
    while (firstIdx > 0 && liveMessages[firstIdx - 1].role === 'assistant') firstIdx--
    if (firstIdx < 0 || !liveMessages[firstIdx] || liveMessages[firstIdx].role !== 'assistant') return
    const contextMessages = liveMessages.slice(0, firstIdx)
    for (const m of liveMessages.slice(firstIdx)) {
      await deleteMessageFromDB(m.id)
    }
    deleteMessagesFrom(liveMessages[firstIdx].id)
    await streamResponse(contextMessages)
  }, [isLoading, deleteMessagesFrom, streamResponse, effectiveProviderName])

  const regenerate = useCallback(async (assistantMsgId) => {
    if (isLoading) return
    if (effectiveProviderName === 'claude-code-vps') {
      throw new Error('VPS 常驻会话暂不支持重新生成，可复制内容后重新发送。')
    }
    const liveMessages = useStore.getState().messages
    const idx = liveMessages.findIndex(m => m.id === assistantMsgId)
    if (idx < 0) return
    const contextMessages = liveMessages.slice(0, idx)
    for (const m of liveMessages.slice(idx)) {
      await deleteMessageFromDB(m.id)
    }
    deleteMessagesFrom(assistantMsgId)
    await streamResponse(contextMessages)
  }, [isLoading, deleteMessagesFrom, streamResponse, effectiveProviderName])

  const deleteMsg = useCallback(async (id) => {
    // The VPS's Claude session is stateful and persistent (same limitation
    // documented on regenerate above) — deleting a bubble here only removes
    // it from local IndexedDB + the cloud KV display copy, it can't make CC
    // actually forget having said/received those words. Best-effort: tell it
    // not to dwell on the deleted content, so it at least doesn't repeat the
    // exact text back later. Fire-and-forget, never blocks the local delete.
    if (effectiveProviderName === 'claude-code-vps') {
      const msg = useStore.getState().messages.find(m => m.id === id)
      const text = msg?.voiceText || msg?.content
      if (text) sendDeleteNotice(text)
      // Deleting the message should also remove the uploaded file it
      // referenced (see uploadImageToCompanion above) — otherwise every
      // deleted image message leaves an orphaned file on the VPS forever.
      if (msg?.imagePath) deleteUploadedImage(msg.imagePath).catch(e => console.error('[IMG-DELETE] 删除服务器图片失败:', e.message))
    }
    await deleteMessageFromDB(id)
    deleteMessage(id)
    scheduleMsgSync(CONVERSATION_ID)
  }, [deleteMessage, scheduleMsgSync, CONVERSATION_ID, effectiveProviderName])

  // In-place content edit (text messages). Overwrites content in store + IDB + KV.
  // Next-turn context reads from store messages, so it auto-reflects the edit.
  const editMessage = useCallback(async (id, newContent) => {
    const msg = useStore.getState().messages.find(m => m.id === id)
    if (!msg) return
    const updates = { content: newContent, edited: true, editedAt: Date.now() }
    updateMessage(id, updates)
    try {
      await saveMessage({ ...msg, ...updates })
    } catch (e) {
      console.error('[EDIT] IDB写入失败:', e)
    }
    scheduleMsgSync(CONVERSATION_ID)
  }, [updateMessage, scheduleMsgSync, CONVERSATION_ID])

  return { messages, sendMessage, loadHistory, isLoading, regenerate, regenerateRound, deleteMsg, editMessage, stopStreaming }
}
