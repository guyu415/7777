import { useEffect, useState } from 'react'
import { checkCompanionMedia, companionMediaUrl } from '../../services/companion'

function mediaLabel(kind) {
  if (kind === 'video') return '视频'
  if (kind === 'image') return '动图'
  return '互动动画'
}

export default function MediaBubble({ message, theme, isUser = false }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const src = companionMediaUrl(message.mediaId)

  useEffect(() => {
    let alive = true
    setReady(false)
    setError('')
    checkCompanionMedia(message.mediaId)
      .then(() => { if (alive) setReady(true) })
      .catch(err => { if (alive) setError(err?.message || '媒体加载失败') })
    return () => { alive = false }
  }, [message.mediaId])

  const kind = message.mediaKind || (message.mediaType?.startsWith('video/') ? 'video' : 'animation')
  const title = message.mediaName || mediaLabel(kind)
  const textColor = isUser ? (theme?.userBubbleText || '#C78FCA') : (theme?.aiBubbleText || '#3d6b52')

  return (
    <div
      className="overflow-hidden rounded-[18px]"
      style={{
        width: 'min(320px, 100%)',
        background: isUser ? `${theme?.userBubble || 'rgba(255,133,179,0.5)'}` : 'rgba(255,255,255,0.78)',
        color: textColor,
        boxShadow: `0 4px 16px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.18)'}`,
        border: '1px solid rgba(255,255,255,0.55)',
      }}
    >
      <div style={{ position: 'relative', background: '#101715', minHeight: kind === 'animation' ? 360 : 180 }}>
        {!ready && !error && (
          <div className="absolute inset-0 grid place-items-center text-xs" style={{ color: 'rgba(255,255,255,.72)' }}>
            正在加载{mediaLabel(kind)}…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center px-5 text-center text-xs" style={{ color: '#ffd7df' }}>
            {error}
          </div>
        )}
        {ready && kind === 'video' && (
          <video src={src} controls playsInline preload="metadata" onError={() => setError('视频加载失败')} style={{ width: '100%', display: 'block', maxHeight: 460 }} />
        )}
        {ready && kind === 'image' && (
          <img src={src} alt={title} onError={() => setError('动图加载失败')} style={{ width: '100%', display: 'block' }} />
        )}
        {ready && kind === 'animation' && (
          <iframe
            src={src}
            title={title}
            sandbox="allow-scripts"
            allowFullScreen
            style={{ width: '100%', height: 440, display: 'block', border: 0, background: '#eef3ef' }}
          />
        )}
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{title}</div>
            <div className="mt-0.5 text-[10px] opacity-60">{mediaLabel(kind)} · 由常驻 Claude 直接发送</div>
          </div>
          <a
            href={companionMediaUrl(message.mediaId)}
            target="_blank"
            rel="noreferrer"
            className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium"
            style={{ background: 'rgba(255,255,255,.55)', color: 'inherit' }}
          >
            打开
          </a>
        </div>
        {message.content && <div className="mt-2 whitespace-pre-wrap text-sm">{message.content}</div>}
      </div>
    </div>
  )
}
