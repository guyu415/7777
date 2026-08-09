import { memo, forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
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
  onLongPress, lastAiId, onRegenerate, onRegenerateRound,
  isLoading, userAvatar, aiAvatar, theme,
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
  }, [])

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
    border: `1px solid ${primaryColor}30`,
    background: 'rgba(255,255,255,0.85)',
    backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
    boxShadow: '0 2px 10px rgba(0,0,0,0.12)',
    color: primaryColor,
  }

  return (
    <>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="absolute inset-0 overflow-y-auto px-3 py-4"
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
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }}
              >
                <MessageBubble
                  message={msg}
                  onLongPress={onLongPress}
                  onRegenerate={isLastAi ? onRegenerate : null}
                  onRegenerateRound={isLastAi ? onRegenerateRound : null}
                  isLoading={isLoading}
                  userAvatar={userAvatar}
                  aiAvatar={aiAvatar}
                  theme={theme}
                />
              </div>
            )
          })}
        </div>
      </div>
      {/* Jump buttons live outside the scroll container (as its absolute
          siblings, positioned relative to ChatWindow's own `relative` message
          area) so they stay fixed on screen instead of scrolling away with
          the content. Each only shows once you've actually scrolled away
          from that edge — never both hidden, never both shown at once. */}
      {!nearTop && (
        <button
          onClick={() => { virtualizer.scrollToIndex(0, { align: 'start' }) }}
          title="回到顶部"
          aria-label="回到顶部"
          style={{ ...jumpButtonStyle, top: 12 }}
        >
          <ChevronUp size={18} />
        </button>
      )}
      {!nearBottom && (
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
