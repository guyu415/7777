import { useState } from 'react'
import { Check, CheckCheck } from 'lucide-react'
import VoicePlayer from '../Voice/VoicePlayer'
import ImageViewer from '../ImageViewer'
import clsx from 'clsx'

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0, 1, 2].map(i => (
        <div key={i} className="w-2 h-2 rounded-full bg-pink-300 typing-dot" style={{ animationDelay: `${i * 0.2}s` }} />
      ))}
    </div>
  )
}

function formatTime(ts) {
  const d = new Date(ts)
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

export default function MessageBubble({ message }) {
  const [viewerSrc, setViewerSrc] = useState(null)
  const isUser = message.role === 'user'

  return (
    <div className={clsx('flex items-end gap-2 mb-3 animate-fade-up', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div className={clsx('w-8 h-8 rounded-full flex items-center justify-center text-base flex-shrink-0 mb-1', isUser ? 'bg-pink-400' : 'bg-white border-2 border-pink-200')}>
        {isUser ? '🧑' : '🌸'}
      </div>

      {/* Bubble */}
      <div className={clsx('relative max-w-[72vw]', isUser ? 'items-end' : 'items-start')}>
        {message.type === 'text' && (
          <div className={clsx(
            'relative px-4 py-2.5 rounded-bubble text-sm leading-relaxed',
            isUser ? 'bg-pink-400 text-white bubble-user' : 'bg-white text-gray-800 shadow-sm border border-pink-50 bubble-ai'
          )}>
            {message.streaming && !message.content ? (
              <TypingIndicator />
            ) : (
              <span className="whitespace-pre-wrap break-words">{message.content}</span>
            )}
            {message.streaming && message.content && (
              <span className="inline-block w-0.5 h-4 bg-pink-300 animate-pulse-soft ml-0.5 align-middle" />
            )}
          </div>
        )}

        {message.type === 'voice' && (
          <VoicePlayer blobId={message.voiceBlobId} url={message.voiceUrl} duration={message.duration} isUser={isUser} />
        )}

        {message.type === 'image' && (
          <div className="cursor-pointer rounded-2xl overflow-hidden max-w-[200px]" onClick={() => setViewerSrc(message.imageUrl || `data:${message.imageType};base64,${message.imageData}`)}>
            <img
              src={message.imageUrl || `data:${message.imageType};base64,${message.imageData}`}
              alt=""
              className="w-full object-cover"
            />
            {message.content && (
              <div className={clsx('px-3 py-2 text-sm', isUser ? 'bg-pink-400 text-white' : 'bg-white text-gray-700')}>
                {message.content}
              </div>
            )}
          </div>
        )}

        {/* Timestamp + read */}
        <div className={clsx('flex items-center gap-1 mt-0.5 px-1', isUser ? 'flex-row-reverse' : 'flex-row')}>
          <span className="text-[10px] text-gray-400">{formatTime(message.timestamp)}</span>
          {isUser && !message.streaming && (
            <CheckCheck size={12} className="text-pink-300" />
          )}
        </div>
      </div>

      {viewerSrc && <ImageViewer src={viewerSrc} onClose={() => setViewerSrc(null)} />}
    </div>
  )
}
