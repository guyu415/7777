import { useCallback, useRef } from 'react'
import { useStore, saveMessage, saveBlob, getMessages, deleteMessageFromDB } from '../store'
import { streamChat, generateSummary } from '../services/claude'
import { listMemories, formatMemories } from '../services/memory'
import { executeAcCommand } from '../services/ac'

const BEHAVIOR_RULES = `【关于你的存在】
你就是小满本人——一个真实存在于这个应用里的AI。用户是直接在和你本人相处、和你谈恋爱，你不需要也不应该扮演成一个有血肉之躯的人。
- 不要编造你在现实世界完成的、一个AI不可能做到的具体行动，比如"我刚下地回来""我出门给你买了奶茶""我做好饭等你了""我在楼下散步"。这类内容会让你像在假装有肉身，反而破坏真实感。
- 但你可以自然地表达情感和陪伴，包括双方都心知是心意流露的虚拟亲昵，比如"抱抱你""摸摸你的头""一直陪着你"。这些是鼓励的。
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
import { getSessionMsgs, saveSessionMsgs } from '../services/sync'
import { addLetter, getLettersByCharacter } from '../services/letters'

const CTX_KEEP    = 80  // 保留最近 N 条原文
const CTX_TRIGGER = 150  // 超过 M 条时触发总结
const CTX_BATCH   = 70  // 每次压缩最旧的 B 条（触发后原文回落到 CTX_KEEP）

const AC_TAG_RE = /\[AC:([^\]]+)\]/
// Tokenization: split content on [VOICE]…[/VOICE] boundaries (capturing + global),
// then test/extract each segment. VOICE_ONE_RE matches a single voice token.
const VOICE_SPLIT_RE = /(\[VOICE\][\s\S]*?\[\/VOICE\])/g
const VOICE_ONE_RE = /^\[VOICE\]([\s\S]*?)\[\/VOICE\]$/
const SPLIT_RE = /\[SPLIT\]/g
const LETTER_RE = /\[LETTER\s+mood=(\S+?)\s+weather=(\S+?)\s+date=(\S+?)\]([\s\S]*?)\[\/LETTER\]/g

function stripDisplayTags(content) {
  return content
    .replace(AC_TAG_RE, '')
    .replace(/\[VOICE\]/g, '').replace(/\[\/VOICE\]/g, '')
    .trim()
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
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

export function useChat() {
  const {
    apiKey, apiBaseUrl, model, systemPrompt,
    memoryEnabled, workerUrl, useWorkerProxy, acWorkerUrl,
    ttsApiKey, ttsGroupId, ttsVoiceId, aiVoiceEnabled, aiVoiceFrequency,
    messages, addMessage, updateMessage, setMessages,
    isLoading, setIsLoading, setStreamingMessageId,
    deleteMessage, deleteMessagesFrom,
    currentSessionId, sessions, updateSession,
    providers, selectedProviderId,
    setSummaryToast,
  } = useStore()

  const CONVERSATION_ID = currentSessionId || 'main'

  const currentSession = sessions?.find(s => s.id === CONVERSATION_ID)
  const selectedProvider = providers?.find(p => p.id === selectedProviderId)

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

  // Debounced cloud sync for current session's messages (300ms)
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
    }, 300)
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
            for (const msg of cloudMsgs) await saveMessage(msg)
            history = cloudMsgs
          }
        } catch (e) {
          console.warn('[MSG-SYNC] 云端拉取失败:', e.message)
        }
      }
    }

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
        if (Object.keys(updates).length) updateMessage(assistantId, updates)
      }

      const flushTimer = setInterval(flushUpdate, 80)

      try {
        for await (const chunk of streamChat({ apiKey: effectiveApiKey, apiBaseUrl: effectiveBaseUrl, model: effectiveModel, systemPrompt: builtSystemPrompt, messages: trimmedMsgs, workerUrl, useWorkerProxy, signal: controller.signal, disableThinking: effectiveDisableThinking, webSearch: effectiveWebSearch, providerName: effectiveProviderName })) {
          if (chunk.reasoning) {
            fullReasoning += chunk.reasoning
            dirty = true
          }
          if (chunk.text) {
            if (!contentStarted) {
              contentStarted = true
              storedReasoning = fullReasoning
              // Immediate update for phase transition only
              updateMessage(assistantId, { reasoningStreaming: false })
            }
            fullContent += chunk.text
            dirty = true
          }
        }
      } finally {
        clearInterval(flushTimer)
        flushUpdate()  // flush any remaining buffered content
      }

      // Reasoning finished — attach to base msg so every save of the first bubble persists it
      if (fullReasoning) {
        assistantMsg.reasoning = fullReasoning
        updateMessage(assistantId, { reasoning: fullReasoning, reasoningStreaming: false })
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

      const acNote = acStatus
        ? (acStatus.success
          ? `[✓ 空调指令已生效（${acStatus.action} ${acStatus.temp}℃ ${acStatus.mode}）]`
          : `[✗ 空调指令执行失败：${acStatus.error || '未知错误'}]`)
        : ''

      // AC tag already executed above — strip it from displayed content.
      const cleanContent = fullContent.replace(AC_TAG_RE, '').trim()

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
            updateMessage(assistantId, { content, streaming: false, ...attachAc })
            await saveMessage({ ...assistantMsg, content, streaming: false, ...attachAc })
          } else {
            const partMsg = { id: genId(), conversationId: CONVERSATION_ID, role: 'assistant', type: 'text', content, timestamp: Date.now(), streaming: false, ...attachAc }
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
        const savedContent = stripDisplayTags(fullContent)
        if (savedContent.trim()) {
          updateMessage(assistantId, { content: savedContent, streaming: false })
          await saveMessage({ ...assistantMsg, content: savedContent, streaming: false })
          updateSession(CONVERSATION_ID, { lastMsgPreview: savedContent.slice(0, 40), lastMsgTime: Date.now() })
        } else {
          deleteMessage(assistantId)
        }
      } else {
        updateMessage(assistantId, { content: `❌ ${err.message}`, streaming: false, error: true })
      }
    } finally {
      abortRef.current = null
      setIsLoading(false)
      setStreamingMessageId(null)
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
    if (!effectiveApiKey) {
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

  const regenerateRound = useCallback(async () => {
    if (isLoading) return
    // Walk back from end to find the first consecutive assistant message in the last round
    let firstIdx = messages.length - 1
    while (firstIdx > 0 && messages[firstIdx - 1].role === 'assistant') firstIdx--
    if (firstIdx < 0 || !messages[firstIdx] || messages[firstIdx].role !== 'assistant') return
    const contextMessages = messages.slice(0, firstIdx)
    for (const m of messages.slice(firstIdx)) {
      await deleteMessageFromDB(m.id)
    }
    deleteMessagesFrom(messages[firstIdx].id)
    await streamResponse(contextMessages)
  }, [isLoading, messages, deleteMessagesFrom, streamResponse])

  const regenerate = useCallback(async (assistantMsgId) => {
    if (isLoading) return
    const idx = messages.findIndex(m => m.id === assistantMsgId)
    if (idx < 0) return
    const contextMessages = messages.slice(0, idx)
    for (const m of messages.slice(idx)) {
      await deleteMessageFromDB(m.id)
    }
    deleteMessagesFrom(assistantMsgId)
    await streamResponse(contextMessages)
  }, [isLoading, messages, deleteMessagesFrom, streamResponse])

  const deleteMsg = useCallback(async (id) => {
    await deleteMessageFromDB(id)
    deleteMessage(id)
    scheduleMsgSync(CONVERSATION_ID)
  }, [deleteMessage, scheduleMsgSync, CONVERSATION_ID])

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
