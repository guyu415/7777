import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'
import { X as CloseIcon } from 'lucide-react'
import { compressChatImage } from '../../utils/image'

function formatImageBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

function PhoneIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" ry="4"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

function GomokuIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <line x1="3" y1="9" x2="21" y2="9"/>
      <line x1="3" y1="15" x2="21" y2="15"/>
      <line x1="9" y1="3" x2="9" y2="21"/>
      <line x1="15" y1="3" x2="15" y2="21"/>
      <circle cx="9" cy="9" r="1.8" fill="currentColor" stroke="none"/>
      <circle cx="15" cy="15" r="1.8" fill="none"/>
    </svg>
  )
}

function FocusIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="13" r="8"/>
      <polyline points="12 9 12 13 15 15"/>
      <path d="M9 2h6"/>
    </svg>
  )
}

function SocialBrowserIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>
    </svg>
  )
}

function DivinationIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="3"/>
      <path d="m12 7 .8 2.2L15 10l-2.2.8L12 13l-.8-2.2L9 10l2.2-.8L12 7Z"/>
      <path d="M8 17h8"/>
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="1" y="1" width="12" height="12" rx="2.5" />
    </svg>
  )
}

const btnBase = {
  width: 52, height: 52,
  borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
  transition: 'all 0.25s ease-in-out',
  cursor: 'pointer',
  border: 'none',
  color: '#c47a8a',
  background: 'rgba(255,182,209,0.25)',
}

// flex: '1 0 72px' (grow:1, shrink:0, basis:72px) is what makes the row
// behave correctly at both ends: with few entries, grow=1 lets them stretch
// and evenly share the row's full width; once enough entries are added that
// even the 72px floor per item doesn't fit, shrink:0 refuses to compress
// them further — the row's total width then exceeds its container, and
// since the container itself scrolls (overflow-x:auto, see the menu wrapper
// below) that overflow becomes an internal horizontal scroll, never a
// viewport-level one.
function MenuItem({ icon, label, sub, onClick, disabled }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
        background: 'none', border: 'none', padding: '4px 6px',
        flex: '1 0 72px', minWidth: 72, maxWidth: 120,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(255,182,209,0.25)',
        color: '#c47a8a',
      }}>
        {icon}
      </div>
      <span style={{ fontSize: 11, color: '#8b5060', fontWeight: 500, whiteSpace: 'nowrap' }}>{label}</span>
      {sub && <span style={{ fontSize: 9, color: '#b98a96', whiteSpace: 'nowrap' }}>{sub}</span>}
    </button>
  )
}

// 草稿持久化——打了一半的文字随每次输入写进 localStorage（按会话分键），
// 切页面/切会话/刷新回来原样恢复，发送成功才清掉。之前的方案是模块级内存
// 对象 + ChatWindow 卸载时经 ref 抢救文字，但 React 在卸载时先解除 ref 再
// 跑 effect cleanup，恰好切走页面（整个 ChatWindow 卸载）时 getText() 已经
// 拿不到内容——所以换成这里的写穿（write-through）方案，不依赖卸载时机。
// 草稿现在是 {text, segments} 一起存的 JSON——segments 是回车分条后还没点
// 发送的排队消息。旧草稿是纯文本字符串，JSON.parse 失败就按旧格式读取，
// 这样升级后不会丢掉已有输入。
function readDraft(storageKey) {
  if (!storageKey) return { text: '', segments: [] }
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { text: '', segments: [] }
    try {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.segments)) {
        return { text: typeof parsed.text === 'string' ? parsed.text : '', segments: parsed.segments.filter(s => typeof s === 'string' && s.trim()) }
      }
    } catch { /* 旧版本把草稿直接存成纯文本 */ }
    return { text: raw, segments: [] }
  } catch { return { text: '', segments: [] } }
}

const MessageInput = forwardRef(function MessageInput({ onSend, onSendBatch, onStartCall, onSendImage, onOpenGomoku, gomokuEnabled, onOpenFocus, onOpenDivination, disabled, theme, isLoading, onStop, draftKey }, ref) {
  const draftStorageKey = draftKey ? `chat.draft.${draftKey}` : null
  const initialDraft = readDraft(draftStorageKey)
  const [text, setTextRaw] = useState(initialDraft.text)
  const [segments, setSegmentsRaw] = useState(initialDraft.segments)
  const textRef = useRef(initialDraft.text)
  const segmentsRef = useRef(initialDraft.segments)
  // useCallback'd on draftStorageKey so fill()'s useImperativeHandle closure
  // (below) always writes to whichever session is CURRENT when fill() is
  // actually invoked, not whichever session was active when the ref was
  // first attached.
  const writeDraft = useCallback((nextText, nextSegments) => {
    if (!draftStorageKey) return
    try {
      if (nextText.trim() || nextSegments.length) {
        localStorage.setItem(draftStorageKey, JSON.stringify({ text: nextText, segments: nextSegments }))
      } else {
        localStorage.removeItem(draftStorageKey)
      }
    } catch { /* 存储满/隐私模式——草稿只活在本次挂载内，不影响输入本身 */ }
  }, [draftStorageKey])
  const setText = useCallback((value) => {
    textRef.current = value
    setTextRaw(value)
    writeDraft(value, segmentsRef.current)
  }, [writeDraft])
  // 函数式 updater 先用 ref 算出 next 再更新 React state，避免同一个事件
  // 里先清空 segments、再清空 text 时，localStorage 还写着旧队列。
  const setSegments = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(segmentsRef.current) : updater
    segmentsRef.current = next
    setSegmentsRaw(next)
    writeDraft(textRef.current, next)
  }, [writeDraft])
  const [menuOpen, setMenuOpen] = useState(false)
  // A picked image sits here as a draft — thumbnail + cancel, still editable
  // alongside the text field — until Send is actually pressed. Shared by
  // every provider that reaches this component (Claude Code VPS, Codex VPS,
  // and plain API providers): picking an image must never fire a send by
  // itself. On Send, if a draft is present it goes out via onSendImage with
  // whatever text was typed as its caption (text-only when no draft, per
  // onSendImage's own contract) — never two separate sends for one attach.
  const [imageDraft, setImageDraft] = useState(null)
  const fileRef = useRef(null)
  const textareaRef = useRef(null)
  const menuRef = useRef(null)
  const plusBtnRef = useRef(null)
  const canSend = text.trim().length > 0 || segments.length > 0 || !!imageDraft

  useImperativeHandle(ref, () => ({
    fill(content) {
      setText(content)
      setTimeout(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        el.style.height = 'auto'
        el.style.height = Math.min(el.scrollHeight, 96) + 'px'
      }, 0)
    },
  }), [setText])

  // 会话切换（组件不卸载、只换 draftKey）时装入对应会话自己的草稿；恢复的
  // 草稿可能是多行的，下一拍把 textarea 高度撑到和内容一致。首次挂载时
  // useState 的初始化已经读过一遍，这里重复读到同样的值，无副作用。
  useEffect(() => {
    const restored = readDraft(draftStorageKey)
    textRef.current = restored.text
    segmentsRef.current = restored.segments
    setTextRaw(restored.text)
    setSegmentsRaw(restored.segments)
    const timer = setTimeout(() => {
      const el = textareaRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = Math.min(el.scrollHeight, 96) + 'px'
    }, 0)
    return () => clearTimeout(timer)
  }, [draftStorageKey])

  // 点击菜单外部收起
  useEffect(() => {
    if (!menuOpen) return
    const handleOutside = (e) => {
      if (menuRef.current?.contains(e.target)) return
      if (plusBtnRef.current?.contains(e.target)) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [menuOpen])

  const handleSend = () => {
    console.log('[PAW] handleSend: canSend=', canSend, 'textLen=', text.trim().length, 'segments=', segments.length, 'hasImageDraft=', !!imageDraft)
    if (!canSend) return
    const finalText = text.trim()
    if (imageDraft) {
      // Keep a staged image and all queued text in one turn.
      const imageCaption = [...segments, finalText].filter(Boolean).join('\n')
      onSendImage({ imageData: imageDraft.imageData, imageType: imageDraft.imageType, imageUrl: imageDraft.imageUrl, text: imageCaption })
      setImageDraft(null)
    } else {
      const batch = finalText ? [...segments, finalText] : segments
      if (batch.length > 1) onSendBatch?.(batch)
      else if (batch.length === 1) onSend(batch[0])
    }
    setSegments([])
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  // 回车＝分条排队（不真正发送），Shift+回车＝普通换行。isComposing 是关键：
  // 中文输入法用回车确认候选词时，不能被这里截成一条消息。
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent?.isComposing) return
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed) return
    setSegments(prev => [...prev, trimmed])
    setText('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  // Picking a file only ever stages a draft — never sends by itself. A
  // second pick before Send simply replaces the pending draft.
  const handleImage = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const { dataUrl, base64, mimeType, originalBytes, compressedBytes, compressed } = await compressChatImage(file)
      setImageDraft({ imageData: base64, imageType: mimeType, imageUrl: dataUrl, originalBytes, compressedBytes, compressed })
    } catch (err) {
      console.warn('[IMG] 压缩失败，回退原图:', err.message)
      const reader = new FileReader()
      reader.onload = () => setImageDraft({ imageData: reader.result.split(',')[1], imageType: file.type, imageUrl: reader.result, originalBytes: file.size, compressedBytes: file.size, compressed: false })
      reader.readAsDataURL(file)
    }
  }

  const handleMenuImage = () => {
    setMenuOpen(false)
    fileRef.current?.click()
  }

  const handleMenuCall = () => {
    setMenuOpen(false)
    onStartCall?.()
  }

  const handleMenuGomoku = () => {
    setMenuOpen(false)
    onOpenGomoku?.()
  }

  const handleMenuFocus = () => {
    setMenuOpen(false)
    onOpenFocus?.()
  }

  const handleMenuDivination = () => {
    setMenuOpen(false)
    onOpenDivination?.()
  }

  // 云社媒浏览器入口——第一版只是人工进入 https://browser.xiaoman.xyz 的
  // 通道（VPS 上常驻的真实 headed Chrome，见 ai-social-browser 部署），不
  // 重做一套浏览器画面，也不在这里绑定任何 AI/自动化操作。新标签页打开，
  // 不影响当前聊天页面状态。
  const handleMenuSocialBrowser = () => {
    setMenuOpen(false)
    window.open('https://browser.xiaoman.xyz', '_blank', 'noopener,noreferrer')
  }

  const primaryColor = theme?.primary || '#ff85b3'

  return (
    <div style={{ flexShrink: 0 }}>
      {imageDraft && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 12px 0',
        }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <img
              src={imageDraft.imageUrl}
              alt=""
              style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 12, border: `1px solid ${primaryColor}40` }}
            />
            <button
              onClick={() => setImageDraft(null)}
              title="移除图片"
              style={{
                position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%',
                background: 'rgba(0,0,0,0.55)', color: '#fff', border: 'none',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
              }}
            >
              <CloseIcon size={12} />
            </button>
          </div>
          <span style={{ fontSize: 12, color: '#8b5060' }}>
            {imageDraft.compressed
              ? `原图 ${formatImageBytes(imageDraft.originalBytes)} → 压缩后 ${formatImageBytes(imageDraft.compressedBytes)}`
              : '已选图片，可继续输入文字一起发送'}
          </span>
        </div>
      )}

      {/* 回车分条排队——每条都是点发送后会各自独立成一条消息的预览，点 ×
          可以单独撤回某一条，真正发出前还能反悔。 */}
      {segments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 12px 0' }}>
          {segments.map((seg, i) => (
            <div key={`${i}-${seg}`} style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              background: 'rgba(255,182,209,0.18)',
              border: `1px solid ${primaryColor}25`, borderRadius: 14, padding: '6px 10px',
            }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: '1.4', color: '#8b5060', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{seg}</span>
              <button
                onClick={() => setSegments(prev => prev.filter((_, idx) => idx !== i))}
                title="移除这一条"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#c47a8a', flexShrink: 0, display: 'flex', alignItems: 'center', padding: 2, marginTop: 1 }}
              >
                <CloseIcon size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        padding: '6px 12px 10px',
      }}>
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end',
          background: 'rgba(255,255,255,0.5)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          borderRadius: 20,
          padding: '8px 14px',
          minHeight: 40,
          maxHeight: 120,
          border: '1px solid rgba(255,182,209,0.3)',
          boxShadow: 'inset 0 1px 4px rgba(255,133,179,0.08)',
        }}>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="说点什么吧～"
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontSize: 18, lineHeight: '1.5',
              color: '#8b5060', resize: 'none', overflow: 'auto',
              maxHeight: 96, fontFamily: 'inherit',
            }}
            className="placeholder-[#e8b4c4]"
            onInput={e => {
              e.target.style.height = 'auto'
              e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px'
            }}
          />
        </div>

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />

        {/* "+"/"×" 始终在发送按钮左侧——切换只改变展开状态和图标（+ 旋转 45°
            即成 ×），绝不与发送按钮换位置。 */}
        <button
          ref={plusBtnRef}
          onClick={() => setMenuOpen(v => !v)}
          title="更多"
          style={{
            ...btnBase,
            transform: menuOpen ? 'rotate(45deg)' : 'rotate(0deg)',
            background: menuOpen ? `${primaryColor}30` : 'rgba(255,182,209,0.25)',
          }}
        >
          <PlusIcon />
        </button>

        {isLoading ? (
          <button
            onClick={onStop}
            title="停止回复"
            style={{
              ...btnBase,
              background: `linear-gradient(135deg, ${primaryColor}40, ${primaryColor}25)`,
              border: `1.5px solid ${primaryColor}60`,
              color: primaryColor,
              boxShadow: `0 2px 10px ${primaryColor}30`,
            }}
          >
            <StopIcon />
          </button>
        ) : (
          <button
            onClick={() => { console.log('[PAW] paw clicked'); handleSend() }}
            style={{
              width: 56, height: 56,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              boxShadow: 'none',
              padding: 0,
              cursor: canSend ? 'pointer' : 'default',
              opacity: canSend ? 1 : 0.35,
              transform: canSend ? 'scale(1)' : 'scale(0.88)',
              filter: canSend ? `drop-shadow(0 2px 8px ${primaryColor}99)` : 'none',
              transition: 'all 0.25s ease-in-out',
            }}
          >
            <img src="/assets/paw.png" alt="发送" style={{ width: 48, height: 48, objectFit: 'contain' }} />
          </button>
        )}
      </div>

      {/* "+" 功能栏 — 微信式：作为 composer 的正常文档流子元素渲染在输入框
          这一行的下方，从不使用 absolute/fixed 浮层。展开时靠 max-height
          从 0 过渡到内容高度，把整个底部输入区"撑高"，消息区随之被自然挤
          压变矮（ChatWindow.jsx 里包裹本组件的容器是 flex-shrink:0 的正常
          流子节点，见其自身注释），而不是盖在消息区上方。宽度严格
          100%+box-sizing:border-box，永不造成页面横向溢出；入口数量超出一
          行能放下的宽度时，只在这个横条内部 overflow-x 滚动（见 MenuItem
          自身注释），同样不会横向溢出 viewport。 */}
      <div
        style={{
          maxHeight: menuOpen ? 120 : 0,
          opacity: menuOpen ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.28s ease, opacity 0.2s ease',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          ref={menuRef}
          style={{
            display: 'flex',
            width: '100%',
            boxSizing: 'border-box',
            gap: 4,
            padding: '8px 10px calc(8px + env(safe-area-inset-bottom, 0px))',
            overflowX: 'auto',
            borderTop: `1px solid ${primaryColor}18`,
          }}
        >
          <MenuItem icon={<ImageIcon />} label="图片" onClick={handleMenuImage} />
          <MenuItem icon={<PhoneIcon />} label="语音通话" onClick={handleMenuCall} />
          {/* 对手是当前聊天里真实的 Claude Code 或 Codex（各自独立棋局），
              落子由各自的常驻 VPS 会话真实决定——普通 API 会话没有对应的
              落子通道，不可用。 */}
          <MenuItem
            icon={<GomokuIcon />}
            label="五子棋"
            sub={gomokuEnabled ? undefined : '仅VPS会话支持'}
            onClick={handleMenuGomoku}
            disabled={!gomokuEnabled}
          />
          <MenuItem icon={<FocusIcon />} label="专注" onClick={handleMenuFocus} />
          <MenuItem icon={<DivinationIcon />} label="抽签" onClick={handleMenuDivination} />
          <MenuItem icon={<SocialBrowserIcon />} label="社媒浏览器" onClick={handleMenuSocialBrowser} />
        </div>
      </div>
    </div>
  )
})

export default MessageInput
