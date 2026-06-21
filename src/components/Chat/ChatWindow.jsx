import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import MessageBubble from './MessageBubble'
import MessageInput from './MessageInput'
import MemoryModal from './MemoryModal'
import BottomNav from '../BottomNav'
import { useChat } from '../../hooks/useChat'
import { useScheduledMessages } from '../../hooks/useScheduledMessages'
import { useStore, deleteMessageFromDB } from '../../store'

const draftsBySession = {}

function Signature({ text, color, shadow }) {
  const wrapRef = useRef(null)
  const firstRef = useRef(null)
  const [overflow, setOverflow] = useState(false)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const first = firstRef.current
    if (!wrap || !first) return
    const natural = first.scrollWidth - (overflow ? 32 : 0)
    setOverflow(natural > wrap.clientWidth + 1)
  }, [text])

  const unit = { display: 'inline-block', paddingRight: overflow ? 32 : 0 }

  return (
    <div ref={wrapRef} style={{ maxWidth: 160, overflow: 'hidden', whiteSpace: 'nowrap' }}>
      <span
        className={overflow ? 'marquee-scroll' : ''}
        style={{ fontSize: 12, color, textShadow: shadow, display: 'inline-block' }}
      >
        <span ref={firstRef} style={unit}>{text}</span>
        {overflow && <span style={unit}>{text}</span>}
      </span>
    </div>
  )
}

export default function ChatWindow({ theme }) {
  const { messages, sendMessage, loadHistory, isLoading, regenerate, regenerateRound, deleteMsg, stopStreaming } = useChat()
  const { fetchPendingMessages, updateActiveTime } = useScheduledMessages()
  const {
    currentView, setCurrentView, apiKey, aiAvatar: globalAiAvatar, aiName: globalAiName,
    userAvatar: globalUserAvatar,
    deleteMessagesFrom, workerUrl, currentSessionId, sessions, providers, selectedProviderId,
  } = useStore()

  const currentSession = sessions?.find(s => s.id === currentSessionId)
  const effectiveAiName = currentSession?.aiName ?? globalAiName
  const effectiveAiAvatar = currentSession?.aiAvatar ?? globalAiAvatar
  const effectiveUserAvatar = currentSession?.userAvatar ?? globalUserAvatar
  const effectiveSignature = currentSession?.signature ?? '在线'

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const [menuMsg, setMenuMsg] = useState(null)
  const [memoryMsg, setMemoryMsg] = useState(null)
  const [toast, setToast] = useState(null)

  const selectedProvider = providers?.find(p => p.id === selectedProviderId)
  const effectiveApiKey = selectedProvider?.apiKey || apiKey

  const showToast = (msg = '✨ 已记住~') => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  useEffect(() => {
    loadHistory()
  }, [currentSessionId])

  useEffect(() => {
    const init = async () => {
      const hasNew = await fetchPendingMessages()
      if (hasNew) await loadHistory()
    }
    init()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content?.length])

  // Draft preservation: save on unmount/session-change, restore on mount/session-change
  useEffect(() => {
    const draft = draftsBySession[currentSessionId] || ''
    if (draft) setTimeout(() => inputRef.current?.fill(draft), 0)
    return () => {
      const text = inputRef.current?.getText() || ''
      if (text.trim()) draftsBySession[currentSessionId] = text
      else delete draftsBySession[currentSessionId]
    }
  }, [currentSessionId])

  const handleSendVoice = ({ transcript }) => {
    updateActiveTime()
    if (transcript) {
      sendMessage(transcript, 'text')
    } else {
      showToast('未能识别语音内容，请打字输入～')
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

  const primaryColor = theme?.primary || '#4aacf0'
  const primaryDarkColor = theme?.primaryDark || '#2196d3'

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 safe-top"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)',
          paddingBottom: 12,
          background: `linear-gradient(to bottom, ${primaryColor}1f, rgba(255,255,255,0.55))`,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: `1px solid ${primaryColor}22`,
          flexShrink: 0,
        }}>
        <div className="flex items-center gap-3 min-w-0">
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-xl"
              style={{
                background: `${primaryColor}33`,
                border: '2px solid rgba(180,130,255,0.65)',
                boxShadow: '0 0 10px rgba(180,130,255,0.6), 0 2px 10px rgba(180,130,255,0.35)',
              }}>
              {effectiveAiAvatar
                ? <img src={effectiveAiAvatar} alt="" className="w-full h-full object-cover" />
                : '🌸'}
            </div>
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm" style={{
              color: primaryColor,
              textShadow: `0 0 8px ${primaryColor}cc, 0 0 18px ${primaryColor}80`,
            }}>
              {effectiveAiName || '小漫'}
            </div>
            <Signature text={effectiveSignature || '在线'} color={primaryColor} shadow={`0 0 6px ${primaryColor}aa, 0 0 14px ${primaryColor}60`} />
          </div>
        </div>
        <button
          onClick={() => setCurrentView('sessionSettings')}
          className="btn-whale flex items-center justify-center flex-shrink-0"
          style={{
            width: 44, height: 44, borderRadius: '50%',
            background: `${primaryColor}12`,
            border: '1.5px solid transparent',
          }}
        >
          <img src="/assets/whale.png" alt="设置" style={{ width: 40, height: 40, objectFit: 'contain' }} />
        </button>
      </div>

      {/* Wave divider */}
      <div style={{ height: 8, overflow: 'hidden', marginTop: -1, flexShrink: 0 }}>
        <svg viewBox="0 0 400 8" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4 L400,8 L0,8 Z"
            fill={`${theme?.primary || '#ff85b3'}20`} />
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4"
            fill="none" stroke="#FFE4A1" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="text-5xl">🌸</div>
            <div className="font-medium" style={{ color: '#c47a8a' }}>你好，我是{effectiveAiName || '小漫'}！</div>
            <div className="text-sm max-w-[200px]" style={{ color: '#d4a0b0' }}>
              {effectiveApiKey ? '说点什么开始聊天吧～' : '请先在设置中配置 API Key'}
            </div>
            {!effectiveApiKey && (
              <button
                onClick={() => setCurrentView('globalSettings')}
                className="mt-2 px-6 py-2.5 rounded-full text-sm font-medium text-white transition-all duration-300"
                style={{ background: `linear-gradient(135deg, ${theme?.primary || '#4aacf0'}, ${theme?.primaryDark || '#2196d3'})`, boxShadow: `0 4px 16px ${theme?.primary || '#4aacf0'}66` }}
              >
                去配置 <img src="/assets/whale.png" alt="" style={{ width: 20, height: 20, objectFit: 'contain', verticalAlign: 'middle', display: 'inline-block' }} />
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
            onRegenerateRound={msg.id === lastAiId ? regenerateRound : null}
            isLoading={isLoading}
            userAvatar={effectiveUserAvatar}
            aiAvatar={effectiveAiAvatar}
            theme={theme}
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
                onClick={() => {
                  navigator.clipboard.writeText(menuMsg.content)
                  setMenuMsg(null)
                  showToast('已复制~')
                }}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                📋 复制
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

      {/* Unified input + nav — one shared glass panel, no seam */}
      <div
        className="safe-bottom flex-shrink-0"
        style={{
          background: `linear-gradient(to bottom, rgba(255,255,255,0.38), rgba(255,255,255,0.26))`,
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          borderTop: `1px solid ${primaryColor}18`,
        }}
      >
        <MessageInput
          ref={inputRef}
          onSend={(text) => {
            console.log('[PAW] onSend received, text:', JSON.stringify(text))
            updateActiveTime()
            sendMessage(text, 'text').catch(e => console.error('[PAW] sendMessage error:', e.message))
          }}
          onSendVoice={handleSendVoice}
          onSendImage={handleSendImage}
          disabled={isLoading}
          theme={theme}
          isLoading={isLoading}
          onStop={stopStreaming}
        />
        <BottomNav
          currentView={currentView}
          onChange={setCurrentView}
          theme={theme}
          bare
        />
      </div>

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
