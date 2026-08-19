import { useState, useRef, useEffect, memo } from 'react'
import { CheckCheck, FileText } from 'lucide-react'
import VoicePlayer from '../Voice/VoicePlayer'
import ImageViewer from '../ImageViewer'
import AcCard from './AcCard'
import LetterCard from './LetterCard'
import clsx from 'clsx'
import { parseReplyQuotes } from '../../utils/replyQuotes'

// Split content on letter markers — either {{LETTER_CARD:id}} (AI letters, phase 1)
// or raw [LETTER mood=.. weather=.. date=..]..[/LETTER] (user letters written from diary)
const LETTER_SPLIT = /(\{\{LETTER_CARD:[^}]+\}\}|\[LETTER\s+\S+?\s+\S+?\s+\S+?\][\s\S]*?\[\/LETTER\])/g
const LETTER_CARD_ONE = /^\{\{LETTER_CARD:([^}]+)\}\}$/
const RAW_LETTER_ONE = /^\[LETTER\s+mood=(\S+?)\s+weather=(\S+?)\s+date=(\S+?)\]([\s\S]*?)\[\/LETTER\]$/
const DICE_ONE = /^\[DICE:([1-6])\]$/
const DICE_FACES = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

function hasLetter(content) {
  return content.includes('{{LETTER_CARD:') || content.includes('[LETTER')
}

// Tool activity display. The server sends the raw tool name on purpose and
// leaves the wording here, so changing how an action reads is a frontend
// deploy rather than a restart of the resident session on the VPS.
const TOOL_LABELS = {
  Read: '读取', Write: '写入', Edit: '编辑', NotebookEdit: '编辑',
  Bash: '执行', BashOutput: '查看输出', KillShell: '结束进程',
  Grep: '搜索', Glob: '查找文件', WebFetch: '访问网页', WebSearch: '联网搜索',
  Task: '调度子任务', Agent: '调度子任务', Skill: '调用技能',
  TodoWrite: '整理任务', ExitPlanMode: '结束规划',
}
const TOOL_ICONS = {
  Read: '📖', Write: '✍️', Edit: '✏️', NotebookEdit: '✏️',
  Bash: '⚡', BashOutput: '📃', KillShell: '🛑',
  Grep: '🔍', Glob: '🗂️', WebFetch: '🌐', WebSearch: '🌐',
  Task: '🧩', Agent: '🧩', Skill: '🎯',
  TodoWrite: '📝', ExitPlanMode: '📋',
}
// Unknown tools (new built-ins, any MCP tool) still show up — with the raw
// name rather than being silently dropped, since an unexplained gap in the
// activity list is worse than an unpolished label.
function toolLabel(tool) { return TOOL_LABELS[tool] || tool }
function toolIcon(tool) { return TOOL_ICONS[tool] || '🔧' }

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

function formatFileBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

function MessageBubble({ message, onLongPress, onRegenerate, onRegenerateRound, onRetry, isLoading, userAvatar, aiAvatar, theme }) {
  const [viewerSrc, setViewerSrc] = useState(null)
  const [pressed, setPressed] = useState(false)
  const [showVoiceText, setShowVoiceText] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const isUser = message.role === 'user'
  const diceValue = message.type === 'text' ? Number(message.content?.match(DICE_ONE)?.[1] || 0) : 0
  const [displayDiceValue, setDisplayDiceValue] = useState(() => diceValue || 1)
  const [diceRolling, setDiceRolling] = useState(false)
  const [diceJustSettled, setDiceJustSettled] = useState(false)
  const replyQuote = message.type === 'text' ? parseReplyQuotes(message.content) : null
  const pressTimer = useRef(null)
  const pressAnimTimer = useRef(null)
  // CC creates an empty assistant bubble as soon as it starts thinking, then
  // fills that same bubble after the tool result arrives. Its timestamp can
  // therefore be several seconds old even though the dice itself is brand
  // new. Track the 0 -> dice transition as another authoritative "new roll"
  // signal; a history bubble mounts with dice already present and stays still.
  const hadDiceRef = useRef(diceValue > 0)

  useEffect(() => {
    if (!diceValue) {
      hadDiceRef.current = false
      return
    }
    const arrivedInExistingBubble = !hadDiceRef.current
    hadDiceRef.current = true
    const age = Date.now() - Number(message.timestamp || 0)
    // Only a newly-arrived throw gets suspense. Old history stays settled
    // when opening/reloading the conversation instead of replaying en masse.
    if (!arrivedInExistingBubble && (age < -10_000 || age > 5_000)) {
      setDisplayDiceValue(diceValue)
      setDiceRolling(false)
      setDiceJustSettled(false)
      return
    }
    setDiceRolling(true)
    setDiceJustSettled(false)
    setDisplayDiceValue(diceValue === 1 ? 6 : diceValue - 1)
    const ticker = setInterval(() => {
      setDisplayDiceValue((value) => (value % 6) + 1)
    }, 95)
    const settle = setTimeout(() => {
      clearInterval(ticker)
      setDisplayDiceValue(diceValue)
      setDiceRolling(false)
      setDiceJustSettled(true)
      navigator.vibrate?.(22)
    }, 1_150)
    return () => {
      clearInterval(ticker)
      clearTimeout(settle)
    }
  }, [diceValue, message.id, message.timestamp])

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

  // Container/inner-circle bumped ~13% back up from the previous density
  // pass (66/33 -> 75/37) per feedback that avatars had gotten too small —
  // same ratio preserved so the frame keeps sitting exactly on the circle's
  // edge; the message-bubble width calc below is adjusted to match (see
  // `calc(100% - 83px)`).
  const avatarEl = (
    <div className="flex-shrink-0 mb-1" style={{ position: 'relative', width: 75, height: 75 }}>
      {/* Avatar — explicit 37px, centered; frame is sibling at 100% of 75px so nothing overflows */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 37, height: 37,
        borderRadius: '50%', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.05rem',
        background: isUser ? `${theme?.primary}4d` : 'rgba(255,255,255,0.55)',
        boxShadow: isUser
          ? `0 2px 8px ${theme?.userBubbleShadow || 'rgba(255,133,179,0.2)'}, 0 0 12px ${theme?.primary || '#ff85b3'}40`
          : `0 2px 8px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}, 0 0 12px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}`,
      }}>
        {isUser
          ? (userAvatar ? <img src={userAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🐣')
          : (aiAvatar  ? <img src={aiAvatar}  alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸')}
      </div>
      {/* Frame — 100% of 75px container, no overflow, no clipping */}
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
    padding: '7px 18px',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
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
    padding: '7px 18px',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
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
    <div className={clsx('flex w-full min-w-0 items-end gap-2 mb-2 animate-fade-up', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {avatarEl}

      <div
        className={clsx('relative min-w-0 flex flex-col', isUser ? 'items-end' : 'items-start')}
        style={{ width: 'calc(100% - 83px)', maxWidth: '72vw' }}
      >
        {/* What CC actually did this turn — VPS only, sits above the thinking
            fold because it happened before the reply it belongs to. Deliberately
            plain text rather than another collapsible: the whole point is being
            visible without a tap, and a turn rarely has more than a few. */}
        {!isUser && message.toolUses?.length > 0 && (
          <div
            className="mb-1.5 w-full flex flex-col gap-0.5"
            style={{ fontSize: 11, color: 'rgba(120,140,160,0.8)', lineHeight: 1.5 }}
          >
            {message.toolUses.map((t, i) => (
              <div key={i} className="flex items-center gap-1 min-w-0">
                <span style={{ flexShrink: 0 }}>{toolIcon(t.tool)}</span>
                <span style={{ flexShrink: 0 }}>{toolLabel(t.tool)}</span>
                {t.detail && (
                  <span
                    className="truncate"
                    style={{ opacity: 0.75, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10 }}
                  >
                    {t.detail}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
        {/* Collapsible reasoning / thinking chain (AI only) — a small pill
            tag sitting right on top of the bubble, not a block that claims
            its own row height; collapsed it's just the button's own size. */}
        {!isUser && (message.reasoning || message.reasoningStreaming) && (
          // Sits above the bubble's dog-head decoration (zIndex 5, which
          // pokes up ~25px above the bubble's own top edge) so the tag
          // never gets visually swallowed by it now that the gap is tight.
          <div className="mb-1 w-full" style={{ position: 'relative', zIndex: 6 }}>
            <button
              onClick={() => setShowReasoning(v => !v)}
              disabled={!message.reasoning}
              className="flex items-center gap-1"
              style={{
                fontSize: 10.5,
                lineHeight: 1.4,
                color: 'rgba(120,140,160,0.85)',
                background: 'rgba(255,255,255,0.35)',
                border: '1px solid rgba(160,180,200,0.3)',
                borderRadius: 999,
                padding: '2px 8px',
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
        {diceValue > 0 && !message.voiceLoading && (
          <div
            className={clsx('relative rounded-[20px] select-none cursor-default', pressed ? 'bubble-press' : '')}
            style={{
              ...(isUser ? userBubbleStyle : aiBubbleStyle),
              padding: 8,
              width: 76,
              height: 76,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label={diceRolling ? '骰子滚动中' : `掷出了 ${diceValue} 点`}
            title={diceRolling ? '滚动中…' : `${diceValue} 点`}
            {...pressProps}
          >
            <span className={isUser ? '' : 'bubble-ai'} style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', pointerEvents: 'none' }} />
            <span
              className={diceRolling ? 'chat-dice-rolling' : diceJustSettled ? 'chat-dice-settled' : ''}
              style={{ position: 'relative', zIndex: 1, fontSize: 55, lineHeight: 1, color: isUser ? (theme?.userBubbleText || '#fff') : (theme?.aiBubbleText || '#3d6b52'), filter: 'drop-shadow(0 2px 2px rgba(0,0,0,.08))' }}
            >
              {DICE_FACES[displayDiceValue]}
            </span>
          </div>
        )}
        {message.type === 'text' && !diceValue && !message.voiceLoading && (
          <div
            className={clsx('relative rounded-[20px] leading-relaxed select-none cursor-default', pressed ? 'bubble-press' : '')}
            style={{
              ...(isUser ? userBubbleStyle : aiBubbleStyle),
              // A one-word bubble still reads as part of a full conversation
              // flow rather than a stray dot near the avatar; long messages
              // are unaffected since their intrinsic content width already
              // exceeds this floor.
              minWidth: '40%',
            }}
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
              <span className="whitespace-pre-wrap break-words" style={{ display: 'block', minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}>
                {replyQuote && (
                  <span style={{
                    display: 'block', marginBottom: 7, padding: '5px 8px',
                    borderLeft: '3px solid currentColor', borderRadius: '3px 8px 8px 3px',
                    background: 'rgba(255,255,255,0.18)', fontSize: 12, opacity: 0.8,
                    minWidth: 0, maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box',
                  }}>
                    {replyQuote.quotes.map((quote, index) => (
                      <span key={`${quote.label}-${index}`} style={{ display: 'block', minWidth: 0, maxWidth: '100%', overflow: 'hidden', marginTop: index ? 4 : 0 }}>
                        <span style={{ display: 'block', fontSize: 10, fontWeight: 600, marginBottom: 1 }}>回复 {quote.label}</span>
                        <span style={{ display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quote.preview}</span>
                      </span>
                    ))}
                  </span>
                )}
                {hasLetter(replyQuote?.body ?? message.content) ? renderContentNodes(replyQuote?.body ?? message.content) : (isUser ? (replyQuote?.body ?? message.content) : renderWithActions(replyQuote?.body ?? message.content))}
                {message.error && onRetry && !message.streaming && (
                  <button
                    onClick={e => { e.stopPropagation(); onRetry(message.id) }}
                    disabled={isLoading}
                    style={{
                      display: 'block', marginTop: 8, padding: '4px 12px', borderRadius: 12,
                      background: 'rgba(224,112,112,0.12)', border: '1px solid rgba(224,112,112,0.3)',
                      color: isLoading ? 'rgba(224,112,112,0.35)' : '#c45f5f',
                      cursor: isLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontSize: 12,
                    }}
                  >↻ 重试</button>
                )}
                {onRegenerate && !message.error && !message.streaming && (
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
          <div className="relative rounded-[20px]" style={{ ...aiBubbleStyle, padding: '7px 16px' }}>
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
            {message.voiceText && (
              <p className="mt-2 leading-relaxed whitespace-pre-wrap" style={{ fontSize: 14, color: '#3d6b52' }}>{message.voiceText}</p>
            )}
          </div>
        )}

        {message.type === 'voice' && !isUser && (
          <div
            className={clsx('relative rounded-[20px] select-none cursor-default', pressed ? 'bubble-press' : '')}
            style={{ ...aiBubbleStyle, padding: '7px 14px' }}
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

        {message.type === 'file' && (
          <div
            className="rounded-[18px] max-w-[260px] select-none"
            style={{
              padding: '10px 12px',
              background: isUser ? `${theme?.userBubble || 'rgba(255,133,179,0.5)'}` : 'rgba(255,255,255,0.7)',
              color: isUser ? (theme?.userBubbleText || '#C78FCA') : (theme?.aiBubbleText || '#3d6b52'),
              boxShadow: `0 4px 16px ${theme?.userBubbleShadow || 'rgba(255,133,179,0.2)'}`,
            }}
            {...pressProps}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>
                <FileText size={21} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message.fileName || '文件'}</div>
                <div style={{ fontSize: 11, opacity: 0.72, marginTop: 2 }}>
                  {typeof message.fileSize === 'number' ? formatFileBytes(message.fileSize) : '已发送文件'}
                </div>
              </div>
            </div>
            {message.content && <div className="mt-2 pt-2 text-sm whitespace-pre-wrap" style={{ borderTop: '1px solid rgba(255,255,255,0.28)' }}>{message.content}</div>}
          </div>
        )}

        {/* AC status card */}
        {!isUser && message.acStatus && (
          <AcCard status={message.acStatus} />
        )}

        {/* Timestamp */}
        <div className={clsx('flex items-center gap-1 mt-0.5 px-1', isUser ? 'flex-row-reverse' : 'flex-row')}>
          <span className="text-[10px]" style={{ color: '#d4a0b0' }}>{formatTime(message.timestamp)}</span>
          {isUser && !message.streaming && <CheckCheck size={12} style={{ color: '#ffb7d1' }} />}
        </div>
      </div>

      {viewerSrc && <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
    </div>
  )
}

export default memo(MessageBubble)
