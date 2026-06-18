import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import VoiceRecorder from '../Voice/VoiceRecorder'

function MicIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="4" ry="4"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <polyline points="21 15 16 10 5 21"/>
    </svg>
  )
}

const btnBase = {
  width: 36, height: 36,
  borderRadius: '50%',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  flexShrink: 0,
  transition: 'all 0.25s ease-in-out',
  cursor: 'pointer',
  border: 'none',
  color: '#c47a8a',
  background: 'rgba(255,182,209,0.25)',
}

const MessageInput = forwardRef(function MessageInput({ onSend, onSendVoice, onSendImage, disabled }, ref) {
  const [text, setText] = useState('')
  const [showVoice, setShowVoice] = useState(false)
  const fileRef = useRef(null)
  const textareaRef = useRef(null)
  const canSend = text.trim() && !disabled

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
    }
  }), [])

  const handleSend = () => {
    if (!canSend) return
    onSend(text.trim())
    setText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onSendImage({ imageData: reader.result.split(',')[1], imageType: file.type, imageUrl: reader.result })
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  if (showVoice) {
    return (
      <VoiceRecorder
        onSend={(voice) => { onSendVoice(voice); setShowVoice(false) }}
        onCancel={() => setShowVoice(false)}
      />
    )
  }

  return (
    <div className="safe-bottom" style={{
      display: 'flex', alignItems: 'flex-end', gap: 8,
      padding: '10px 12px',
      background: 'rgba(255,255,255,0.45)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderTop: '1px solid rgba(255,182,209,0.2)',
      boxShadow: '0 -4px 20px rgba(255,133,179,0.08)',
    }}>
      <button onClick={() => setShowVoice(true)} style={btnBase}>
        <MicIcon />
      </button>

      <div style={{
        flex: 1, display: 'flex', alignItems: 'flex-end',
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
          onKeyDown={handleKey}
          placeholder="说点什么吧～"
          rows={1}
          disabled={disabled}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            fontSize: 14, lineHeight: '1.5',
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
        onClick={handleSend}
        disabled={!canSend}
        style={{
          ...btnBase,
          background: canSend
            ? 'linear-gradient(135deg, #ff85b3, #ff6b9d)'
            : 'rgba(255,182,209,0.2)',
          boxShadow: canSend ? '0 4px 12px rgba(255,133,179,0.4)' : 'none',
          transform: canSend ? 'scale(1)' : 'scale(0.92)',
          color: canSend ? '#fff' : 'rgba(255,133,179,0.4)',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>🐾</span>
      </button>
    </div>
  )
})

export default MessageInput
