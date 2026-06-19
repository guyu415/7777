import { useState, useRef } from 'react'
import { CheckCheck } from 'lucide-react'
import VoicePlayer from '../Voice/VoicePlayer'
import ImageViewer from '../ImageViewer'
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

export default function MessageBubble({ message, onLongPress, onRegenerate, isLoading, userAvatar, aiAvatar, theme, onTTS, ttsPlayingId, ttsLoadingId }) {
  const [viewerSrc, setViewerSrc] = useState(null)
  const [pressed, setPressed] = useState(false)
  const isUser = message.role === 'user'
  const pressTimer = useRef(null)
  const pressAnimTimer = useRef(null)

  const handlePressStart = (e) => {
    // Jelly animation
    setPressed(true)
    clearTimeout(pressAnimTimer.current)
    pressAnimTimer.current = setTimeout(() => setPressed(false), 300)

    pressTimer.current = setTimeout(() => {
      onLongPress?.(message)
      navigator.vibrate?.(15)
    }, 500)
  }

  const handlePressEnd = () => clearTimeout(pressTimer.current)

  const pressProps = onLongPress ? {
    onMouseDown: handlePressStart,
    onMouseUp: handlePressEnd,
    onMouseLeave: handlePressEnd,
    onTouchStart: handlePressStart,
    onTouchEnd: handlePressEnd,
    onTouchMove: handlePressEnd,
    onContextMenu: (e) => { e.preventDefault(); onLongPress(message) },
  } : {}

  const avatarEl = (
    <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-lg flex-shrink-0 mb-1"
      style={{
        background: isUser ? `${theme?.primary}4d` : 'rgba(255,255,255,0.55)',
        boxShadow: isUser
          ? `0 2px 8px ${theme?.userBubbleShadow || 'rgba(255,133,179,0.2)'}, 0 0 12px ${theme?.primary || '#ff85b3'}40`
          : `0 2px 8px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}, 0 0 12px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}`,
        border: '1.5px solid rgba(255,182,209,0.4)'
      }}>
      {isUser
        ? (userAvatar ? <img src={userAvatar} alt="" className="w-full h-full object-cover" /> : '🐣')
        : (aiAvatar  ? <img src={aiAvatar}  alt="" className="w-full h-full object-cover" /> : '🌸')}
    </div>
  )

  const userBubbleStyle = {
    padding: '10px 16px',
    background: theme?.userBubble || 'rgba(255,133,179,0.32)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${theme?.userBubbleBorder || 'rgba(255,133,179,0.35)'}`,
    boxShadow: `0 4px 16px ${theme?.userBubbleShadow || 'rgba(255,133,179,0.18)'}, inset 0 1px 0 rgba(255,255,255,0.4)`,
    color: theme?.userBubbleText || '#fff',
  }

  const aiBubbleStyle = {
    padding: '10px 16px',
    background: theme?.aiBubble || 'rgba(200,235,210,0.6)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${theme?.aiBubbleBorder || 'rgba(160,220,180,0.4)'}`,
    boxShadow: `0 4px 16px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}, inset 0 1px 0 rgba(255,255,255,0.4)`,
    color: theme?.aiBubbleText || '#3d6b52',
  }

  return (
    <div className={clsx('flex items-end gap-2 mb-4 animate-fade-up', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {avatarEl}

      <div className={clsx('relative max-w-[72vw] flex flex-col', isUser ? 'items-end' : 'items-start')}>
        {message.type === 'text' && (
          <div
            className={clsx('relative rounded-[20px] text-sm leading-relaxed select-none cursor-default', pressed ? 'bubble-press' : '')}
            style={isUser ? userBubbleStyle : aiBubbleStyle}
            {...pressProps}
          >
            <span className={isUser ? 'bubble-user' : 'bubble-ai'} style={{ position:'absolute', inset:0, borderRadius:'inherit', pointerEvents:'none' }} />
            {/* Corner ornament */}
            <span style={{
              position: 'absolute',
              top: -4,
              [isUser ? 'right' : 'left']: -4,
              fontSize: 10,
              pointerEvents: 'none',
              zIndex: 1,
            }}>
              {isUser ? '🐾' : '🌿'}
            </span>
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
          <div {...pressProps}>
            <VoicePlayer blobId={message.voiceBlobId} url={message.voiceUrl} duration={message.duration} isUser={isUser} />
          </div>
        )}

        {message.type === 'image' && (
          <div
            className="cursor-pointer rounded-[20px] overflow-hidden max-w-[200px] select-none"
            style={{ boxShadow: `0 4px 16px ${theme?.userBubbleShadow || 'rgba(255,133,179,0.2)'}` }}
            onClick={() => setViewerSrc(message.imageUrl || `data:${message.imageType};base64,${message.imageData}`)}
            {...pressProps}
          >
            <img src={message.imageUrl || `data:${message.imageType};base64,${message.imageData}`} alt="" className="w-full object-cover" />
            {message.content && (
              <div className="px-3 py-2 text-sm" style={{ background: isUser ? `${theme?.userBubble || 'rgba(255,133,179,0.5)'}` : 'rgba(255,255,255,0.7)', color: isUser ? (theme?.userBubbleText || '#fff') : (theme?.aiBubbleText || '#3d6b52') }}>
                {message.content}
              </div>
            )}
          </div>
        )}

        {/* Action buttons — only for non-streaming AI text messages */}
        {!isUser && !message.streaming && message.type === 'text' && message.content && (
          <div className="flex items-center gap-1 mt-1">
            {onTTS && (
              <button
                onClick={() => onTTS(message.id, message.content)}
                title={ttsPlayingId === message.id ? '暂停' : '朗读'}
                style={{
                  background: 'none', border: 'none',
                  cursor: 'pointer',
                  fontSize: 14, padding: '2px 6px',
                  color: '#c47a8a',
                  opacity: 0.7,
                  transition: 'opacity 0.2s',
                  borderRadius: 8,
                }}
              >
                {ttsLoadingId === message.id ? '⌛' : ttsPlayingId === message.id ? '⏸️' : '🔊'}
              </button>
            )}
            {onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                disabled={isLoading}
                title="重新生成"
                style={{
                  background: 'none', border: 'none',
                  cursor: isLoading ? 'not-allowed' : 'pointer',
                  fontSize: 13, padding: '2px 6px',
                  color: isLoading ? 'rgba(196,122,138,0.35)' : '#c47a8a',
                  opacity: isLoading ? 0.4 : 0.7,
                  transition: 'opacity 0.2s',
                  borderRadius: 8,
                }}
              >
                🔄
              </button>
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
