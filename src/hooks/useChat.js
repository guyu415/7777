import { useCallback } from 'react'
import { useStore, saveMessage, getMessages, deleteMessageFromDB } from '../store'
import { streamChat } from '../services/claude'
import { listMemories, formatMemories } from '../services/memory'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const CONVERSATION_ID = 'main'

export function useChat() {
  const {
    apiKey, apiBaseUrl, model, systemPrompt,
    memoryEnabled, workerUrl,
    messages, addMessage, updateMessage, setMessages,
    isLoading, setIsLoading, setStreamingMessageId,
    deleteMessage, deleteMessagesFrom,
  } = useStore()

  const loadHistory = useCallback(async () => {
    const history = await getMessages(CONVERSATION_ID)
    history.sort((a, b) => a.timestamp - b.timestamp)
    setMessages(history)
  }, [setMessages])

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
      let effectiveSystemPrompt = `当前时间：${_dateStr} ${_timeStr}（北京时间）\n\n${systemPrompt}`
      if (memoryEnabled && workerUrl) {
        const triplets = await listMemories(workerUrl)
        const memStr = formatMemories(triplets)
        if (memStr) effectiveSystemPrompt = effectiveSystemPrompt + '\n\n' + memStr
      }

      let fullContent = ''
      for await (const chunk of streamChat({ apiKey, apiBaseUrl, model, systemPrompt: effectiveSystemPrompt, messages: contextMessages })) {
        fullContent += chunk
        updateMessage(assistantId, { content: fullContent })
      }
      updateMessage(assistantId, { streaming: false })
      await saveMessage({ ...assistantMsg, content: fullContent, streaming: false })
    } catch (err) {
      updateMessage(assistantId, { content: `❌ ${err.message}`, streaming: false, error: true })
    } finally {
      setIsLoading(false)
      setStreamingMessageId(null)
    }
  }, [apiKey, apiBaseUrl, model, systemPrompt, memoryEnabled, workerUrl, addMessage, updateMessage, setIsLoading, setStreamingMessageId])

  const sendMessage = useCallback(async (content, type = 'text', extra = {}) => {
    if (!apiKey) throw new Error('请先在设置中配置 API Key')
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
    try {
      await saveMessage(userMsg)
    } catch (e) {
      console.error('[DB] saveMessage failed:', e)
    }
    await streamResponse([...messages, userMsg])
  }, [apiKey, isLoading, messages, addMessage, streamResponse])

  const regenerate = useCallback(async (assistantMsgId) => {
    if (isLoading) return
    const idx = messages.findIndex(m => m.id === assistantMsgId)
    if (idx < 0) return
    const contextMessages = messages.slice(0, idx)
    // Delete the assistant message and everything after it
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
