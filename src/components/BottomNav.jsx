const TABS = [
  { id: 'sessions', label: '花园', img: '/assets/bunny.png' },
  { id: 'chat', label: '聊天', img: '/assets/capybara-acorn.png' },
  { id: 'globalSettings', label: '设置', img: '/assets/capybara-apple.png' },
]

export default function BottomNav({ currentView, onChange, theme, bare = false }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#756ea8'

  return (
    <nav
      className={bare ? 'flex-shrink-0' : 'flex-shrink-0 safe-bottom'}
      aria-label="主导航"
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-around',
        minHeight: 82, padding: '1px 4px',
        background: bare ? 'transparent' : 'linear-gradient(to bottom,rgba(255,255,255,.22),rgba(255,240,247,.42))',
        backdropFilter: bare ? undefined : 'blur(18px)', WebkitBackdropFilter: bare ? undefined : 'blur(18px)',
        borderTop: bare ? 'none' : `1px solid ${primary}14`,
      }}
    >
      {TABS.map((tab) => {
        const active = currentView === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => onChange(tab.id)}
            aria-current={active ? 'page' : undefined}
            style={{ flex:1, display:'grid', placeItems:'center', padding:0, border:0, background:'none', cursor:'pointer' }}
          >
            <div style={{ position:'relative', width:78, height:78 }}>
              <img
                src={tab.img}
                alt=""
                style={{
                  width:'100%', height:'100%', objectFit:'contain',
                  filter: active ? `drop-shadow(0 0 7px ${primary}) drop-shadow(0 0 14px ${primary}88) brightness(1.08)` : 'opacity(.5) saturate(.62)',
                  transform: active ? 'scale(1.06)' : 'scale(.98)', transition:'all .28s ease',
                }}
              />
              <span style={{ position:'absolute', inset:0, display:'grid', placeItems:'center', color:active?primaryDark:'#aaa6af', fontSize:11, fontWeight:active?700:500, textShadow:'0 1px 4px rgba(255,255,255,.95)', pointerEvents:'none' }}>{tab.label}</span>
            </div>
          </button>
        )
      })}
    </nav>
  )
}
