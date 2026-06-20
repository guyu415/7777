const TABS = [
  { id: 'sessions',       label: '会话' },
  { id: 'chat',           label: '聊天' },
  { id: 'globalSettings', label: '设置' },
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
        paddingTop: 4,
        paddingBottom: 4,
        minHeight: 44,
      }}
    >
      {TABS.map(tab => {
        const active = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="flex items-center justify-center flex-1 transition-all duration-200"
            style={{ padding: '4px 0' }}
          >
            <span
              className="flex items-center justify-center transition-all duration-200"
              style={{
                position: 'relative',
                minWidth: 56,
                padding: '6px 16px',
                borderRadius: '18px 18px 18px 6px',
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                color: active ? '#fff' : primaryDark,
                background: active
                  ? `linear-gradient(135deg, ${primary}, ${primaryDark})`
                  : `${primary}1f`,
                boxShadow: active ? `0 3px 10px ${primary}55` : 'none',
                transform: active ? 'translateY(-1px) scale(1.05)' : 'scale(1)',
              }}
            >
              {tab.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
