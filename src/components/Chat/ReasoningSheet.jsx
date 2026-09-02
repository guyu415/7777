import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { formatReasoningSeconds, getReasoningDurationMs } from '../../utils/reasoningTiming'

const MIN_SHEET_HEIGHT = 230
const CLOSE_SHEET_HEIGHT = 165

function getViewportHeight() {
  return window.visualViewport?.height || window.innerHeight
}

function initialSheetHeight() {
  const viewportHeight = getViewportHeight()
  const minimum = Math.min(MIN_SHEET_HEIGHT, viewportHeight)
  return Math.min(viewportHeight, Math.max(minimum, Math.round(viewportHeight * 0.58)))
}

export default function ReasoningSheet({ message, open, onClose }) {
  const [sheetHeight, setSheetHeight] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [now, setNow] = useState(Date.now())
  const dragRef = useRef(null)
  const sheetHeightRef = useRef(0)
  const contentRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const startingHeight = initialSheetHeight()
    sheetHeightRef.current = startingHeight
    setSheetHeight(startingHeight)
    setDragging(false)
    setNow(Date.now())

    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    const fitToViewport = () => {
      const viewportHeight = getViewportHeight()
      const nextHeight = Math.min(sheetHeightRef.current || initialSheetHeight(), viewportHeight)
      sheetHeightRef.current = nextHeight
      setSheetHeight(nextHeight)
    }
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', fitToViewport)
    window.visualViewport?.addEventListener('resize', fitToViewport)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', fitToViewport)
      window.visualViewport?.removeEventListener('resize', fitToViewport)
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
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
  const title = duration
    ? (message.reasoningStreaming ? `正在思考 · ${duration}` : `思考了 ${duration}`)
    : (message.reasoningStreaming ? '正在思考' : '思考过程')
  const beginDrag = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    if (event.target.closest('[data-reasoning-no-drag]')) return
    const content = contentRef.current
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: sheetHeightRef.current || initialSheetHeight(),
      startScrollTop: content?.scrollTop || 0,
      startedInContent: !!content?.contains(event.target),
    }
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const moveDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    event.preventDefault()
    const delta = event.clientY - dragRef.current.startY
    const viewportHeight = getViewportHeight()
    let nextHeight
    if (dragRef.current.startedInContent && contentRef.current) {
      if (delta < 0) {
        // An upward swipe grows the glass first. Once it reaches the top,
        // the unused part of the same gesture scrolls its text.
        const desiredHeight = dragRef.current.startHeight - delta
        nextHeight = Math.min(viewportHeight, desiredHeight)
        const overflow = Math.max(0, desiredHeight - viewportHeight)
        contentRef.current.scrollTop = dragRef.current.startScrollTop + overflow
      } else {
        // A downward swipe reverses that order: reveal any earlier text,
        // then shrink the sheet only after its content reaches the top.
        const scrollConsumed = Math.min(delta, dragRef.current.startScrollTop)
        contentRef.current.scrollTop = dragRef.current.startScrollTop - scrollConsumed
        nextHeight = dragRef.current.startHeight - (delta - scrollConsumed)
      }
    } else {
      nextHeight = dragRef.current.startHeight - delta
    }
    nextHeight = Math.max(0, Math.min(viewportHeight, nextHeight))
    sheetHeightRef.current = nextHeight
    setSheetHeight(nextHeight)
  }
  const finishDrag = (event) => {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (sheetHeightRef.current < CLOSE_SHEET_HEIGHT) {
      onClose()
      return
    }
    const nextHeight = Math.max(
      Math.min(MIN_SHEET_HEIGHT, getViewportHeight()),
      Math.min(sheetHeightRef.current, getViewportHeight()),
    )
    sheetHeightRef.current = nextHeight
    setSheetHeight(nextHeight)
  }
  const cancelDrag = () => {
    dragRef.current = null
    setDragging(false)
    const nextHeight = Math.max(
      Math.min(MIN_SHEET_HEIGHT, getViewportHeight()),
      Math.min(sheetHeightRef.current || initialSheetHeight(), getViewportHeight()),
    )
    sheetHeightRef.current = nextHeight
    setSheetHeight(nextHeight)
  }
  const reachesTop = sheetHeight != null && sheetHeight >= getViewportHeight() - 2

  return createPortal(
    <div className="reasoning-sheet-layer" role="presentation">
      <button className="reasoning-sheet-backdrop" aria-label="关闭思考过程" onClick={onClose} />
      <section
        className={`reasoning-sheet ${reachesTop ? 'reasoning-sheet--at-top' : ''} ${dragging ? 'reasoning-sheet--dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={sheetHeight == null ? undefined : { height: `${sheetHeight}px` }}
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
      >
        <div className="reasoning-sheet-drag-surface">
          <div className="reasoning-sheet-drag-zone">
            <span className="reasoning-sheet-handle" />
          </div>

          <header className="reasoning-sheet-header">
            <button
              className="reasoning-sheet-close"
              aria-label="关闭"
              data-reasoning-no-drag
              onClick={onClose}
            >
              <X size={25} strokeWidth={1.6} />
            </button>
            <div>
              <div className="reasoning-sheet-title">
                {title}
              </div>
              <div className="reasoning-sheet-hint">上下自由拖动 · 可拉至顶部</div>
            </div>
            <span className="reasoning-sheet-header-spacer" aria-hidden="true" />
          </header>
        </div>

        <div ref={contentRef} className="reasoning-sheet-content">
          {message.reasoning || '思考内容正在生成…'}
          {message.reasoningStreaming && <span className="reasoning-sheet-caret" aria-hidden="true" />}
        </div>
      </section>
    </div>,
    document.body,
  )
}
