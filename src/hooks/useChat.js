import { useCallback } from 'react'
import { useStore, saveMessage, getMessages, deleteMessageFromDB } from '../store'
import { streamChat } from '../services/claude'
import { listMemories, formatMemories } from '../services/memory'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function useChat() {
  const {
    apiKey, apiBaseUrl, model, systemPrompt,
    memoryEnabled, workerUrl,
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

      console.log('[System Prompt]\n' + effectiveSystemPrompt)
      let fullContent = ''
      for await (const chunk of streamChat({ apiKey: effectiveApiKey, apiBaseUrl: effectiveBaseUrl, model: effectiveModel, systemPrompt: builtSystemPrompt, messages: contextMessages })) {
        fullContent += chunk
        updateMessage(assistantId, { content: fullContent })
      }
      updateMessage(assistantId, { streaming: false })
      await saveMessage({ ...assistantMsg, content: fullContent, streaming: false })
      updateSession(CONVERSATION_ID, {
        lastMsgPreview: fullContent.slice(0, 40),
        lastMsgTime: Date.now(),
      })
    } catch (err) {
      updateMessage(assistantId, { content: `❌ ${err.message}`, streaming: false, error: true })
    } finally {
      setIsLoading(false)
      setStreamingMessageId(null)
    }
  }, [CONVERSATION_ID, effectiveApiKey, effectiveBaseUrl, effectiveModel, effectiveSystemPrompt, memoryEnabled, workerUrl, addMessage, updateMessage, setIsLoading, setStreamingMessageId, updateSession])

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
