import { useEffect, useRef } from 'react'
import { Settings } from 'lucide-react'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import { useChat } from '../../hooks/useChat'
import { useStore } from '../../store'

export default function ChatWindow() {
  const { messages, sendMessage, loadHistory, isLoading } = useChat()
  const { setCurrentView, apiKey, aiAvatar, aiName } = useStore()
  const bottomRef = useRef(null)

  useEffect(() => { loadHistory() }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content?.length])

  const handleSendVoice = ({ id, url, duration }) =>
    sendMessage('', 'voice', { voiceBlobId: id, voiceUrl: url, duration })

  const handleSendImage = ({ imageData, imageType, imageUrl }) =>
    sendMessage('', 'image', { imageData, imageType, imageUrl })

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header — glass */}
      <div className="glass flex items-center justify-between px-4 py-3 safe-top"
        style={{ boxShadow: '0 2px 16px rgba(255,133,179,0.12)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-full overflow-hidden flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: 'rgba(255,182,193,0.4)', boxShadow: '0 2px 8px rgba(255,133,179,0.25)' }}>
            {aiAvatar
              ? <img src={aiAvatar} alt="" className="w-full h-full object-cover" />
              : '🌸'}
          </div>
          <div>
            <div className="font-semibold text-sm" style={{ color: '#8b5060' }}>
              {aiName || '小漫'} <span className="text-pink-300">✿</span>
            </div>
            <div className="flex items-center gap-1 text-[11px]" style={{ color: '#c47a8a' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block shadow-sm" />
              在线
            </div>
          </div>
        </div>
        <button
          onClick={() => setCurrentView('settings')}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300"
          style={{ background: 'rgba(255,182,193,0.3)', color: '#c47a8a' }}
        >
          <Settings size={17} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="text-5xl">🌸</div>
            <div className="font-medium" style={{ color: '#c47a8a' }}>你好，我是{aiName || '小漫'}！</div>
            <div className="text-sm max-w-[200px]" style={{ color: '#d4a0b0' }}>
              {apiKey ? '说点什么开始聊天吧～' : '请先在设置中配置 API Key'}
            </div>
            {!apiKey && (
              <button
                onClick={() => setCurrentView('settings')}
                className="mt-2 px-6 py-2.5 rounded-full text-sm font-medium text-white transition-all duration-300"
                style={{ background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)', boxShadow: '0 4px 16px rgba(255,133,179,0.4)' }}
              >
                去配置 ⚙️
              </button>
            )}
          </div>
        )}
        {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
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
