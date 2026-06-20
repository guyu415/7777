const TABS = [
  { id: 'sessions',       label: '会话', img: '/assets/nav1sessions.png' },
  { id: 'chat',           label: '聊天', img: '/assets/nav2chat.png' },
  { id: 'globalSettings', label: '设置', img: '/assets/nav3settings.png' },
]

export default function BottomNav({ currentView, onChange, theme }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  return (
    <div
      className="flex items-center justify-around safe-bottom flex-shrink-0"
      style={{
        background: `linear-gradient(to bottom, ${primary}14, rgba(255,255,255,0.55))`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid ${primary}22`,
        paddingTop: 2,
        paddingBottom: 2,
        minHeight: 52,
      }}
    >
      {TABS.map(tab => {
        const active = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="flex items-center justify-center flex-1 transition-all duration-200"
            style={{ padding: '2px 0' }}
          >
            <div style={{ position: 'relative', width: 60, height: 60 }}>
              <img
                src={tab.img}
                alt={tab.label}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  filter: active
                    ? `drop-shadow(0 0 6px ${primary}) drop-shadow(0 0 12px ${primary}88) brightness(1.08)`
                    : 'opacity(0.55) saturate(0.7)',
                  transform: active ? 'scale(1.08)' : 'scale(1)',
                  transition: 'all 0.25s ease',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  color: active ? primaryDark : '#aaa',
                  textShadow: active ? `0 0 8px ${primary}cc, 0 1px 0 rgba(255,255,255,0.8)` : '0 1px 0 rgba(255,255,255,0.6)',
                  letterSpacing: '0.02em',
                  pointerEvents: 'none',
                  userSelect: 'none',
                }}
              >
                {tab.label}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
