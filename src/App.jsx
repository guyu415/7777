import { useEffect } from 'react'
import { useStore } from './store'
import { THEMES } from './themes'
import ChatWindow from './components/Chat/ChatWindow'
import SettingsPage from './components/SettingsPage'

const PETALS = ['🌸', '🌺', '✿', '🌸', '✾']

const FONT_MAP = {
  noto: "'Noto Sans SC', 'PingFang SC', -apple-system, sans-serif",
  zcool: "'ZCOOL XiaoWei', serif",
  mashan: "'Ma Shan Zheng', cursive",
}

export default function App() {
  const { currentView, themeId, chatBg, fontFamily } = useStore()
  const theme = THEMES[themeId] || THEMES.pink

  // Set CSS vars for bubble tails and font
  useEffect(() => {
    document.documentElement.style.setProperty('--tail-user', theme.tailUser)
    document.documentElement.style.setProperty('--tail-ai', theme.tailAi)
  }, [theme.tailUser, theme.tailAi])

  useEffect(() => {
    const font = FONT_MAP[fontFamily] || FONT_MAP.noto
    document.documentElement.style.setProperty('--app-font', font)
  }, [fontFamily])

  // Compute background style based on chatBg
  const bgIsGradient = !chatBg || chatBg.type === 'gradient'
  const bgIsColor = chatBg?.type === 'color'
  const bgIsImage = chatBg?.type === 'image'

  const wrapperBgStyle = bgIsColor
    ? { background: chatBg.value || theme.appBg }
    : { background: theme.appBg }

  return (
    <div className="h-full w-full" style={wrapperBgStyle}>
      {/* Image background overlay */}
      {bgIsImage && chatBg.value && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${chatBg.value})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: chatBg.opacity ?? 1.0,
            zIndex: 0,
          }}
        />
      )}

      {/* Blurred orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
        <div style={{ position:'absolute', top:'-80px', right:'-60px', width:'280px', height:'280px', borderRadius:'50%', background: theme.orbColor1, filter:'blur(60px)' }} />
        <div style={{ position:'absolute', bottom:'-100px', left:'-80px', width:'340px', height:'340px', borderRadius:'50%', background: theme.orbColor2, filter:'blur(80px)' }} />
        <div style={{ position:'absolute', top:'40%', left:'30%', width:'200px', height:'200px', borderRadius:'50%', background: theme.orbColor3, filter:'blur(50px)' }} />
        {/* Floating petals */}
        {PETALS.map((p, i) => (
          <span key={i} className="petal">{p}</span>
        ))}
      </div>

      {/* App shell */}
      <div className="relative h-full w-full max-w-md mx-auto flex flex-col overflow-hidden" style={{
        boxShadow: `0 0 60px ${theme.primary}26`,
        zIndex: 2,
      }}>
        {currentView === 'chat' && <ChatWindow theme={theme} />}
        {currentView === 'settings' && <SettingsPage theme={theme} />}
      </div>
    </div>
  )
}
