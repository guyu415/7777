import { useState, useRef, memo } from 'react'
import { CheckCheck } from 'lucide-react'
import VoicePlayer from '../Voice/VoicePlayer'
import ImageViewer from '../ImageViewer'
import AcCard from './AcCard'
import LetterCard from './LetterCard'
import clsx from 'clsx'

// Split content on letter markers — either {{LETTER_CARD:id}} (AI letters, phase 1)
// or raw [LETTER mood=.. weather=.. date=..]..[/LETTER] (user letters written from diary)
const LETTER_SPLIT = /(\{\{LETTER_CARD:[^}]+\}\}|\[LETTER\s+\S+?\s+\S+?\s+\S+?\][\s\S]*?\[\/LETTER\])/g
const LETTER_CARD_ONE = /^\{\{LETTER_CARD:([^}]+)\}\}$/
const RAW_LETTER_ONE = /^\[LETTER\s+mood=(\S+?)\s+weather=(\S+?)\s+date=(\S+?)\]([\s\S]*?)\[\/LETTER\]$/

function hasLetter(content) {
  return content.includes('{{LETTER_CARD:') || content.includes('[LETTER')
}

const ACTION_SPLIT_RE = /(<i>[\s\S]*?<\/i>)/g

function renderWithActions(text) {
  return text.split(ACTION_SPLIT_RE).map((seg, i) => {
    if (seg.startsWith('<i>') && seg.endsWith('</i>')) {
      return (
        <i key={i} style={{ fontSize: '0.92em', opacity: 0.7, fontStyle: 'italic', display: 'inline' }}>
          {seg.slice(3, -4)}
        </i>
      )
    }
    return seg || null
  })
}

function renderContentNodes(content) {
  return content.split(LETTER_SPLIT).map((seg, i) => {
    const ph = seg.match(LETTER_CARD_ONE)
    if (ph) return <LetterCard key={i} letterId={ph[1]} />
    const raw = seg.match(RAW_LETTER_ONE)
    if (raw) return <LetterCard key={i} letter={{ mood: raw[1], weather: raw[2], date: raw[3], content: raw[4].trim(), role: 'user' }} />
    return seg ? <span key={i}>{seg}</span> : null
  })
}

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

function MessageBubble({ message, onLongPress, onRegenerate, onRegenerateRound, isLoading, userAvatar, aiAvatar, theme }) {
  const [viewerSrc, setViewerSrc] = useState(null)
  const [pressed, setPressed] = useState(false)
  const [showVoiceText, setShowVoiceText] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
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
    <div className="flex-shrink-0 mb-1" style={{ position: 'relative', width: 80, height: 80 }}>
      {/* Avatar — explicit 40px, centered; frame is sibling at 100% of 80px so nothing overflows */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 40, height: 40,
        borderRadius: '50%', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.125rem',
        background: isUser ? `${theme?.primary}4d` : 'rgba(255,255,255,0.55)',
        boxShadow: isUser
          ? `0 2px 8px ${theme?.userBubbleShadow || 'rgba(255,133,179,0.2)'}, 0 0 12px ${theme?.primary || '#ff85b3'}40`
          : `0 2px 8px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}, 0 0 12px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}`,
      }}>
        {isUser
          ? (userAvatar ? <img src={userAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🐣')
          : (aiAvatar  ? <img src={aiAvatar}  alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸')}
      </div>
      {/* Frame — 100% of 80px container, no overflow, no clipping */}
      <img
        src="/assets/avatar-frame.png"
        alt=""
        style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: '115%', height: '115%',
          objectFit: 'contain', pointerEvents: 'none', zIndex: 2,
        }}
      />
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
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  }

  const aiBubbleStyle = {
    padding: '10px 16px',
    background: theme?.aiBubble || 'rgba(200,235,210,0.6)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    border: `1px solid ${theme?.aiBubbleBorder || 'rgba(160,220,180,0.4)'}`,
    boxShadow: `0 4px 16px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}, inset 0 1px 0 rgba(255,255,255,0.4)`,
    color: theme?.aiBubbleText || '#3d6b52',
    wordBreak: 'break-word',
    overflowWrap: 'anywhere',
  }

  return (
    <div className={clsx('flex items-end gap-2 mb-4 animate-fade-up', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {avatarEl}

      <div className={clsx('relative max-w-[72vw] flex flex-col', isUser ? 'items-end' : 'items-start')}>
        {/* Collapsible reasoning / thinking chain (AI only) */}
        {!isUser && (message.reasoning || message.reasoningStreaming) && (
          <div className="mb-1.5 w-full">
            <button
              onClick={() => setShowReasoning(v => !v)}
              disabled={!message.reasoning}
              className="flex items-center gap-1"
              style={{
                fontSize: 11,
                color: 'rgba(120,140,160,0.85)',
                background: 'rgba(255,255,255,0.35)',
                border: '1px solid rgba(160,180,200,0.3)',
                borderRadius: 10,
                padding: '3px 9px',
                cursor: message.reasoning ? 'pointer' : 'default',
                fontFamily: 'inherit',
              }}
            >
              {message.reasoningStreaming && !message.content ? (
                <span>💭 思考中…</span>
              ) : (
                <>
                  <span>💭 思考过程</span>
                  <span style={{ fontSize: 9, opacity: 0.7 }}>{showReasoning ? '▲' : '▼'}</span>
                </>
              )}
            </button>
            {showReasoning && message.reasoning && (
              <div
                className="mt-1 whitespace-pre-wrap break-words"
                style={{
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: 'rgba(110,130,150,0.9)',
                  background: 'rgba(245,248,251,0.7)',
                  border: '1px solid rgba(160,180,200,0.25)',
                  borderRadius: 12,
                  padding: '8px 11px',
                }}
              >
                {message.reasoningStreaming
                  ? message.reasoning.split('\n').slice(-4).join('\n')
                  : message.reasoning}
              </div>
            )}
          </div>
        )}
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
              <span className="whitespace-pre-wrap break-words">{hasLetter(message.content) ? renderContentNodes(message.content) : (isUser ? message.content : renderWithActions(message.content))}
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
            {message.edited && !message.streaming && (
              <span style={{ display: 'block', marginTop: 2, fontSize: 10, opacity: 0.5, textAlign: isUser ? 'right' : 'left' }}>已编辑</span>
            )}
            {message.voiceFailed && (
              <span style={{ display: 'block', marginTop: 4, fontSize: 11, opacity: 0.6 }}>🔇 语音生成失败</span>
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

export default memo(MessageBubble)
