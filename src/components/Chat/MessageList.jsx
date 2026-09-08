import { memo, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronUp, ChevronDown } from 'lucide-react'
import MessageBubble from './MessageBubble'
import PendingReplyIndicator from './PendingReplyIndicator'
import ReasoningSheet from './ReasoningSheet'
import { messageListItemCount, shouldShowPendingReply } from './messageListModel'
import { buildPokeTimeline, canEditPokeText, editablePokeParts, formatPokeNotice } from '../../utils/poke'

// How close to the bottom (px) still counts as "at the bottom" for auto-follow
// purposes — generous enough to survive sub-pixel/rounding jitter, small
// enough that "scrolled up to read history" is never mistaken for "at bottom".
const BOTTOM_THRESHOLD_PX = 96
// Same idea for the top edge, used only to decide whether to show the
// "back to top" jump button — not tied to auto-follow at all.
const TOP_THRESHOLD_PX = 96

// A long conversation's messages vary wildly in real height (one-line text,
// multi-paragraph text, images, voice players, reasoning triggers,
// letter/AC cards) — this is only the *initial guess* used before an item is
// actually measured; @tanstack/react-virtual corrects it via ResizeObserver
// the moment each item mounts, so total scroll height stays accurate.
const ESTIMATED_ITEM_HEIGHT = 88

function timelineTime(value) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function PokeTimelineRow({ poke, aiName, onEdit }) {
  const editable = canEditPokeText(poke) && typeof onEdit === 'function'
  const parts = editablePokeParts(poke)
  const [editing, setEditing] = useState(false)
  const [draftBefore, setDraftBefore] = useState(parts.before)
  const [draftAfter, setDraftAfter] = useState(parts.after)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const beforeInputRef = useRef(null)

  useEffect(() => {
    if (!editing) {
      const next = editablePokeParts(poke)
      setDraftBefore(next.before)
      setDraftAfter(next.after)
    }
  }, [editing, poke?.before, poke?.after, poke?.suffix])

  useEffect(() => {
    if (editing) beforeInputRef.current?.focus()
  }, [editing])

  const save = async () => {
    const before = draftBefore.trim()
    const after = draftAfter.trim()
    if (!before || !after || saving) return
    setSaving(true)
    setError('')
    try {
      await onEdit(poke.id, before, after)
      setEditing(false)
    } catch (err) {
      setError(err?.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const resetDraft = () => {
    const next = editablePokeParts(poke)
    setDraftBefore(next.before)
    setDraftAfter(next.after)
    setEditing(false)
    setError('')
  }

  const inputStyle = {
    border: 0, borderBottom: '1px solid rgba(74,130,175,.55)', borderRadius: 0,
    outline: 'none', padding: '0 2px', background: 'transparent', color: 'rgba(45,70,95,.95)',
    font: 'inherit', lineHeight: 'inherit', textAlign: 'center',
  }

  return (
    <div className="flex justify-center px-4 py-2" aria-label={formatPokeNotice(poke, aiName)}>
      <div style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap',
        maxWidth: '92%', minHeight: 28, padding: '4px 13px', borderRadius: 999,
        background: 'rgba(255,255,255,.5)', color: 'rgba(55,75,95,.88)',
        border: '1px solid rgba(255,255,255,.42)', boxShadow: '0 2px 10px rgba(50,80,110,.08)',
        fontSize: 12, lineHeight: 1.45, textAlign: 'center', backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}>
        {editing ? (
          <>
            <span>{poke?.aiName || aiName || 'CC'}</span>
            <input
              ref={beforeInputRef}
              value={draftBefore}
              maxLength={20}
              disabled={saving}
              aria-label="编辑了字前面的文案"
              onChange={(event) => setDraftBefore(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void save() }
                if (event.key === 'Escape') resetDraft()
              }}
              style={{
                ...inputStyle, width: Math.max(28, Math.min(110, (draftBefore.length + 1) * 13)), marginLeft: 3,
              }}
            />
            <span style={{ margin: '0 3px' }}>了</span>
            <input
              value={draftAfter}
              maxLength={40}
              disabled={saving}
              aria-label="编辑了字后面的文案"
              onChange={(event) => setDraftAfter(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.preventDefault(); void save() }
                if (event.key === 'Escape') resetDraft()
              }}
              style={{
                ...inputStyle, width: Math.max(58, Math.min(190, (draftAfter.length + 1) * 13)),
              }}
            />
            <button type="button" onClick={() => void save()} disabled={saving || !draftBefore.trim() || !draftAfter.trim()} style={{ marginLeft: 7, padding: 0, border: 0, background: 'transparent', color: '#348bc4', font: 'inherit', cursor: 'pointer', opacity: saving || !draftBefore.trim() || !draftAfter.trim() ? .5 : 1 }}>
              {saving ? '保存中' : '保存'}
            </button>
            <button type="button" onClick={resetDraft} disabled={saving} style={{ marginLeft: 7, padding: 0, border: 0, background: 'transparent', color: 'rgba(70,90,110,.62)', font: 'inherit', cursor: 'pointer' }}>
              取消
            </button>
          </>
        ) : (
          <>
            <span>{formatPokeNotice(poke, aiName)}</span>
            {editable && (
              <button type="button" onClick={() => { setEditing(true); setError('') }} style={{ marginLeft: 7, padding: 0, border: 0, background: 'transparent', color: '#348bc4', font: 'inherit', cursor: 'pointer' }}>
                编辑
              </button>
            )}
          </>
        )}
        {error && <span role="alert" style={{ width: '100%', marginTop: 2, color: '#d85f6a', fontSize: 10 }}>{error}</span>}
      </div>
    </div>
  )
}
/**
 * Renders only the messages near the viewport (+ overscan buffer), not the
 * full history — this is the actual fix for long-conversation jank. The full
 * `messages` array is still held in memory/IndexedDB/store exactly as before
 * (see useChat.js/store) and is what's sent as model context; this component
 * only changes which of those messages become real DOM nodes.
 *
 * Wrapped in memo() so that state changes elsewhere in ChatWindow (settings
 * navigation, long-press menu, edit modal, toast, input text) never re-render
 * this subtree unless the props below actually change.
 */
const MessageList = forwardRef(function MessageList({
  messages: sourceMessages, sessionId,
  onLongPress, lastAiId, onRegenerate, onRegenerateRound, onRetry,
  isLoading, userAvatar, aiAvatar, theme, bubbleSkin,
  pendingReplyVariant,
  translateThinking = false,
  onAvatarDoubleClick,
  pokeEvents = [], onEditPoke,
  selectionMode, selectedIds, onToggleSelect,
  emptyAiName, emptyHasApiKey, onEmptyConfigureClick,
}, ref) {
  const messages = sourceMessages
  const timeline = useMemo(() => buildPokeTimeline(messages, pokeEvents, timelineTime), [messages, pokeEvents])
  // Pending is presentation state, not a fabricated chat message. It gets a
  // virtual row so scrolling still works, but never passes through
  // MessageBubble and therefore has no id/timestamp/menu/delete semantics.
  const showPendingReply = shouldShowPendingReply(messages, isLoading)
  const itemCount = messageListItemCount(timeline, showPendingReply)
  const scrollRef = useRef(null)
  // Refs, not state — reading/writing them must never itself trigger a
  // re-render of this list on every scroll tick.
  const isNearBottomRef = useRef(true)
  const prevSessionIdRef = useRef(sessionId)
  const prevLastIdRef = useRef(null)
  const prevMessageCountRef = useRef(timeline.length)
  const hasScrolledInitiallyRef = useRef(false)
  // These two ARE state (unlike the ref above) because they drive the jump
  // buttons' visibility — but only ever setState on a threshold *crossing*,
  // never per scroll pixel, so they stay just as cheap in practice.
  const [nearTop, setNearTop] = useState(true)
  const [nearBottom, setNearBottom] = useState(true)
  const [newBelowCount, setNewBelowCount] = useState(0)
  // The sheet must not live inside a virtualized bubble: that row may be
  // unmounted when a streaming reply is split/re-measured, which previously
  // destroyed the open translation panel and made its text "jump away".
  const [reasoningTarget, setReasoningTarget] = useState(null)
  const openReasoning = useCallback((message) => setReasoningTarget({ id: message.id, fallback: message }), [])
  const closeReasoning = useCallback(() => setReasoningTarget(null), [])
  // Which single jump arrow (if any) is currently shown. Driven by scroll
  // *direction*, not just edge-proximity, so only ever one of the two is
  // visible — and it auto-hides shortly after scrolling stops (see
  // idleTimerRef below) instead of sitting there while the reader is at rest.
  const [activeArrow, setActiveArrow] = useState(null) // null | 'up' | 'down'
  const prevScrollTopRef = useRef(0)
  const idleTimerRef = useRef(null)

  const virtualizer = useVirtualizer({
    count: itemCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => timeline[index]?.type === 'poke' ? 42 : ESTIMATED_ITEM_HEIGHT,
    overscan: 10,
    getItemKey: (index) => index === timeline.length && showPendingReply
      ? 'pending-reply-indicator'
      : (timeline[index]?.id ?? index),
  })

  // Lets the parent (search results, "jump to message") drive this list's
  // scroll position without reaching into virtualizer/DOM internals itself.
  useImperativeHandle(ref, () => ({
    scrollToIndex(index, opts) {
      if (index < 0 || index >= messages.length) return
      isNearBottomRef.current = index >= messages.length - 1
      const messageId = messages[index]?.id
      const timelineIndex = timeline.findIndex((row) => row.type === 'message' && row.message.id === messageId)
      if (timelineIndex >= 0) virtualizer.scrollToIndex(timelineIndex, { align: 'center', ...opts })
    },
  }), [messages, timeline, virtualizer])

  // Cheap, O(1) bottom-proximity check — reads three numbers off the scroll
  // container, never touches the messages array or any DOM node inside it.
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight
    const atBottom = distance < BOTTOM_THRESHOLD_PX
    isNearBottomRef.current = atBottom
    setNearBottom((prev) => (prev === atBottom ? prev : atBottom))
    if (atBottom) setNewBelowCount(0)
    const atTop = el.scrollTop < TOP_THRESHOLD_PX
    setNearTop((prev) => (prev === atTop ? prev : atTop))

    // Direction: scrolling toward the bottom (scrollTop rising) means the
    // reader is moving away from the top, so offer the "back to top" arrow;
    // scrolling toward the top means they're moving away from the bottom, so
    // offer "back to bottom" instead. Whichever edge they're already at
    // suppresses its own arrow (nothing to jump to).
    const prevTop = prevScrollTopRef.current
    prevScrollTopRef.current = el.scrollTop
    const delta = el.scrollTop - prevTop
    if (delta > 0 && !atTop) setActiveArrow('up')
    else if (delta < 0 && !atBottom) setActiveArrow('down')
    else if ((delta > 0 && atTop) || (delta < 0 && atBottom)) setActiveArrow(null)

    clearTimeout(idleTimerRef.current)
    idleTimerRef.current = setTimeout(() => setActiveArrow(null), 900)
  }, [])

  useEffect(() => () => clearTimeout(idleTimerRef.current), [])

  // Session switch (or first mount): land exactly on the last message with
  // no visible top-to-bottom scroll animation. useLayoutEffect so this runs
  // before paint.
  useLayoutEffect(() => {
    const switched = prevSessionIdRef.current !== sessionId
    if (switched) {
      prevSessionIdRef.current = sessionId
      hasScrolledInitiallyRef.current = false
      prevMessageCountRef.current = timeline.length
      setNewBelowCount(0)
    }
    if (!hasScrolledInitiallyRef.current && itemCount > 0) {
      hasScrolledInitiallyRef.current = true
      isNearBottomRef.current = true
      virtualizer.scrollToIndex(itemCount - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, itemCount > 0])

  // Count only newly appended bubbles while the reader is away from the
  // bottom. Streaming growth inside the current bubble does not inflate it.
  useLayoutEffect(() => {
    if (prevSessionIdRef.current !== sessionId) return
    const added = timeline.length - prevMessageCountRef.current
    if (added > 0 && !isNearBottomRef.current) {
      setNewBelowCount((count) => count + added)
    }
    prevMessageCountRef.current = timeline.length
  }, [timeline.length, sessionId])

  // New message arrives, or the in-progress (streaming) message's own
  // content/reasoning grows — auto-follow ONLY if the user was already at
  // the bottom. A user who scrolled up to read history must never be yanked
  // back down mid-stream.
  const lastRow = timeline[timeline.length - 1]
  const lastMsg = lastRow?.message
  useLayoutEffect(() => {
    if (!itemCount) return
    const lastId = lastMsg?.id
    prevLastIdRef.current = lastId
    if (isNearBottomRef.current) {
      virtualizer.scrollToIndex(itemCount - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemCount, lastMsg?.content?.length, lastMsg?.reasoning?.length, lastMsg?.streaming, lastRow?.poke?.suffix])

  if (timeline.length === 0 && !showPendingReply) {
    return (
      <div className="absolute inset-0 overflow-y-auto px-2 py-4" style={{ zIndex: 1 }}>
        <div className="flex flex-col items-center justify-center h-full text-center gap-3">
          <div className="text-5xl">🌸</div>
          <div className="font-medium" style={{ color: '#c47a8a' }}>{emptyAiName ? `你好，我是${emptyAiName}！` : '你好！'}</div>
          <div className="text-sm max-w-[200px]" style={{ color: '#d4a0b0' }}>
            {emptyHasApiKey ? '说点什么开始聊天吧～' : '请先在设置中配置 API Key'}
          </div>
          {!emptyHasApiKey && (
            <button
              onClick={onEmptyConfigureClick}
              className="mt-2 px-6 py-2.5 rounded-full text-sm font-medium text-white transition-all duration-300"
              style={{ background: `linear-gradient(135deg, ${theme?.primary || '#4aacf0'}, ${theme?.primaryDark || '#2196d3'})`, boxShadow: `0 4px 16px ${theme?.primary || '#4aacf0'}66` }}
            >
              去配置 <img src="/assets/whale.png" alt="" style={{ width: 20, height: 20, objectFit: 'contain', verticalAlign: 'middle', display: 'inline-block' }} />
            </button>
          )}
        </div>
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()
  const primaryColor = theme?.primary || '#4aacf0'
  const reasoningMessage = reasoningTarget
    ? messages.find(message => message.id === reasoningTarget.id) || reasoningTarget.fallback
    : null
  const jumpButtonStyle = {
    position: 'absolute', left: 12, zIndex: 5,
    width: 34, height: 34, borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    border: 'none', background: 'transparent',
    color: '#fff',
    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.4))',
    transition: 'opacity .2s ease',
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-2 py-3"
        style={{ zIndex: 1 }}
      >
        <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
          {items.map((vi) => {
            if (showPendingReply && vi.index === timeline.length) {
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                >
                  <PendingReplyIndicator aiAvatar={aiAvatar} theme={theme} variant={pendingReplyVariant} />
                </div>
              )
            }
            const row = timeline[vi.index]
            if (!row) return null
            if (row.type === 'poke') {
              return (
                <div
                  key={vi.key}
                  data-index={vi.index}
                  ref={virtualizer.measureElement}
                  style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
                >
                  <PokeTimelineRow poke={row.poke} aiName={emptyAiName} onEdit={onEditPoke} />
                </div>
              )
            }
            const msg = row.message
            const isLastAi = msg.id === lastAiId
            const prevMessage = timeline[vi.index - 1]?.message
            const nextMessage = timeline[vi.index + 1]?.message
            const sameSenderAsPrev = prevMessage?.role === msg.role
            const sameSenderAsNext = nextMessage?.role === msg.role
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)`, borderRadius: 18, background: selectedIds?.has(msg.id) ? `${primaryColor}13` : 'transparent' }}
                onClickCapture={selectionMode ? (event) => { event.preventDefault(); event.stopPropagation(); onToggleSelect?.(msg.id) } : undefined}
              >
                {selectionMode && (
                  <button
                    type="button"
                    aria-label={selectedIds?.has(msg.id) ? '取消选择消息' : '选择消息'}
                    style={{ position: 'absolute', left: 4, top: '50%', transform: 'translateY(-50%)', zIndex: 8, width: 24, height: 24, borderRadius: '50%', display: 'grid', placeItems: 'center', border: `2px solid ${selectedIds?.has(msg.id) ? primaryColor : `${primaryColor}80`}`, background: selectedIds?.has(msg.id) ? primaryColor : 'rgba(255,255,255,.9)', color: 'white', pointerEvents: 'none' }}
                  >
                    {selectedIds?.has(msg.id) && <span style={{ fontSize: 14, lineHeight: 1 }}>✓</span>}
                  </button>
                )}
                <div style={{ width: '100%', minWidth: 0, paddingLeft: selectionMode ? 28 : 0, transition: 'padding .15s ease', boxSizing: 'border-box' }}>
                <MessageBubble
                  message={msg}
                  onLongPress={selectionMode ? null : onLongPress}
                  onRegenerate={isLastAi ? onRegenerate : null}
                  onRegenerateRound={isLastAi ? onRegenerateRound : null}
                  onRetry={msg.error && msg.id === messages[messages.length - 1]?.id ? onRetry : null}
                  isLoading={isLoading}
                  userAvatar={userAvatar}
                  aiAvatar={aiAvatar}
                  theme={theme}
                  bubbleSkin={bubbleSkin}
                  pendingReplyVariant={pendingReplyVariant}
                  sameSenderAsPrev={sameSenderAsPrev}
                  sameSenderAsNext={sameSenderAsNext}
                  onOpenReasoning={openReasoning}
                  reasoningOpen={reasoningTarget?.id === msg.id}
                  onAvatarDoubleClick={!selectionMode && msg.role === 'assistant' ? onAvatarDoubleClick : null}
                />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {/* Jump buttons live outside the scroll container (as its absolute
          siblings, positioned relative to ChatWindow's own `relative` message
          area) so they stay fixed on screen instead of scrolling away with
          the content. Driven by scroll direction (see handleScroll): at most
          one is ever shown, and it auto-hides ~900ms after scrolling stops —
          nothing renders while the reader is at rest or the list isn't
          scrollable at all. */}
      {activeArrow === 'up' && (
        <button
          onClick={() => { virtualizer.scrollToIndex(0, { align: 'start' }) }}
          title="回到顶部"
          aria-label="回到顶部"
          style={{ ...jumpButtonStyle, top: 12 }}
        >
          <ChevronUp size={18} />
        </button>
      )}
      {activeArrow === 'down' && (
        <button
          onClick={() => {
            isNearBottomRef.current = true
            setNewBelowCount(0)
            virtualizer.scrollToIndex(timeline.length - 1, { align: 'end' })
          }}
          title="回到底部"
          aria-label="回到底部"
          style={{ ...jumpButtonStyle, bottom: 12 }}
        >
          <ChevronDown size={18} />
          {newBelowCount > 0 && (
            <span style={{
              position: 'absolute', top: -7, right: -7,
              minWidth: 18, height: 18, padding: '0 4px', borderRadius: 9,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: primaryColor, color: '#fff', fontSize: 10, fontWeight: 700,
              border: '2px solid rgba(255,255,255,0.95)', boxSizing: 'border-box',
            }}>
              {newBelowCount > 99 ? '99+' : newBelowCount}
            </span>
          )}
        </button>
      )}
      <ReasoningSheet
        message={reasoningMessage}
        open={!!reasoningMessage}
        onClose={closeReasoning}
        translateThinking={translateThinking}
      />
    </>
  )
})

MessageList.displayName = 'MessageList'

export default memo(MessageList)
