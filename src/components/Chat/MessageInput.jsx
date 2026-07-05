import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import { compressImage } from '../../utils/image'

function PhoneIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" ry="4"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
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

const MessageInput = forwardRef(function MessageInput({ onSend, onStartCall, onSendImage, disabled, theme, isLoading, onStop }, ref) {
  const [text, setText] = useState('')
  const fileRef = useRef(null)
  const textareaRef = useRef(null)
  const canSend = text.trim().length > 0  // always sendable when text exists

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
    getText() { return text },
  }), [text])

  const handleSend = () => {
    console.log('[PAW] handleSend: canSend=', canSend, 'textLen=', text.trim().length)
    if (!canSend) return
    onSend(text.trim())
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleImage = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    try {
      const { dataUrl, base64, mimeType } = await compressImage(file, { maxDim: 1280, quality: 0.8 })
      onSendImage({ imageData: base64, imageType: mimeType, imageUrl: dataUrl })
    } catch (err) {
      console.warn('[IMG] 压缩失败，回退原图:', err.message)
      const reader = new FileReader()
      reader.onload = () => onSendImage({ imageData: reader.result.split(',')[1], imageType: file.type, imageUrl: reader.result })
      reader.readAsDataURL(file)
    }
  }

  const primaryColor = theme?.primary || '#ff85b3'

  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 8,
        padding: '6px 12px 10px',
      }}>
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
        <button onClick={() => onStartCall?.()} title="语音通话" style={btnBase}>
          <PhoneIcon />
        </button>
      )}

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
      <button onClick={() => fileRef.current?.click()} style={btnBase}>
        <ImageIcon />
      </button>

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
      </div>
    </div>
  )
})

export default MessageInput
