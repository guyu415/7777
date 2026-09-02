import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { formatReasoningSeconds, getReasoningDurationMs } from '../../utils/reasoningTiming'

const CLOSE_DRAG_PX = 110
const EXPAND_DRAG_PX = -70

export default function ReasoningSheet({ message, open, onClose }) {
  const [dragY, setDragY] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [now, setNow] = useState(Date.now())
  const dragRef = useRef(null)

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
          <span className="reasoning-sheet-header-spacer" aria-hidden="true" />
        </header>

        <div className="reasoning-sheet-content">
          {message.reasoning || '思考内容正在生成…'}
          {message.reasoningStreaming && <span className="reasoning-sheet-caret" aria-hidden="true" />}
        </div>
      </section>
    </div>,
    document.body,
  )
}
