import { useEffect } from 'react'
import { useStore } from './store'
import { getCustomFont } from './store'
import { THEMES } from './themes'
import ChatWindow from './components/Chat/ChatWindow'
import GlobalSettings from './components/GlobalSettings'
import SessionSettings from './components/SessionSettings'
import SessionList from './components/SessionList'
import BottomNav from './components/BottomNav'

const PETALS = ['🌸', '🌺', '✿', '🌸', '✾']

const FONT_MAP = {
  noto: "'Noto Sans SC', 'PingFang SC', -apple-system, sans-serif",
  zcool: "'ZCOOL XiaoWei', serif",
  mashan: "'Ma Shan Zheng', cursive",
}

export default function App() {
  const {
    currentView, setCurrentView,
    themeId: globalThemeId,
    chatBg: globalChatBg,
    fontFamily: globalFontFamily,
    defaultFontSize,
    customFonts,
    sessions, currentSessionId,
  } = useStore()

  const currentSession = sessions?.find(s => s.id === currentSessionId)

  // Per-session overrides falling back to globals
  const effectiveThemeId = currentSession?.themeId ?? globalThemeId
  const effectiveChatBg = currentSession?.chatBg ?? globalChatBg
  const effectiveFontFamily = currentSession?.fontFamily ?? globalFontFamily
  const effectiveFontSize = currentSession?.fontSize ?? defaultFontSize

  const theme = THEMES[effectiveThemeId] || THEMES.pink

  // Set CSS vars for bubble tails and font
  useEffect(() => {
    document.documentElement.style.setProperty('--tail-user', theme.tailUser)
    document.documentElement.style.setProperty('--tail-ai', theme.tailAi)
  }, [theme.tailUser, theme.tailAi])

  useEffect(() => {
    const fontId = effectiveFontFamily
    const builtIn = FONT_MAP[fontId]
    if (builtIn) {
      document.documentElement.style.setProperty('--app-font', builtIn)
    } else {
      // Custom font by id — family name is stored in customFonts
      const cf = customFonts?.find(f => f.id === fontId)
      if (cf) document.documentElement.style.setProperty('--app-font', `'${cf.family}', sans-serif`)
    }
  }, [effectiveFontFamily, customFonts])

  useEffect(() => {
    // Scale all rem-based Tailwind utilities globally
    document.documentElement.style.fontSize = `${effectiveFontSize}px`
  }, [effectiveFontSize])

  // Load custom fonts from IndexedDB on mount
  useEffect(() => {
    if (!customFonts?.length) return
    customFonts.forEach(async (font) => {
      try {
        const blob = await getCustomFont(font.id)
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const face = new FontFace(font.family, `url(${url})`)
        await face.load()
        document.fonts.add(face)
      } catch {
        // font may no longer be in IDB — ignore
      }
    })
  }, [])

  // Background from effective settings
  const bgIsColor = effectiveChatBg?.type === 'color'
  const bgIsImage = effectiveChatBg?.type === 'image'

  const wrapperBgStyle = bgIsColor
    ? { background: effectiveChatBg.value || theme.appBg }
    : { background: theme.appBg }

  return (
    <div className="h-full w-full" style={wrapperBgStyle}>
      {bgIsImage && effectiveChatBg.value && currentView === 'chat' && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${effectiveChatBg.value})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            opacity: effectiveChatBg.opacity ?? 1.0,
            zIndex: 0,
          }}
        />
      )}

      {/* Blurred orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 1 }}>
        <div style={{ position: 'absolute', top: '-80px', right: '-60px', width: '280px', height: '280px', borderRadius: '50%', background: theme.orbColor1, filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', bottom: '-100px', left: '-80px', width: '340px', height: '340px', borderRadius: '50%', background: theme.orbColor2, filter: 'blur(80px)' }} />
        <div style={{ position: 'absolute', top: '40%', left: '30%', width: '200px', height: '200px', borderRadius: '50%', background: theme.orbColor3, filter: 'blur(50px)' }} />
        {PETALS.map((p, i) => (
          <span key={i} className="petal">{p}</span>
        ))}
      </div>

      {/* App shell */}
      <div
        className="relative h-full w-full max-w-md mx-auto flex flex-col overflow-hidden"
        style={{ boxShadow: `0 0 60px ${theme.primary}26`, zIndex: 2 }}
      >
        <div className="flex-1 overflow-hidden min-h-0">
          {currentView === 'chat' && <ChatWindow theme={theme} />}
          {currentView === 'sessions' && (
            <SessionList theme={theme} onSelectSession={() => setCurrentView('chat')} />
          )}
          {currentView === 'globalSettings' && <GlobalSettings theme={theme} />}
          {currentView === 'sessionSettings' && <SessionSettings theme={theme} />}
        </div>

        {currentView !== 'sessionSettings' && (
          <BottomNav currentView={currentView} onChange={setCurrentView} theme={theme} />
        )}
      </div>
    </div>
  )
}
