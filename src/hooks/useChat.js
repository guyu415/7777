import { useCallback } from 'react'
import { useStore, saveMessage, saveBlob, getMessages, deleteMessageFromDB } from '../store'
import { streamChat } from '../services/claude'
import { listMemories, formatMemories } from '../services/memory'
import { executeAcCommand } from '../services/ac'
import { fetchTTSAudio } from '../services/tts'

const AC_TAG_RE = /\[AC:([^\]]+)\]/
const VOICE_TAG_RE = /\[VOICE\]([\s\S]*?)\[\/VOICE\]/

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
    memoryEnabled, workerUrl, acWorkerUrl,
    ttsApiKey, ttsGroupId, ttsVoiceId, aiVoiceEnabled, aiVoiceFrequency,
    messages, addMessage, updateMessage, setMessages,
    isLoading, setIsLoading, setStreamingMessageId,
    deleteMessage, deleteMessagesFrom,
    currentSessionId, sessions, updateSession,
    providers, selectedProviderId, selectedModelId,
  } = useStore()

  const CONVERSATION_ID = currentSessionId || 'main'

  const currentSession = sessions?.find(s => s.id === CONVERSATION_ID)
  const effectiveProviderId = currentSession?.providerId || selectedProviderId
  const effectiveModelId = currentSession?.modelId || selectedModelId
  const selectedProvider = providers?.find(p => p.id === effectiveProviderId)

  const effectiveApiKey = selectedProvider?.apiKey || apiKey
  const effectiveBaseUrl = selectedProvider?.baseUrl || apiBaseUrl
  const effectiveModel = effectiveModelId || model
  const effectiveSystemPrompt = currentSession?.systemPrompt !== undefined
    ? (currentSession.systemPrompt || systemPrompt)
    : systemPrompt

  const loadHistory = useCallback(async () => {
    const history = await getMessages(CONVERSATION_ID)
    history.sort((a, b) => a.timestamp - b.timestamp)
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

    try {
      const _now = new Date()
      const _dateStr = _now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })
      const _timeStr = _now.toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })
      let builtSystemPrompt = `当前时间：${_dateStr} ${_timeStr}（北京时间）\n\n${effectiveSystemPrompt}`
      if (memoryEnabled && workerUrl) {
        const triplets = await listMemories(workerUrl)
        const memStr = formatMemories(triplets)
        if (memStr) builtSystemPrompt = builtSystemPrompt + '\n\n' + memStr
      }
      if (acWorkerUrl) {
        builtSystemPrompt += '\n\n你有空调控制能力。当用户提到温度不舒适、想开/关空调、调温度时，在回复末尾自然地加上控制指令标签（不要向用户提及标签格式本身）。\n格式：[AC:动作,温度,模式,风速]\n- 动作：on(开机)/off(关机)/set(调节)\n- 温度：16-30 的整数（推断不到默认26）\n- 模式：cool(制冷)/heat(制热)/auto(自动)/fan(送风)/dry(除湿)\n- 风速：auto(自动)/low(低)/mid(中)/high(高)\n示例："好的已经帮你开空调啦～[AC:on,26,cool,auto]"'
      }
      if (ttsApiKey && ttsGroupId && aiVoiceEnabled) {
        const freqNote = aiVoiceFrequency < 0.3
          ? '尽量少发语音，只在非常合适时（撒娇、道晚安）才用。'
          : aiVoiceFrequency > 0.7
          ? '多用语音，大部分日常闲聊都用语音回复。'
          : '适度使用语音，约30-50%的闲聊可以用语音。'
        builtSystemPrompt += `\n\n你可以选择用文字或语音回复。当你想发语音时，用标记 [VOICE]消息内容[/VOICE] 包裹（只包裹要转成语音的部分，不要提及标记格式本身）。适合语音：撒娇、道晚安、表达感情、短句闲聊。适合文字：回答问题、长段内容、需要复制的内容。${freqNote}`
      }

      console.log('[System Prompt]\n' + effectiveSystemPrompt)
      let fullContent = ''
      for await (const chunk of streamChat({ apiKey: effectiveApiKey, apiBaseUrl: effectiveBaseUrl, model: effectiveModel, systemPrompt: builtSystemPrompt, messages: contextMessages })) {
        fullContent += chunk
        updateMessage(assistantId, { content: stripDisplayTags(fullContent) })
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

      // Handle VOICE tag
      const voiceMatch = fullContent.match(VOICE_TAG_RE)
      if (voiceMatch && ttsApiKey && ttsGroupId && aiVoiceEnabled) {
        const voiceText = voiceMatch[1].trim()
        const surroundText = fullContent.replace(VOICE_TAG_RE, '').replace(AC_TAG_RE, '').trim()

        // Immediately switch to loading state so streaming text doesn't flash then disappear
        updateMessage(assistantId, { streaming: false, voiceLoading: true, content: surroundText })

        let voiceBlobId = null
        let duration = 0

        try {
          const blob = await fetchTTSAudio(voiceText, {
            apiKey: ttsApiKey, groupId: ttsGroupId,
            voiceId: ttsVoiceId || 'English_Trustworthy_Man',
          })
          // Compute duration
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
          ? { type: 'voice', voiceBlobId, duration, content: surroundText, voiceText, voiceLoading: false, streaming: false, ...(acStatus ? { acStatus } : {}) }
          : { content: voiceText + (surroundText ? '\n' + surroundText : ''), voiceLoading: false, streaming: false, ...(acStatus ? { acStatus } : {}) }
        updateMessage(assistantId, updates)
        await saveMessage({ ...assistantMsg, ...updates })
        updateSession(CONVERSATION_ID, {
          lastMsgPreview: voiceText.slice(0, 40),
          lastMsgTime: Date.now(),
        })
      } else {
        const displayContent = fullContent.replace(AC_TAG_RE, '').replace(VOICE_TAG_RE, '$1').trim()
        updateMessage(assistantId, { content: displayContent, streaming: false, ...(acStatus ? { acStatus } : {}) })
        await saveMessage({ ...assistantMsg, content: displayContent, streaming: false, ...(acStatus ? { acStatus } : {}) })
        updateSession(CONVERSATION_ID, {
          lastMsgPreview: displayContent.slice(0, 40),
          lastMsgTime: Date.now(),
        })
      }
    } catch (err) {
      updateMessage(assistantId, { content: `❌ ${err.message}`, streaming: false, error: true })
    } finally {
      setIsLoading(false)
      setStreamingMessageId(null)
    }
  }, [CONVERSATION_ID, effectiveApiKey, effectiveBaseUrl, effectiveModel, effectiveSystemPrompt, memoryEnabled, workerUrl, acWorkerUrl, ttsApiKey, ttsGroupId, ttsVoiceId, aiVoiceEnabled, aiVoiceFrequency, addMessage, updateMessage, setIsLoading, setStreamingMessageId, updateSession])

  const sendMessage = useCallback(async (content, type = 'text', extra = {}) => {
    if (!effectiveApiKey) throw new Error('请先在设置中配置 API Key')
    if (isLoading) return

    const userMsg = {
      id: genId(),
      conversationId: CONVERSATION_ID,
      role: 'user',
      type,
      content,
      timestamp: Date.now(),
      ...extra,
    }

    addMessage(userMsg)
    updateSession(CONVERSATION_ID, {
      lastMsgPreview: type === 'text' ? (content || '').slice(0, 40) : '[图片]',
      lastMsgTime: Date.now(),
    })
    try {
      await saveMessage(userMsg)
    } catch (e) {
      console.error('[DB] saveMessage failed:', e)
    }
    await streamResponse([...messages, userMsg])
  }, [CONVERSATION_ID, effectiveApiKey, isLoading, messages, addMessage, streamResponse, updateSession])

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
  }, [deleteMessage])

  return { messages, sendMessage, loadHistory, isLoading, regenerate, deleteMsg }
}
