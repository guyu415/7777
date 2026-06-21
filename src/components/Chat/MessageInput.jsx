import { useState, useRef, forwardRef, useImperativeHandle } from 'react'
import VoiceRecorder from '../Voice/VoiceRecorder'

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
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

const MessageInput = forwardRef(function MessageInput({ onSend, onSendVoice, onSendImage, disabled, theme, isLoading, onStop }, ref) {
  const [text, setText] = useState('')
  const [showVoice, setShowVoice] = useState(false)
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
        <button onClick={() => setShowVoice(true)} style={btnBase}>
          <MicIcon />
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
