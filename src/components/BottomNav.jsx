import clsx from 'clsx'

const TABS = [
  { id: 'chat',            icon: '💬', label: '聊天' },
  { id: 'sessions',        icon: '📋', label: '会话' },
  { id: 'globalSettings',  icon: '⚙️', label: '全局' },
  { id: 'sessionSettings', icon: '🎨', label: '当前会话' },
]

export default function BottomNav({ currentView, onChange, theme }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  return (
    <div
      className="flex items-center justify-around safe-bottom flex-shrink-0"
      style={{
        background: 'rgba(255,255,255,0.88)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderTop: '1px solid rgba(200,220,255,0.3)',
        boxShadow: '0 -2px 20px rgba(74,172,240,0.08)',
        paddingTop: 6,
        paddingBottom: 6,
        minHeight: 56,
      }}
    >
      {TABS.map(tab => {
        const active = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            className="flex flex-col items-center gap-0.5 flex-1 py-1 transition-all duration-200"
          >
            <span
              className={clsx('text-xl transition-all duration-200', active ? 'scale-110' : 'scale-100 opacity-60')}
              style={active ? {
                filter: `drop-shadow(0 2px 4px ${primary}80)`,
              } : {}}
            >
              {tab.icon}
            </span>
            <span
              className="text-[10px] font-medium transition-all duration-200"
              style={{
                color: active ? primaryDark : '#a0b0c8',
                fontWeight: active ? 600 : 400,
              }}
            >
              {tab.label}
            </span>
            {active && (
              <span
                className="block rounded-full"
                style={{
                  width: 20,
                  height: 3,
                  background: `linear-gradient(90deg, ${primary}, ${primaryDark})`,
                  marginTop: 1,
                  borderRadius: 2,
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
