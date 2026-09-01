import { memo } from 'react'

function PendingReplyIndicator({ aiAvatar, theme }) {
  return (
    <div
      className="flex w-full min-w-0 items-end gap-2 mb-4 animate-fade-up"
      aria-label="正在回复"
      aria-live="polite"
      style={{ pointerEvents: 'none' }}
    >
      <div className="flex-shrink-0" style={{ width: 75, height: 48, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: '50%', bottom: 4, transform: 'translateX(-50%)',
          width: 37, height: 37, borderRadius: '50%', overflow: 'hidden',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.05rem',
          background: 'rgba(255,255,255,0.55)',
          boxShadow: `0 2px 8px ${theme?.aiBubbleShadow || 'rgba(160,220,180,0.2)'}`,
        }}>
          {aiAvatar
            ? <img src={aiAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : '🌸'}
        </div>
      </div>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 5,
        marginBottom: 4, padding: '10px 14px', borderRadius: 18,
        background: 'rgba(255,255,255,0.58)',
        border: '1px solid rgba(255,255,255,0.72)',
        boxShadow: `0 3px 12px ${theme?.aiBubbleShadow || 'rgba(120,160,140,0.16)'}`,
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      }}>
        {[0, 1, 2].map(index => (
          <span
            key={index}
            className="typing-dot"
            style={{
              width: 7, height: 7, borderRadius: '50%', display: 'block',
              background: theme?.primary || '#c47a8a', opacity: 0.58,
              animationDelay: `${index * 0.2}s`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export default memo(PendingReplyIndicator)
