import { useMemo, useRef, useEffect, useState } from 'react'
import { X, Search } from 'lucide-react'

const MAX_RESULTS = 60
const SNIPPET_RADIUS = 28

function formatTime(ts) {
  if (!ts) return ''
  try {
    return new Date(ts).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return ''
  }
}

// Plain-text substring match against message.content — same field
// MessageBubble already renders as the message body, so "found in search"
// and "visible in the bubble" never disagree. Tool-only/streaming messages
// with no content string just never match, same as a real empty message.
function buildSnippet(content, query) {
  const lower = content.toLowerCase()
  const at = lower.indexOf(query.toLowerCase())
  if (at === -1) return content.slice(0, SNIPPET_RADIUS * 2)
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(content.length, at + query.length + SNIPPET_RADIUS)
  return (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : '')
}

function HighlightedSnippet({ text, query }) {
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  const parts = []
  let cursor = 0
  let at = lower.indexOf(q, cursor)
  while (at !== -1) {
    if (at > cursor) parts.push(text.slice(cursor, at))
    parts.push(<mark key={at} style={{ background: '#ffe08a', color: '#5e3d1f', borderRadius: 3, padding: '0 1px' }}>{text.slice(at, at + query.length)}</mark>)
    cursor = at + query.length
    at = lower.indexOf(q, cursor)
  }
  if (cursor < text.length) parts.push(text.slice(cursor))
  return <>{parts}</>
}

// Bottom-sheet search over the CURRENT session's already-loaded `messages`
// array — no server round trip, this is exactly the same array MessageList
// renders, just filtered client-side. Picking a result hands its index in
// that array back to the caller, which forwards it to MessageList's
// scrollToIndex (see ChatWindow.jsx) — this component never touches the
// scroll container itself.
export default function MessageSearch({ theme, messages, onSelect, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const inputRef = useRef(null)

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])

  // Local-only state — nothing outside this panel needs the query text.
  const [query, setQuery] = useState('')

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) return []
    const out = []
    for (let i = messages.length - 1; i >= 0 && out.length < MAX_RESULTS; i--) {
      const msg = messages[i]
      const content = typeof msg?.content === 'string' ? msg.content : ''
      if (!content || !content.toLowerCase().includes(q.toLowerCase())) continue
      out.push({ index: i, msg, snippet: buildSnippet(content, q) })
    }
    return out
  }, [query, messages])

  return (
    <div className="fixed inset-0" style={{ zIndex: 80 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl flex flex-col"
        style={{
          background: 'rgba(255,250,252,0.98)', backdropFilter: 'blur(20px)',
          padding: '16px 18px', paddingBottom: 'max(18px, env(safe-area-inset-bottom, 0px))',
          height: '78vh', boxShadow: '0 -8px 30px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.15)', margin: '0 auto 12px', flexShrink: 0 }} />
        <div className="flex items-center justify-between mb-3" style={{ flexShrink: 0 }}>
          <span className="font-semibold text-sm" style={{ color: primary }}>搜索这个对话</span>
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, borderRadius: '50%', background: `${primary}18`, border: 'none',
              color: primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex items-center gap-2" style={{
          flexShrink: 0, marginBottom: 10, padding: '9px 12px', borderRadius: 14,
          background: `${primary}0f`, border: `1px solid ${primary}30`,
        }}>
          <Search size={15} style={{ color: primary, flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索消息内容…"
            className="flex-1 bg-transparent outline-none text-sm"
            style={{ color: '#5e3d47' }}
          />
        </div>

        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
          {!query.trim() && (
            <div className="text-center text-sm" style={{ color: '#c79aab', paddingTop: 30 }}>
              输入关键词，搜索这个会话里说过的话
            </div>
          )}
          {query.trim() && results.length === 0 && (
            <div className="text-center text-sm" style={{ color: '#c79aab', paddingTop: 30 }}>
              没有找到匹配的消息
            </div>
          )}
          {results.map(({ index, msg, snippet }) => (
            <button
              key={msg.id ?? index}
              onClick={() => onSelect(index)}
              className="w-full text-left"
              style={{
                display: 'block', padding: '10px 12px', marginBottom: 8, borderRadius: 14,
                background: msg.role === 'user' ? `${primary}0f` : 'rgba(0,0,0,0.03)',
                border: `1px solid ${msg.role === 'user' ? primary + '25' : 'rgba(0,0,0,0.06)'}`,
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: 3 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: msg.role === 'user' ? primary : '#8b5060' }}>
                  {msg.role === 'user' ? '我' : 'AI'}
                </span>
                {msg.timestamp && <span style={{ fontSize: 9.5, color: '#c79aab' }}>{formatTime(msg.timestamp)}</span>}
              </div>
              <div style={{ fontSize: 12.5, color: '#5e3d47', lineHeight: 1.5, wordBreak: 'break-word' }}>
                <HighlightedSnippet text={snippet} query={query.trim()} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
