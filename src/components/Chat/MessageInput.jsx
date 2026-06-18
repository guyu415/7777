import { useState, useRef } from 'react'
import { Mic, ImagePlus, Send, Smile } from 'lucide-react'
import VoiceRecorder from '../Voice/VoiceRecorder'
import clsx from 'clsx'

export default function MessageInput({ onSend, onSendVoice, onSendImage, disabled }) {
  const [text, setText] = useState('')
  const [showVoice, setShowVoice] = useState(false)
  const fileRef = useRef(null)

  const handleSend = () => {
    if (!text.trim() || disabled) return
    onSend(text.trim())
    setText('')
  }

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = reader.result.split(',')[1]
      onSendImage({ imageData: base64, imageType: file.type, imageUrl: reader.result })
    }
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
    <div className="flex items-end gap-2 px-3 py-2 bg-white border-t border-pink-100 safe-bottom">
      <button
        onClick={() => setShowVoice(true)}
        className="w-9 h-9 flex items-center justify-center rounded-full text-pink-400 hover:bg-pink-50 flex-shrink-0 mb-0.5"
      >
        <Mic size={20} />
      </button>
      <div className="flex-1 flex items-end bg-pink-50 rounded-2xl px-3 py-2 min-h-[40px] max-h-[120px] overflow-hidden">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={handleKey}
          placeholder="说点什么吧～"
          rows={1}
          disabled={disabled}
          className="flex-1 bg-transparent text-sm text-gray-700 placeholder-pink-200 resize-none outline-none leading-relaxed overflow-auto"
          style={{ maxHeight: '96px' }}
          onInput={e => {
            e.target.style.height = 'auto'
            e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px'
          }}
        />
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleImage} />
      <button
        onClick={() => fileRef.current?.click()}
        className="w-9 h-9 flex items-center justify-center rounded-full text-pink-400 hover:bg-pink-50 flex-shrink-0 mb-0.5"
      >
        <ImagePlus size={20} />
      </button>
      <button
        onClick={handleSend}
        disabled={!text.trim() || disabled}
        className={clsx(
          'w-9 h-9 flex items-center justify-center rounded-full flex-shrink-0 mb-0.5 transition-all',
          text.trim() && !disabled
            ? 'bg-pink-400 text-white shadow-md scale-100'
            : 'bg-pink-100 text-pink-200 scale-95'
        )}
      >
        <Send size={16} />
      </button>
    </div>
  )
}
