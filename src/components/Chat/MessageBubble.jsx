import { useState } from 'react'
import { CheckCheck } from 'lucide-react'
import VoicePlayer from '../Voice/VoicePlayer'
import ImageViewer from '../ImageViewer'
import { useStore } from '../../store'
import clsx from 'clsx'

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-3 py-2.5">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-2 h-2 rounded-full typing-dot"
          style={{ background: 'rgba(196, 122, 138, 0.6)', animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  )
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function MessageBubble({ message }) {
  const [viewerSrc, setViewerSrc] = useState(null)
  const { userAvatar, aiAvatar } = useStore()
  const isUser = message.role === 'user'

  const avatarEl = (
    <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-lg flex-shrink-0 mb-1"
      style={{
        background: isUser ? 'rgba(255,133,179,0.3)' : 'rgba(255,255,255,0.55)',
        boxShadow: '0 2px 8px rgba(255,133,179,0.2)',
        border: '1.5px solid rgba(255,182,209,0.4)'
      }}>
      {isUser
        ? (userAvatar ? <img src={userAvatar} alt="" className="w-full h-full object-cover" /> : '🐣')
        : (aiAvatar  ? <img src={aiAvatar}  alt="" className="w-full h-full object-cover" /> : '🌸')}
    </div>
  )

  return (
    <div className={clsx('flex items-end gap-2 mb-4 animate-fade-up', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {avatarEl}

      <div className={clsx('relative max-w-[72vw]', isUser ? 'items-end' : 'items-start')}>
        {message.type === 'text' && (
          <div className="relative rounded-[20px] text-sm leading-relaxed"
            style={isUser ? {
              padding: '10px 16px',
              background: 'rgba(255, 133, 179, 0.32)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 133, 179, 0.35)',
              boxShadow: '0 4px 16px rgba(255,133,179,0.18)',
              color: '#fff',
            } : {
              padding: '10px 16px',
              background: 'rgba(255, 255, 255, 0.62)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: '1px solid rgba(255, 182, 209, 0.3)',
              boxShadow: '0 4px 16px rgba(255,182,209,0.15)',
              color: '#8b5060',
            }}
          >
            {/* Bubble tail */}
            <span className={isUser ? 'bubble-user' : 'bubble-ai'} style={{ position:'absolute', inset:0, borderRadius:'inherit', pointerEvents:'none' }} />

            {message.streaming && !message.content ? (
              <TypingIndicator />
            ) : (
              <span className="whitespace-pre-wrap break-words">{message.content}</span>
            )}
            {message.streaming && message.content && (
              <span className="inline-block w-0.5 h-4 animate-pulse-soft ml-0.5 align-middle"
                style={{ background: 'rgba(255,255,255,0.7)' }} />
            )}
          </div>
        )}

        {message.type === 'voice' && (
          <VoicePlayer blobId={message.voiceBlobId} url={message.voiceUrl} duration={message.duration} isUser={isUser} />
        )}

        {message.type === 'image' && (
          <div className="cursor-pointer rounded-[20px] overflow-hidden max-w-[200px]"
            style={{ boxShadow: '0 4px 16px rgba(255,133,179,0.2)' }}
            onClick={() => setViewerSrc(message.imageUrl || `data:${message.imageType};base64,${message.imageData}`)}>
            <img src={message.imageUrl || `data:${message.imageType};base64,${message.imageData}`} alt="" className="w-full object-cover" />
            {message.content && (
              <div className="px-3 py-2 text-sm" style={{ background: isUser ? 'rgba(255,133,179,0.5)' : 'rgba(255,255,255,0.7)', color: isUser ? '#fff' : '#8b5060' }}>
                {message.content}
              </div>
            )}
          </div>
        )}

        {/* Timestamp */}
        <div className={clsx('flex items-center gap-1 mt-1 px-1', isUser ? 'flex-row-reverse' : 'flex-row')}>
          <span className="text-[10px]" style={{ color: '#d4a0b0' }}>{formatTime(message.timestamp)}</span>
          {isUser && !message.streaming && <CheckCheck size={12} style={{ color: '#ffb7d1' }} />}
        </div>
      </div>

      {viewerSrc && <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
    </div>
  )
}
