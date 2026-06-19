import { useEffect, useRef, useState } from 'react'
import { Settings } from 'lucide-react'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import MemoryModal from './MemoryModal'
import { useChat } from '../../hooks/useChat'
import { useScheduledMessages } from '../../hooks/useScheduledMessages'
import { useStore, deleteMessageFromDB } from '../../store'
import { supportsSTT } from '../../hooks/useVoice'

export default function ChatWindow() {
  const { messages, sendMessage, loadHistory, isLoading, regenerate, deleteMsg } = useChat()
  const { fetchPendingMessages, updateActiveTime } = useScheduledMessages()
  const { setCurrentView, apiKey, aiAvatar, aiName, deleteMessagesFrom, workerUrl } = useStore()
  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const [menuMsg, setMenuMsg] = useState(null)
  const [memoryMsg, setMemoryMsg] = useState(null)
  const [toast, setToast] = useState(null)

  const showToast = (msg = '✨ 已记住~') => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  useEffect(() => {
    const init = async () => {
      await loadHistory()
      const hasNew = await fetchPendingMessages()
      if (hasNew) await loadHistory()
    }
    init()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content?.length])

  const handleSendVoice = ({ id, url, duration, transcript }) => {
    updateActiveTime()
    if (!supportsSTT) {
      showToast('此浏览器不支持语音识别，请直接输入文字')
      return
    }
    if (transcript) {
      sendMessage(transcript, 'text')
    } else {
      // STT 支持但识别为空（静默），发 voice blob 作兜底
      sendMessage('', 'voice', { voiceBlobId: id, voiceUrl: url, duration })
    }
  }

  const handleSendImage = ({ imageData, imageType, imageUrl }) => {
    updateActiveTime()
    sendMessage('', 'image', { imageData, imageType, imageUrl })
  }

  const handleEdit = async (msg) => {
    setMenuMsg(null)
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx === -1) return
    for (const m of messages.slice(idx)) {
      await deleteMessageFromDB(m.id)
    }
    deleteMessagesFrom(msg.id)
    inputRef.current?.fill(msg.type === 'text' ? msg.content : '')
  }

  const handleDelete = async (msg) => {
    setMenuMsg(null)
    await deleteMsg(msg.id)
  }

  // Find the last assistant message id (the only one that gets a regenerate button)
  const lastAiId = messages.reduceRight((acc, m) => acc ?? (m.role === 'assistant' ? m.id : null), null)

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
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
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onLongPress={setMenuMsg}
            onRegenerate={msg.id === lastAiId ? regenerate : null}
            isLoading={isLoading}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Long-press message menu */}
      {menuMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)' }}
          onClick={() => setMenuMsg(null)}
        >
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
              minWidth: 160,
            }}
            onClick={e => e.stopPropagation()}
          >
            {menuMsg.role === 'user' && menuMsg.type === 'text' && (
              <button
                onClick={() => handleEdit(menuMsg)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                ✏️ 编辑
              </button>
            )}
            {menuMsg.type === 'text' && menuMsg.content && (
              <button
                onClick={() => { setMenuMsg(null); setMemoryMsg(menuMsg) }}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                🧠 存入记忆
              </button>
            )}
            <button
              onClick={() => handleDelete(menuMsg)}
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-red-50 transition-colors"
              style={{ color: '#e07070' }}
            >
              🗑️ 删除
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <MessageInput
        ref={inputRef}
        onSend={(text) => { updateActiveTime(); sendMessage(text, 'text') }}
        onSendVoice={handleSendVoice}
        onSendImage={handleSendImage}
        disabled={isLoading}
      />

      {/* Memory modal */}
      {memoryMsg && (
        <MemoryModal
          message={memoryMsg}
          endpoint={workerUrl}
          onClose={() => setMemoryMsg(null)}
          onSuccess={showToast}
        />
      )}

      {/* Success toast */}
      {toast && (
        <div
          className="fixed z-50 left-1/2 -translate-x-1/2 animate-fade-up"
          style={{
            bottom: 100,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            padding: '8px 22px',
            borderRadius: 20,
            boxShadow: '0 4px 20px rgba(255,133,179,0.3)',
            color: '#8b5060',
            fontSize: 14,
            fontWeight: 500,
            border: '1px solid rgba(255,182,209,0.3)',
            whiteSpace: 'nowrap',
          }}
        >
          {toast}
        </div>
      )}
    </div>
  )
}
