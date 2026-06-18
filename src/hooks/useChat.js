import { useCallback } from 'react'
import { useStore, saveMessage, getMessages } from '../store'
import { streamChat } from '../services/claude'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const CONVERSATION_ID = 'main'

export function useChat() {
  const {
    apiKey, model, systemPrompt,
    messages, addMessage, updateMessage, setMessages,
    isLoading, setIsLoading, streamingMessageId, setStreamingMessageId
  } = useStore()

  const loadHistory = useCallback(async () => {
    const history = await getMessages(CONVERSATION_ID)
    history.sort((a, b) => a.timestamp - b.timestamp)
    setMessages(history)
  }, [setMessages])

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
    await saveMessage(userMsg)

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
      const allMessages = [...messages, userMsg]
      let fullContent = ''

      for await (const chunk of streamChat({ apiKey, model, systemPrompt, messages: allMessages })) {
        fullContent += chunk
        updateMessage(assistantId, { content: fullContent })
      }

      const finalMsg = { ...assistantMsg, content: fullContent, streaming: false }
      updateMessage(assistantId, { streaming: false })
      await saveMessage({ ...finalMsg, content: fullContent })
    } catch (err) {
      updateMessage(assistantId, { content: `❌ ${err.message}`, streaming: false, error: true })
    } finally {
      setIsLoading(false)
      setStreamingMessageId(null)
    }
  }, [apiKey, model, systemPrompt, messages, addMessage, updateMessage, setIsLoading, setStreamingMessageId, isLoading])

  return { messages, sendMessage, loadHistory, isLoading }
}
