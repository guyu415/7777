import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Languages, X } from 'lucide-react'
import { formatReasoningSeconds, getReasoningDurationMs } from '../../utils/reasoningTiming'
import { useReasoningTranslation } from '../../hooks/useReasoningTranslation'

const CLOSE_DRAG_PX = 110
const EXPAND_DRAG_PX = -70

function TranslationSegment({ segment }) {
  const status = segment.status || 'open'
  const source = Array.from(segment.raw || '')
  const translated = Array.from(segment.translation || '')
  const animating = status === 'animating'
  const finished = status === 'done'
  const visibleCount = finished ? translated.length : animating ? Math.min(segment.revealedChars || 0, translated.length) : 0

  if (!animating && !finished) {
    return (
      <span className="reasoning-translation-grid" data-translation-status={status}>
        <span className="reasoning-translation-layer reasoning-translation-layer--original">{segment.raw}</span>
      </span>
    )
  }

  return (
    <span className="reasoning-translation-grid" data-translation-status={status}>
      <span className={`reasoning-translation-layer reasoning-translation-layer--original ${finished ? 'reasoning-translation-layer--hidden' : ''}`}>
        {source.map((char, index) => {
          const fading = animating && index < (segment.revealedChars || 0)
          return (
            <span
              key={`source-${index}`}
              className="reasoning-translation-original-char"
              style={fading ? { opacity: 0, filter: 'blur(3px)', transform: 'translateX(-3px)' } : undefined}
            >
              {char}
            </span>
          )
        })}
      </span>
      <span className={`reasoning-translation-layer reasoning-translation-layer--cn ${finished ? '' : 'reasoning-translation-layer--overlay'}`}>
        {translated.slice(0, visibleCount).map((char, index) => (
          <span key={`translated-${index}`} className="reasoning-translation-cn-char">{char}</span>
        ))}
      </span>
    </span>
  )
}

function ReasoningTranslationView({ snapshot, raw }) {
  if (!raw) return null
  if (snapshot.raw !== raw || !snapshot.segments.length) return <span>{raw}</span>
  return snapshot.segments.map((segment) => <TranslationSegment key={segment.id} segment={segment} />)
}

export default function ReasoningSheet({ message, open, onClose, translateThinking = false }) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [showOriginal, setShowOriginal] = useState(false)
  const dragRef = useRef(null)
  const rawReasoning = typeof message?.reasoning === 'string' ? message.reasoning : ''
  const translation = useReasoningTranslation(message, translateThinking)

  useEffect(() => setShowOriginal(false), [message?.id])

  useEffect(() => {
    if (!open) return
    setDragY(0)
    setDragging(false)
    setExpanded(false)
    setNow(Date.now())
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open || !message?.reasoningStreaming) return
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    const catchUp = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', catchUp)
    window.addEventListener('pageshow', catchUp)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', catchUp)
      window.removeEventListener('pageshow', catchUp)
    }
  }, [open, message?.reasoningStreaming])

  if (!open || typeof document === 'undefined') return null

  const duration = formatReasoningSeconds(getReasoningDurationMs(message, now))
  const beginDrag = (event) => {
    dragRef.current = { pointerId: event.pointerId, startY: event.clientY }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const moveDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    setDragY(event.clientY - dragRef.current.startY)
  }
  const finishDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    const delta = event.clientY - dragRef.current.startY
    dragRef.current = null
    setDragging(false)
    if (delta > CLOSE_DRAG_PX) {
      onClose()
      return
    }
    if (delta < EXPAND_DRAG_PX) setExpanded(true)
    else if (delta > 55 && expanded) setExpanded(false)
    setDragY(0)
  }

  return createPortal(
    <div className="reasoning-sheet-layer" role="presentation">
      <button className="reasoning-sheet-backdrop" aria-label="关闭思考过程" onClick={onClose} />
      <section
        className={`reasoning-sheet ${expanded ? 'reasoning-sheet--expanded' : ''} ${dragging ? 'reasoning-sheet--dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={`思考了 ${duration}`}
        style={dragY ? { transform: `translate3d(0, ${Math.max(-18, dragY)}px, 0)` } : undefined}
      >
        <div
          className="reasoning-sheet-drag-zone"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={() => { dragRef.current = null; setDragging(false); setDragY(0) }}
        >
          <span className="reasoning-sheet-handle" />
        </div>

        <header className="reasoning-sheet-header">
          <button className="reasoning-sheet-close" aria-label="关闭" onClick={onClose}>
            <X size={25} strokeWidth={1.6} />
          </button>
          <div>
            <div className="reasoning-sheet-title">
              {message.reasoningStreaming ? `正在思考 · ${duration}` : `思考了 ${duration}`}
            </div>
            <div className="reasoning-sheet-hint">上拉展开 · 下拉关闭</div>
          </div>
          {translateThinking ? (
            <button
              type="button"
              className="reasoning-sheet-original-toggle"
              aria-label={showOriginal ? '切换为中文译文' : '查看英文原文'}
              aria-pressed={showOriginal}
              data-reasoning-no-drag
              onClick={() => setShowOriginal((value) => !value)}
            >
              <Languages size={14} strokeWidth={1.7} aria-hidden="true" />
              <span>{showOriginal ? '译文' : '原文'}</span>
            </button>
          ) : <span className="reasoning-sheet-header-spacer" aria-hidden="true" />}
        </header>

        <div className="reasoning-sheet-content">
          {rawReasoning
            ? (showOriginal || !translateThinking
              ? rawReasoning
              : <ReasoningTranslationView snapshot={translation} raw={rawReasoning} />)
            : '思考内容正在生成…'}
          {message.reasoningStreaming && <span className="reasoning-sheet-caret" aria-hidden="true" />}
        </div>
      </section>
    </div>,
    document.body,
  )
}
