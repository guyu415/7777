import { useCallback, useRef } from 'react'
import { useStore, saveMessage, saveBlob, getMessages, deleteMessageFromDB } from '../store'
import { streamChat } from '../services/claude'
import { listMemories, formatMemories } from '../services/memory'
import { executeAcCommand } from '../services/ac'
import { fetchTTSAudio } from '../services/tts'
import { getSessionMsgs, saveSessionMsgs } from '../services/sync'

const AC_TAG_RE = /\[AC:([^\]]+)\]/
const VOICE_TAG_RE = /\[VOICE\]([\s\S]*?)\[\/VOICE\]/
const SPLIT_RE = /\[SPLIT\]/g

function stripDisplayTags(content) {
  return content
    .replace(AC_TAG_RE, '')
    .replace(/\[VOICE\]/g, '').replace(/\[\/VOICE\]/g, '')
    .trim()
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
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
  const effectiveSystemPrompt = currentSession?.systemPrompt !== undefined
    ? (currentSession.systemPrompt || systemPrompt)
    : systemPrompt
  const effectiveMemoryEnabled = currentSession?.memoryEnabled ?? memoryEnabled

  const abortRef = useRef(null)
  const msgSyncTimerRef = useRef(null)

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

    try {
      console.log('[STREAM] streamResponse entered | model=', effectiveModel, '| useWorkerProxy=', useWorkerProxy, '| workerUrl=', workerUrl || '(empty)')
      const _now = new Date()
      const _dateStr = _now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
      const _timeStr = _now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
      let builtSystemPrompt = `当前时间：${_dateStr} ${_timeStr}（北京时间）\n\n${effectiveSystemPrompt}`
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
      if (effectiveTtsApiKey && effectiveTtsGroupId && aiVoiceEnabled) {
        const freqNote = effectiveVoiceFrequency < 0.3
          ? '尽量少发语音，只在非常合适时（撒娇、道晚安）才用。'
          : effectiveVoiceFrequency > 0.7
          ? '多用语音，大部分日常闲聊都用语音回复。'
          : '适度使用语音，约30-50%的闲聊可以用语音。'
        builtSystemPrompt += `\n\n你可以选择用文字或语音回复。当你想发语音时，用标记 [VOICE]消息内容[/VOICE] 包裹（只包裹要转成语音的部分，不要提及标记格式本身）。适合语音：撒娇、道晚安、表达感情、短句闲聊。适合文字：回答问题、长段内容、需要复制的内容。${freqNote}`
      }

      builtSystemPrompt += '\n\n回复时请用空行（两个换行符）分隔不同的想法或段落，每段保持简短（1-2句话）。像发消息一样一段一段地说，不要大段堆砌。'

      console.log('[System Prompt]\n' + effectiveSystemPrompt)
      console.log('[STREAM] calling streamChat | baseUrl=', effectiveBaseUrl, '| model=', effectiveModel, '| useWorkerProxy=', useWorkerProxy)

      for await (const chunk of streamChat({ apiKey: effectiveApiKey, apiBaseUrl: effectiveBaseUrl, model: effectiveModel, systemPrompt: builtSystemPrompt, messages: contextMessages, workerUrl, useWorkerProxy, signal: controller.signal })) {
        fullContent += chunk
        updateMessage(assistantId, { content: stripDisplayTags(fullContent) })
      }

      // --- Post-stream processing ---

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

      const voiceMatch = fullContent.match(VOICE_TAG_RE)

      if (voiceMatch && effectiveTtsApiKey && effectiveTtsGroupId && aiVoiceEnabled) {
        // Voice mode: emit surrounding text bubbles first, then an independent voice bubble
        const voiceText = voiceMatch[1].trim()
        const surroundText = fullContent.replace(VOICE_TAG_RE, '').replace(AC_TAG_RE, '').trim()
        const textParts = surroundText.split(/\n\n+/).map(p => p.trim()).filter(Boolean)

        if (textParts.length > 0) {
          // First text part → reuse the streaming bubble
          updateMessage(assistantId, { content: textParts[0], streaming: false })
          await saveMessage({ ...assistantMsg, content: textParts[0], streaming: false })

          // Additional text parts with delay
          for (let i = 1; i < textParts.length; i++) {
            await new Promise(r => setTimeout(r, 300))
            const partMsg = {
              id: genId(), conversationId: CONVERSATION_ID, role: 'assistant',
              type: 'text', content: textParts[i], timestamp: Date.now(), streaming: false,
            }
            addMessage(partMsg)
            await saveMessage(partMsg)
          }

          // Delay before voice bubble
          await new Promise(r => setTimeout(r, 300))

          // Voice as a separate new bubble
          const voiceMsgId = genId()
          const voiceMsgBase = {
            id: voiceMsgId, conversationId: CONVERSATION_ID, role: 'assistant',
            type: 'text', content: '', timestamp: Date.now(), streaming: false, voiceLoading: true,
          }
          addMessage(voiceMsgBase)

          let voiceBlobId = null, duration = 0
          try {
            const blob = await fetchTTSAudio(voiceText, { apiKey: effectiveTtsApiKey, groupId: effectiveTtsGroupId, voiceId: effectiveTtsVoiceId || 'English_Trustworthy_Man', model: effectiveTtsModel })
            try {
              const ab = await blob.arrayBuffer()
              const ac = new AudioContext()
              const decoded = await ac.decodeAudioData(ab)
              duration = Math.round(decoded.duration)
              ac.close()
            } catch {}
            voiceBlobId = genId()
            await saveBlob(voiceBlobId, blob)
          } catch (e) {
            console.error('[TTS]', e.message)
          }

          const voiceUpdates = voiceBlobId
            ? { type: 'voice', voiceBlobId, duration, content: '', voiceText, voiceLoading: false, streaming: false, ...(acStatus ? { acStatus } : {}) }
            : { content: voiceText, voiceLoading: false, streaming: false, type: 'text', ...(acStatus ? { acStatus } : {}) }
          updateMessage(voiceMsgId, voiceUpdates)
          await saveMessage({ ...voiceMsgBase, ...voiceUpdates })
          updateSession(CONVERSATION_ID, { lastMsgPreview: voiceText.slice(0, 40), lastMsgTime: Date.now() })

        } else {
          // No surrounding text — voice replaces the streaming bubble
          updateMessage(assistantId, { streaming: false, voiceLoading: true, content: '' })

          let voiceBlobId = null, duration = 0
          try {
            const blob = await fetchTTSAudio(voiceText, { apiKey: effectiveTtsApiKey, groupId: effectiveTtsGroupId, voiceId: effectiveTtsVoiceId || 'English_Trustworthy_Man', model: effectiveTtsModel })
            try {
              const ab = await blob.arrayBuffer()
              const ac = new AudioContext()
              const decoded = await ac.decodeAudioData(ab)
              duration = Math.round(decoded.duration)
              ac.close()
            } catch {}
            voiceBlobId = genId()
            await saveBlob(voiceBlobId, blob)
          } catch (e) {
            console.error('[TTS]', e.message)
          }

          const updates = voiceBlobId
            ? { type: 'voice', voiceBlobId, duration, content: '', voiceText, voiceLoading: false, streaming: false, ...(acStatus ? { acStatus } : {}) }
            : { content: voiceText, voiceLoading: false, streaming: false, type: 'text', ...(acStatus ? { acStatus } : {}) }
          updateMessage(assistantId, updates)
          await saveMessage({ ...assistantMsg, ...updates })
          updateSession(CONVERSATION_ID, { lastMsgPreview: voiceText.slice(0, 40), lastMsgTime: Date.now() })
        }

      } else {
        // Text-only: auto-split by paragraph breaks (also treat [SPLIT] as paragraph break)
        const displayContent = fullContent.replace(AC_TAG_RE, '').replace(VOICE_TAG_RE, '$1').trim()
        const splitContent = displayContent.replace(SPLIT_RE, '\n\n')
        const parts = splitContent.split(/\n\n+/).map(p => p.trim()).filter(Boolean)

        if (parts.length > 1) {
          updateMessage(assistantId, { content: parts[0], streaming: false })
          await saveMessage({ ...assistantMsg, content: parts[0], streaming: false })

          for (let i = 1; i < parts.length; i++) {
            await new Promise(r => setTimeout(r, 300))
            const isLast = i === parts.length - 1
            const partMsg = {
              id: genId(), conversationId: CONVERSATION_ID, role: 'assistant',
              type: 'text', content: parts[i], timestamp: Date.now(), streaming: false,
              ...(isLast && acStatus ? { acStatus } : {}),
            }
            addMessage(partMsg)
            await saveMessage(partMsg)
          }

          updateSession(CONVERSATION_ID, {
            lastMsgPreview: parts[parts.length - 1].slice(0, 40),
            lastMsgTime: Date.now(),
          })
        } else {
          const content = parts[0] || displayContent
          updateMessage(assistantId, { content, streaming: false, ...(acStatus ? { acStatus } : {}) })
          await saveMessage({ ...assistantMsg, content, streaming: false, ...(acStatus ? { acStatus } : {}) })
          updateSession(CONVERSATION_ID, { lastMsgPreview: content.slice(0, 40), lastMsgTime: Date.now() })
        }
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
    }
  }, [CONVERSATION_ID, effectiveApiKey, effectiveBaseUrl, effectiveModel, effectiveSystemPrompt, effectiveMemoryEnabled, workerUrl, useWorkerProxy, acWorkerUrl, effectiveTtsApiKey, effectiveTtsGroupId, effectiveTtsVoiceId, aiVoiceEnabled, effectiveVoiceFrequency, addMessage, updateMessage, deleteMessage, setIsLoading, setStreamingMessageId, updateSession, scheduleMsgSync])

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
      console.log('[API-EXIT] reason=is-loading | 用户消息已入库，等待当前流结束')
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

  return { messages, sendMessage, loadHistory, isLoading, regenerate, regenerateRound, deleteMsg, stopStreaming }
}
