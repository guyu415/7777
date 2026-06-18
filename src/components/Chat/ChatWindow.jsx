import { useEffect, useRef } from 'react'
import { Settings, Sparkles } from 'lucide-react'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import { useChat } from '../../hooks/useChat'
import { useStore } from '../../store'

export default function ChatWindow() {
  const { messages, sendMessage, loadHistory, isLoading } = useChat()
  const { setCurrentView, apiKey } = useStore()
  const bottomRef = useRef(null)

  useEffect(() => {
    loadHistory()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content?.length])

  const handleSendVoice = ({ id, url, duration }) => {
    sendMessage('', 'voice', { voiceBlobId: id, voiceUrl: url, duration })
  }

  const handleSendImage = ({ imageData, imageType, imageUrl }) => {
    sendMessage('', 'image', { imageData, imageType, imageUrl })
  }

  return (
    <div className="flex flex-col h-full bg-pink-50/30">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-pink-100 safe-top shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-pink-300 to-pink-500 flex items-center justify-center text-lg shadow-sm">
            🌸
          </div>
          <div>
            <div className="font-semibold text-gray-800 text-sm">小漫</div>
            <div className="text-[11px] text-pink-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
              在线
            </div>
          </div>
        </div>
        <button
          onClick={() => setCurrentView('settings')}
          className="w-9 h-9 rounded-full bg-pink-50 flex items-center justify-center text-pink-400"
        >
          <Settings size={18} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="text-5xl">🌸</div>
            <div className="text-pink-400 font-medium">你好，我是小漫！</div>
            <div className="text-sm text-gray-400 max-w-[200px]">
              {apiKey ? '说点什么开始聊天吧～' : '请先在设置中配置 API Key'}
            </div>
            {!apiKey && (
              <button
                onClick={() => setCurrentView('settings')}
                className="mt-2 px-5 py-2 bg-pink-400 text-white rounded-full text-sm font-medium shadow-md"
              >
                去配置 ⚙️
              </button>
            )}
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <MessageInput
        onSend={(text) => sendMessage(text, 'text')}
        onSendVoice={handleSendVoice}
        onSendImage={handleSendImage}
        disabled={isLoading}
      />
    </div>
  )
}
