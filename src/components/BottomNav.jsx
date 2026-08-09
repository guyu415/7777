import { MessageCircleHeart, Settings2, Sparkles } from 'lucide-react'

const TABS = [
  { id: 'sessions', label: '宇宙', Icon: Sparkles },
  { id: 'chat', label: '聊天', Icon: MessageCircleHeart },
  { id: 'globalSettings', label: '设置', Icon: Settings2 },
]

export default function BottomNav({ currentView, onChange, theme, bare = false }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#756ea8'

  return (
    <nav
      className={bare ? 'flex-shrink-0' : 'flex-shrink-0 safe-bottom'}
      aria-label="主导航"
      style={{
        padding: bare ? '5px 14px' : '6px 14px 7px',
        background: bare ? 'transparent' : 'rgba(255,255,255,.2)',
        backdropFilter: bare ? undefined : 'blur(18px)',
        WebkitBackdropFilter: bare ? undefined : 'blur(18px)',
      }}
    >
      <div style={{
        height: 62,
        display: 'flex',
        alignItems: 'stretch',
        padding: 4,
        borderRadius: 25,
        border: '1px solid rgba(255,255,255,.72)',
        background: 'linear-gradient(135deg,rgba(255,255,255,.68),rgba(255,239,247,.52))',
        boxShadow: '0 10px 28px rgba(81,69,97,.13),inset 0 1px 0 rgba(255,255,255,.9)',
      }}>
        {TABS.map(({ id, label, Icon }) => {
          const active = currentView === id
          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              aria-current={active ? 'page' : undefined}
              style={{
                position: 'relative',
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: 0,
                border: 0,
                borderRadius: 21,
                background: active ? `linear-gradient(145deg,${primary}20,rgba(255,255,255,.55))` : 'transparent',
                color: active ? primaryDark : '#a4a4b1',
                cursor: 'pointer',
                transition: 'all .22s ease',
              }}
            >
              <Icon size={active ? 20 : 18} strokeWidth={active ? 2 : 1.6} />
              <span style={{ fontSize: 10, lineHeight: 1, fontWeight: active ? 700 : 500, letterSpacing: '.06em' }}>{label}</span>
              {active && <i style={{ position: 'absolute', bottom: 2, width: 4, height: 4, borderRadius: '50%', background: primary, boxShadow: `0 0 7px ${primary}` }} />}
            </button>
          )
        })}
      </div>
    </nav>
  )
}
