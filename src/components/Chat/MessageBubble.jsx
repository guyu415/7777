import { useState, useRef } from 'react'
import { CheckCheck } from 'lucide-react'
import VoicePlayer from '../Voice/VoicePlayer'
import ImageViewer from '../ImageViewer'
import AcCard from './AcCard'
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

export default function MessageBubble({ message, onLongPress, onRegenerate, onRegenerateRound, isLoading, userAvatar, aiAvatar, theme }) {
  const [viewerSrc, setViewerSrc] = useState(null)
  const [pressed, setPressed] = useState(false)
  const [showVoiceText, setShowVoiceText] = useState(false)
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
        border: '3px solid rgba(255,182,209,0.5)',
      }}>
      {isUser
        ? (userAvatar ? <img src={userAvatar} alt="" className="w-full h-full object-cover" /> : '🐣')
        : (aiAvatar  ? <img src={aiAvatar}  alt="" className="w-full h-full object-cover" /> : '🌸')}
    </div>
  )

  const userBubbleStyle = {
    padding: '10px 16px',
    background: theme?.userBubble || 'rgba(255,133,179,0.88)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${theme?.userBubbleBorder || 'rgba(255,133,179,0.35)'}`,
    boxShadow: `0 4px 16px ${theme?.userBubbleShadow || 'rgba(255,133,179,0.18)'}, inset 0 1px 0 rgba(255,255,255,0.4)`,
    color: theme?.userBubbleText || '#F0C040',
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
        {message.type === 'text' && !message.voiceLoading && (
          <div
            className={clsx('relative rounded-[20px] leading-relaxed select-none cursor-default', pressed ? 'bubble-press' : '')}
            style={isUser ? userBubbleStyle : aiBubbleStyle}
            {...pressProps}
          >
            <span className={isUser ? '' : 'bubble-ai'} style={{ position:'absolute', inset:0, borderRadius:'inherit', pointerEvents:'none' }} />
            {/* AI bubble dog head — chin at bubble border, paws ~25px inside */}
            {!isUser && (
              <img
                src="/assets/dog-head.png"
                alt=""
                style={{
                  position: 'absolute',
                  top: -25,
                  left: -8,
                  width: 50, height: 50,
                  objectFit: 'contain',
                  pointerEvents: 'none',
                  zIndex: 5,
                  filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.12))',
                }}
              />
            )}
            {/* User bubble dog tail — rotated 30° toward lower-right, clear of avatar */}
            {isUser && (
              <img
                src="/assets/dog-tail.png"
                alt=""
                style={{
                  position: 'absolute',
                  bottom: -10,
                  right: -14,
                  width: 30, height: 30,
                  objectFit: 'contain',
                  pointerEvents: 'none',
                  zIndex: 5,
                  transform: 'rotate(30deg)',
                }}
              />
            )}
            {message.streaming && !message.content ? (
              <TypingIndicator />
            ) : (
              <span className="whitespace-pre-wrap break-words">{message.content}
                {onRegenerate && !message.streaming && (
                  <span className="inline-flex gap-1 ml-2" style={{ verticalAlign: 'middle' }}>
                    <button
                      onClick={e => { e.stopPropagation(); onRegenerate(message.id) }}
                      disabled={isLoading}
                      title="只重说这条"
                      style={{
                        fontSize: 11, padding: '1px 6px', borderRadius: 8, lineHeight: 1.6,
                        background: 'rgba(61,107,82,0.12)', border: '1px solid rgba(61,107,82,0.2)',
                        color: isLoading ? 'rgba(61,107,82,0.3)' : '#3d6b52',
                        cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      }}
                    >↻单</button>
                    {onRegenerateRound && (
                      <button
                        onClick={e => { e.stopPropagation(); onRegenerateRound() }}
                        disabled={isLoading}
                        title="重说整轮"
                        style={{
                          fontSize: 11, padding: '1px 6px', borderRadius: 8, lineHeight: 1.6,
                          background: 'rgba(61,107,82,0.12)', border: '1px solid rgba(61,107,82,0.2)',
                          color: isLoading ? 'rgba(61,107,82,0.3)' : '#3d6b52',
                          cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                        }}
                      >↻轮</button>
                    )}
                  </span>
                )}
              </span>
            )}
            {message.streaming && message.content && (
              <span className="inline-block w-0.5 h-4 animate-pulse-soft ml-0.5 align-middle"
                style={{ background: 'rgba(255,255,255,0.7)' }} />
            )}
          </div>
        )}

        {/* Voice loading indicator — shows while TTS is being fetched */}
        {message.voiceLoading && !isUser && (
          <div className="relative rounded-[20px]" style={{ ...aiBubbleStyle, padding: '10px 16px' }}>
            <span className="bubble-ai" style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', top: -4, left: -4, fontSize: 10, pointerEvents: 'none', zIndex: 1 }}>🌿</span>
            <div className="flex items-center gap-2">
              <div className="flex items-end gap-[3px]">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full typing-dot"
                    style={{ background: 'rgba(61,107,82,0.5)', animationDelay: `${i * 0.2}s` }} />
                ))}
              </div>
              <span className="text-xs" style={{ color: 'rgba(61,107,82,0.6)' }}>语音生成中…</span>
            </div>
          </div>
        )}

        {message.type === 'voice' && !isUser && (
          <div
            className={clsx('relative rounded-[20px] select-none cursor-default', pressed ? 'bubble-press' : '')}
            style={{ ...aiBubbleStyle, padding: '10px 14px' }}
            {...pressProps}
          >
            <span className="bubble-ai" style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none' }} />
            <span style={{ position: 'absolute', top: -4, left: -4, fontSize: 10, pointerEvents: 'none', zIndex: 1 }}>🌿</span>
            <VoicePlayer blobId={message.voiceBlobId} url={message.voiceUrl} duration={message.duration} isUser={false} naked />
            {onRegenerate && !message.streaming && (
              <div className="flex gap-1 mt-2">
                <button
                  onClick={e => { e.stopPropagation(); onRegenerate(message.id) }}
                  disabled={isLoading}
                  title="只重说这条"
                  style={{
                    fontSize: 11, padding: '1px 6px', borderRadius: 8, lineHeight: 1.6,
                    background: 'rgba(61,107,82,0.12)', border: '1px solid rgba(61,107,82,0.2)',
                    color: isLoading ? 'rgba(61,107,82,0.3)' : '#3d6b52',
                    cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                  }}
                >↻单</button>
                {onRegenerateRound && (
                  <button
                    onClick={e => { e.stopPropagation(); onRegenerateRound() }}
                    disabled={isLoading}
                    title="重说整轮"
                    style={{
                      fontSize: 11, padding: '1px 6px', borderRadius: 8, lineHeight: 1.6,
                      background: 'rgba(61,107,82,0.12)', border: '1px solid rgba(61,107,82,0.2)',
                      color: isLoading ? 'rgba(61,107,82,0.3)' : '#3d6b52',
                      cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    }}
                  >↻轮</button>
                )}
              </div>
            )}
            {message.voiceText && (
              <div className="mt-2 pt-2" style={{ borderTop: '1px solid rgba(160,220,180,0.3)' }}>
                <button
                  onClick={() => setShowVoiceText(v => !v)}
                  className="px-2.5 py-1 rounded-full"
                  style={{ fontSize: 14, color: '#3d6b52', border: '1px solid rgba(160,220,180,0.4)', background: 'rgba(255,255,255,0.3)' }}
                >
                  {showVoiceText ? '收起文字' : '查看文字'}
                </button>
                {showVoiceText && (
                  <div className="mt-1.5 leading-relaxed whitespace-pre-wrap" style={{ fontSize: 16, color: '#3d6b52' }}>
                    {message.voiceText}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {message.type === 'voice' && isUser && (
          <div {...pressProps}>
            <VoicePlayer blobId={message.voiceBlobId} url={message.voiceUrl} duration={message.duration} isUser={true} />
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
              <div className="px-3 py-2 text-sm" style={{ background: isUser ? `${theme?.userBubble || 'rgba(255,133,179,0.5)'}` : 'rgba(255,255,255,0.7)', color: isUser ? (theme?.userBubbleText || '#C78FCA') : (theme?.aiBubbleText || '#3d6b52') }}>
                {message.content}
              </div>
            )}
          </div>
        )}

        {/* AC status card */}
        {!isUser && message.acStatus && (
          <AcCard status={message.acStatus} />
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
