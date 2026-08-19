import { memo, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronUp, ChevronDown } from 'lucide-react'
import MessageBubble from './MessageBubble'

// How close to the bottom (px) still counts as "at the bottom" for auto-follow
// purposes — generous enough to survive sub-pixel/rounding jitter, small
// enough that "scrolled up to read history" is never mistaken for "at bottom".
const BOTTOM_THRESHOLD_PX = 96
// Same idea for the top edge, used only to decide whether to show the
// "back to top" jump button — not tied to auto-follow at all.
const TOP_THRESHOLD_PX = 96

// A long conversation's messages vary wildly in real height (one-line text,
// multi-paragraph text, images, voice players, expanded thinking folds,
// letter/AC cards) — this is only the *initial guess* used before an item is
// actually measured; @tanstack/react-virtual corrects it via ResizeObserver
// the moment each item mounts, so total scroll height stays accurate.
const ESTIMATED_ITEM_HEIGHT = 88

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
  messages, sessionId,
  onLongPress, lastAiId, onRegenerate, onRegenerateRound, onRetry,
  isLoading, userAvatar, aiAvatar, theme,
  selectionMode, selectedIds, onToggleSelect,
  emptyAiName, emptyHasApiKey, onEmptyConfigureClick,
}, ref) {
  const scrollRef = useRef(null)
  // Refs, not state — reading/writing them must never itself trigger a
  // re-render of this list on every scroll tick.
  const isNearBottomRef = useRef(true)
  const prevSessionIdRef = useRef(sessionId)
  const prevLastIdRef = useRef(null)
  const prevMessageCountRef = useRef(messages.length)
  const hasScrolledInitiallyRef = useRef(false)
  // These two ARE state (unlike the ref above) because they drive the jump
  // buttons' visibility — but only ever setState on a threshold *crossing*,
  // never per scroll pixel, so they stay just as cheap in practice.
  const [nearTop, setNearTop] = useState(true)
  const [nearBottom, setNearBottom] = useState(true)
  const [newBelowCount, setNewBelowCount] = useState(0)
  // Which single jump arrow (if any) is currently shown. Driven by scroll
  // *direction*, not just edge-proximity, so only ever one of the two is
  // visible — and it auto-hides shortly after scrolling stops (see
  // idleTimerRef below) instead of sitting there while the reader is at rest.
  const [activeArrow, setActiveArrow] = useState(null) // null | 'up' | 'down'
  const prevScrollTopRef = useRef(0)
  const idleTimerRef = useRef(null)

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 10,
    getItemKey: (index) => messages[index]?.id ?? index,
  })

  // Lets the parent (search results, "jump to message") drive this list's
  // scroll position without reaching into virtualizer/DOM internals itself.
  useImperativeHandle(ref, () => ({
    scrollToIndex(index, opts) {
      if (index < 0 || index >= messages.length) return
      isNearBottomRef.current = index >= messages.length - 1
      virtualizer.scrollToIndex(index, { align: 'center', ...opts })
    },
  }), [messages.length, virtualizer])

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
      prevMessageCountRef.current = messages.length
      setNewBelowCount(0)
    }
    if (!hasScrolledInitiallyRef.current && messages.length > 0) {
      hasScrolledInitiallyRef.current = true
      isNearBottomRef.current = true
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, messages.length > 0])

  // Count only newly appended bubbles while the reader is away from the
  // bottom. Streaming growth inside the current bubble does not inflate it.
  useLayoutEffect(() => {
    if (prevSessionIdRef.current !== sessionId) return
    const added = messages.length - prevMessageCountRef.current
    if (added > 0 && !isNearBottomRef.current) {
      setNewBelowCount((count) => count + added)
    }
    prevMessageCountRef.current = messages.length
  }, [messages.length, sessionId])

  // New message arrives, or the in-progress (streaming) message's own
  // content/reasoning grows — auto-follow ONLY if the user was already at
  // the bottom. A user who scrolled up to read history must never be yanked
  // back down mid-stream.
  const lastMsg = messages[messages.length - 1]
  useLayoutEffect(() => {
    if (!messages.length) return
    const lastId = lastMsg?.id
    prevLastIdRef.current = lastId
    if (isNearBottomRef.current) {
      virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length, lastMsg?.content?.length, lastMsg?.reasoning?.length, lastMsg?.streaming])

  if (messages.length === 0) {
    return (
      <div className="absolute inset-0 overflow-y-auto px-3 py-4" style={{ zIndex: 1 }}>
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
        className="absolute inset-0 overflow-y-auto px-3 py-3"
        style={{ zIndex: 1 }}
      >
        <div style={{ position: 'relative', height: virtualizer.getTotalSize(), width: '100%' }}>
          {items.map((vi) => {
            const msg = messages[vi.index]
            if (!msg) return null
            const isLastAi = msg.id === lastAiId
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
                  onRetry={msg.error && vi.index === messages.length - 1 ? onRetry : null}
                  isLoading={isLoading}
                  userAvatar={userAvatar}
                  aiAvatar={aiAvatar}
                  theme={theme}
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
            virtualizer.scrollToIndex(messages.length - 1, { align: 'end' })
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
    </>
  )
})

MessageList.displayName = 'MessageList'

export default memo(MessageList)
