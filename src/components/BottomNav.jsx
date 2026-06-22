const TABS = [
  { id: 'sessions',       label: '会话', img: '/assets/bunny.png',          fit: 'contain' },
  { id: 'chat',           label: '聊天', img: '/assets/capybara-acorn.png', fit: 'contain' },
  { id: 'globalSettings', label: '设置', img: '/assets/capybara-apple.png', fit: 'contain' },
  { id: 'diary',          label: '日记', emoji: '📔' }, // 临时占位图标，待替换为胶囊兽
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
              {tab.emoji ? (
                <div
                  style={{
                    width: '100%', height: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 30,
                    filter: active
                      ? `drop-shadow(0 0 7px ${primary}) brightness(1.05)`
                      : 'opacity(0.42) saturate(0.5)',
                    transform: active ? 'scale(1.06)' : 'scale(1)',
                    transition: 'all 0.3s ease',
                  }}
                >
                  <div style={{
                    width: 58, height: 58, borderRadius: '46% 54% 52% 48% / 50% 48% 52% 50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: active ? `${primary}22` : 'rgba(180,200,220,0.18)',
                    border: active ? `1.5px solid ${primary}66` : '1.5px solid rgba(200,220,255,0.3)',
                  }}>
                    <span style={{ marginTop: -6 }}>{tab.emoji}</span>
                  </div>
                </div>
              ) : (
                <img
                  src={tab.img}
                  alt={tab.label}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: tab.fit || 'cover',
                    filter: active
                      ? `drop-shadow(0 0 7px ${primary}) drop-shadow(0 0 16px ${primary}aa) brightness(1.12)`
                      : 'opacity(0.42) saturate(0.5)',
                    transform: active ? 'scale(1.06)' : 'scale(1)',
                    transition: 'all 0.3s ease',
                  }}
                />
              )}
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
