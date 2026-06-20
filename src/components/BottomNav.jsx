const TABS = [
  { id: 'sessions',       label: '会话', img: '/assets/nav1sessions.png' },
  { id: 'chat',           label: '聊天', img: '/assets/nav2chat.png' },
  { id: 'globalSettings', label: '设置', img: '/assets/nav3settings.png' },
]

export default function BottomNav({ currentView, onChange, theme }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const activeIdx = TABS.findIndex(t => t.id === currentView)
  const sliderLeft = `${((activeIdx * 2 + 1) / (TABS.length * 2)) * 100}%`

  return (
    <div
      className="flex items-center justify-around safe-bottom flex-shrink-0"
      style={{
        position: 'relative',
        background: `linear-gradient(to bottom, ${primary}0c, rgba(255,255,255,0.30))`,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: `1px solid ${primary}18`,
        paddingTop: 6,
        paddingBottom: 6,
        minHeight: 68,
      }}
    >
      {/* Sliding circle highlight */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: sliderLeft,
          transform: 'translate(-50%, -50%)',
          transition: 'left 0.3s ease',
          width: 60, height: 60,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${primary}30, ${primary}0a)`,
          border: `1.5px solid ${primary}44`,
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: `0 0 18px ${primary}38, inset 0 0 10px rgba(255,255,255,0.25)`,
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      {TABS.map((tab) => {
        const active = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="flex items-center justify-center flex-1 transition-all duration-200"
            style={{
              padding: '2px 0',
              background: 'none',
              border: 'none',
              position: 'relative',
              zIndex: 1,
              cursor: 'pointer',
            }}
          >
            <div style={{ position: 'relative', width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img
                src={tab.img}
                alt={tab.label}
                style={{
                  width: 48, height: 48,
                  objectFit: 'contain',
                  filter: active
                    ? `drop-shadow(0 0 8px ${primary}) drop-shadow(0 0 18px ${primary}99) brightness(1.1)`
                    : 'opacity(0.5) saturate(0.6)',
                  transform: active ? 'scale(1.1)' : 'scale(1)',
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
