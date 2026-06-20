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
        background: `linear-gradient(to bottom, ${primary}08, rgba(255,255,255,0.22))`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid ${primary}14`,
        paddingTop: 4,
        paddingBottom: 4,
        minHeight: 72,
      }}
    >
      {TABS.map((tab) => {
        const active = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="flex items-center justify-center flex-1"
            style={{
              padding: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {/* The flower wreath IS the tab frame — no separate circle */}
            <div style={{ position: 'relative', width: 64, height: 64 }}>
              <img
                src={tab.img}
                alt={tab.label}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  filter: active
                    ? `drop-shadow(0 0 7px ${primary}) drop-shadow(0 0 16px ${primary}aa) brightness(1.12)`
                    : 'opacity(0.42) saturate(0.5)',
                  transform: active ? 'scale(1.08)' : 'scale(0.92)',
                  transition: 'all 0.3s ease',
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  color: active ? primaryDark : '#bbb',
                  textShadow: active
                    ? `0 0 8px ${primary}cc, 0 1px 0 rgba(255,255,255,0.9)`
                    : '0 1px 0 rgba(255,255,255,0.6)',
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
