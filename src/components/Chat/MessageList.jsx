import { memo, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

function messageTimestamp(message) {
  const direct = Number(message?.timestamp)
  if (Number.isFinite(direct) && direct > 0) return direct

  // Several optimistic/client ids already contain Date.now(). Recover that
  // value instead of treating a missing timestamp as epoch 0 (which is what
  // made a brand-new bubble jump to the very front after a history merge).
  const match = String(message?.id || '').match(/(?:^|\D)(1\d{12})(?:\D|$)/)
  if (match) {
    const embedded = Number(match[1])
    if (Number.isFinite(embedded) && embedded > 0) return embedded
  }

  // Unknown timestamps belong at the end, never at 1970/the front. The
  // source-order tie breaker below keeps multiple legacy items deterministic.
  return Number.MAX_SAFE_INTEGER
}

function messageRichness(message) {
  if (!message) return 0
  let score = 0
  score += typeof message.content === 'string' ? message.content.trim().length : 0
  score += typeof message.voiceText === 'string' ? message.voiceText.trim().length : 0
  score += typeof message.reasoning === 'string' ? message.reasoning.trim().length : 0
  if (message.type === 'image' && (message.imageUrl || message.imageData)) score += 1000
  if (message.type === 'file' && (message.filePath || message.fileName)) score += 1000
  if (message.type === 'voice' && (message.voiceBlobId || message.voiceText)) score += 1000
  if (message.error) score += 100
  if (message.acStatus) score += 100
  if (Array.isArray(message.toolUses) && message.toolUses.length) score += 100
  if (message.streaming || message.voiceLoading) score += 10
  return score
}

function isMeaningfulMessage(message) {
  if (!message) return false
  if (message.streaming || message.voiceLoading) return true
  if (message.error || message.acStatus) return true
  if (Array.isArray(message.toolUses) && message.toolUses.length) return true
  if (typeof message.reasoning === 'string' && message.reasoning.trim()) return true
  if (message.type === 'image') return !!(message.imageUrl || message.imageData)
  if (message.type === 'file') return !!(message.filePath || message.fileName || message.content)
  if (message.type === 'voice') return !!(message.voiceBlobId || message.voiceText || message.content)
  return typeof message.content === 'string' && message.content.trim().length > 0
}

function mergeDuplicateMessage(existing, incoming) {
  const richer = messageRichness(incoming) > messageRichness(existing) ? incoming : existing
  const aliases = new Set([
    ...(Array.isArray(existing?.wireIds) ? existing.wireIds : []),
    ...(Array.isArray(incoming?.wireIds) ? incoming.wireIds : []),
  ].filter(Boolean))
  if (incoming?.id && incoming.id !== existing?.id) aliases.add(incoming.id)

  const existingTs = messageTimestamp(existing)
  const incomingTs = messageTimestamp(incoming)
  const realTimestamp = Math.min(existingTs, incomingTs)

  return {
    ...existing,
    ...richer,
    // Keep the first rendered id stable. A live CC bubble commonly has a
    // local id while its reconnect-history twin uses a server wire id; key
    // replacement here would make the virtualizer recycle the wrong row.
    id: existing.id,
    ...(aliases.size ? { wireIds: [...aliases] } : {}),
    timestamp: realTimestamp === Number.MAX_SAFE_INTEGER
      ? (existing.timestamp ?? incoming.timestamp)
      : realTimestamp,
    __sourceIndex: Math.min(existing.__sourceIndex, incoming.__sourceIndex),
  }
}

function normalizeTimeline(rawMessages) {
  const canonical = []
  const aliasToIndex = new Map()

  for (let sourceIndex = 0; sourceIndex < rawMessages.length; sourceIndex++) {
    const message = rawMessages[sourceIndex]
    if (!message?.id) continue

    const aliases = [
      message.id,
      ...(Array.isArray(message.wireIds) ? message.wireIds : []),
    ].filter(Boolean)

    let targetIndex
    for (const alias of aliases) {
      const found = aliasToIndex.get(alias)
      if (found !== undefined) {
        targetIndex = found
        break
      }
    }

    if (targetIndex === undefined) {
      targetIndex = canonical.length
      canonical.push({ ...message, __sourceIndex: sourceIndex })
    } else {
      canonical[targetIndex] = mergeDuplicateMessage(canonical[targetIndex], { ...message, __sourceIndex: sourceIndex })
    }

    const merged = canonical[targetIndex]
    aliasToIndex.set(merged.id, targetIndex)
    for (const alias of aliases) aliasToIndex.set(alias, targetIndex)
    if (Array.isArray(merged.wireIds)) {
      for (const wireId of merged.wireIds) if (wireId) aliasToIndex.set(wireId, targetIndex)
    }
  }

  return canonical
    // A completed assistant row with no displayable payload is a transport /
    // persistence artefact, not a chat message. Keep real streaming and voice
    // loading placeholders because those intentionally render while pending.
    .filter(isMeaningfulMessage)
    .sort((a, b) => {
      const timeDiff = messageTimestamp(a) - messageTimestamp(b)
      if (timeDiff !== 0) return timeDiff
      return a.__sourceIndex - b.__sourceIndex
    })
    .map(({ __sourceIndex: _sourceIndex, ...message }) => message)
}

/**
 * Renders only the messages near the viewport (+ overscan buffer), not the
 * full history — this is the actual fix for long-conversation jank. The full
 * `messages` array is still held in memory/IndexedDB/store exactly as before
 * (see useChat.js/store) and is what's sent as model context; this component
 * only changes which of those messages become real DOM nodes.
 *
 * IMPORTANT: reconnect history and live delivery can race. Before feeding
 * anything into the virtualizer we canonicalize the raw array into one stable
 * timeline: id/wireId aliases are deduped, empty completed assistant artefacts
 * are removed, and missing timestamps can never sort to the front. This keeps
 * React keys and virtualizer indexes stable even while old history is being
 * recovered in the background.
 *
 * Wrapped in memo() so that state changes elsewhere in ChatWindow (settings
 * navigation, long-press menu, edit modal, toast, input text) never re-render
 * this subtree unless the props below actually change.
 */
const MessageList = forwardRef(function MessageList({
  messages, sessionId,
  onLongPress, lastAiId, onRegenerate, onRegenerateRound, onRetry,
  isLoading, userAvatar, aiAvatar, theme, bubbleSkin,
  selectionMode, selectedIds, onToggleSelect,
  emptyAiName, emptyHasApiKey, onEmptyConfigureClick,
}, ref) {
  const visibleMessages = useMemo(() => normalizeTimeline(messages), [messages])
  const effectiveLastAiId = useMemo(() => {
    if (lastAiId && visibleMessages.some(message => message.id === lastAiId)) return lastAiId
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i]?.role === 'assistant') return visibleMessages[i].id
    }
    return null
  }, [lastAiId, visibleMessages])

  const scrollRef = useRef(null)
  // Refs, not state — reading/writing them must never itself trigger a
  // re-render of this list on every scroll tick.
  const isNearBottomRef = useRef(true)
  const prevSessionIdRef = useRef(sessionId)
  const prevLastIdRef = useRef(null)
  const prevMessageCountRef = useRef(visibleMessages.length)
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
    count: visibleMessages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ITEM_HEIGHT,
    overscan: 10,
    getItemKey: (index) => visibleMessages[index]?.id ?? index,
  })

  // Lets the parent (search results, "jump to message") drive this list's
  // scroll position without reaching into virtualizer/DOM internals itself.
  useImperativeHandle(ref, () => ({
    scrollToIndex(index, opts) {
      if (index < 0 || index >= visibleMessages.length) return
      isNearBottomRef.current = index >= visibleMessages.length - 1
      virtualizer.scrollToIndex(index, { align: 'center', ...opts })
    },
  }), [visibleMessages.length, virtualizer])

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
      prevMessageCountRef.current = visibleMessages.length
      setNewBelowCount(0)
    }
    if (!hasScrolledInitiallyRef.current && visibleMessages.length > 0) {
      hasScrolledInitiallyRef.current = true
      isNearBottomRef.current = true
      virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, visibleMessages.length > 0])

  // Count only newly appended bubbles while the reader is away from the
  // bottom. Streaming growth inside the current bubble does not inflate it.
  useLayoutEffect(() => {
    if (prevSessionIdRef.current !== sessionId) return
    const added = visibleMessages.length - prevMessageCountRef.current
    if (added > 0 && !isNearBottomRef.current) {
      setNewBelowCount((count) => count + added)
    }
    prevMessageCountRef.current = visibleMessages.length
  }, [visibleMessages.length, sessionId])

  // New message arrives, or the in-progress (streaming) message's own
  // content/reasoning grows — auto-follow ONLY if the user was already at
  // the bottom. A user who scrolled up to read history must never be yanked
  // back down mid-stream.
  const lastMsg = visibleMessages[visibleMessages.length - 1]
  useLayoutEffect(() => {
    if (!visibleMessages.length) return
    const lastId = lastMsg?.id
    prevLastIdRef.current = lastId
    if (isNearBottomRef.current) {
      virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleMessages.length, lastMsg?.content?.length, lastMsg?.reasoning?.length, lastMsg?.streaming])

  if (visibleMessages.length === 0) {
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
            const msg = visibleMessages[vi.index]
            if (!msg) return null
            const isLastAi = msg.id === effectiveLastAiId
            const sameSenderAsPrev = visibleMessages[vi.index - 1]?.role === msg.role
            const sameSenderAsNext = visibleMessages[vi.index + 1]?.role === msg.role
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
                  onRetry={msg.error && vi.index === visibleMessages.length - 1 ? onRetry : null}
                  isLoading={isLoading}
                  userAvatar={userAvatar}
                  aiAvatar={aiAvatar}
                  theme={theme}
                  bubbleSkin={bubbleSkin}
                  sameSenderAsPrev={sameSenderAsPrev}
                  sameSenderAsNext={sameSenderAsNext}
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
            virtualizer.scrollToIndex(visibleMessages.length - 1, { align: 'end' })
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
