const TABS = [
  { id: 'sessions',       label: '会话', img: '/assets/nav1sessions.png' },
  { id: 'chat',           label: '聊天', img: '/assets/nav2chat.png' },
  { id: 'globalSettings', label: '设置', img: '/assets/nav3settings.png' },
]

export default function BottomNav({ currentView, onChange, theme, bare = false }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const containerStyle = bare
    ? { display: 'flex', alignItems: 'center', justifyContent: 'space-around', paddingTop: 4, paddingBottom: 4, minHeight: 88 }
    : {
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        background: `linear-gradient(to bottom, ${primary}08, rgba(255,255,255,0.22))`,
        backdropFilter: 'blur(22px)',
        WebkitBackdropFilter: 'blur(22px)',
        borderTop: `1px solid ${primary}14`,
        paddingTop: 4, paddingBottom: 4,
        minHeight: 88,
      }

  return (
    <div
      className={bare ? 'flex-shrink-0' : 'flex-shrink-0 safe-bottom'}
      style={containerStyle}
    >
      {TABS.map((tab) => {
        const active = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {/* Flower wreath IS the tab frame — fills the tab area */}
            <div style={{ position: 'relative', width: 84, height: 84 }}>
              <img
                src={tab.img}
                alt={tab.label}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  filter: active
                    ? `drop-shadow(0 0 7px ${primary}) drop-shadow(0 0 16px ${primary}aa) brightness(1.12)`
                    : 'opacity(0.42) saturate(0.5)',
                  transform: active ? 'scale(1.06)' : 'scale(1)',
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
