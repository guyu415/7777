import { useEffect, useState } from 'react'
import { useStore, getCustomFont, getBlob } from './store'
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

  const [bgUrl, setBgUrl] = useState(null)

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

  // Load custom fonts from IndexedDB whenever the list changes
  useEffect(() => {
    if (!customFonts?.length) return
    const loadAll = async () => {
      for (const font of customFonts) {
        if (document.fonts.check(`12px "${font.family}"`)) continue
        try {
          const blob = await getCustomFont(font.id)
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          const face = new FontFace(font.family, `url(${url})`)
          await face.load()
          document.fonts.add(face)
          console.log(`[Font] 已加载: ${font.family}`)
        } catch (e) {
          console.warn(`[Font] 加载失败: ${font.family}`, e)
        }
      }
      // Re-apply --app-font after all fonts are loaded so the browser picks up
      // any custom FontFace that was registered after the CSS var was first set
      const current = document.documentElement.style.getPropertyValue('--app-font')
      if (current) {
        document.documentElement.style.removeProperty('--app-font')
        requestAnimationFrame(() => document.documentElement.style.setProperty('--app-font', current))
      }
    }
    loadAll()
  }, [customFonts])

  // Load background image from IndexedDB
  useEffect(() => {
    if (effectiveChatBg?.type !== 'image') { setBgUrl(null); return }
    if (effectiveChatBg.blobKey) {
      getBlob(effectiveChatBg.blobKey).then(blob => setBgUrl(blob ? URL.createObjectURL(blob) : null))
    } else if (effectiveChatBg.value) {
      setBgUrl(effectiveChatBg.value)
    } else {
      setBgUrl(null)
    }
  }, [effectiveChatBg?.blobKey, effectiveChatBg?.type, effectiveChatBg?.value])

  // Background from effective settings
  const bgIsColor = effectiveChatBg?.type === 'color'
  const bgIsImage = effectiveChatBg?.type === 'image'

  const wrapperBgStyle = bgIsColor
    ? { background: effectiveChatBg.value || theme.appBg }
    : { background: theme.appBg }

  return (
    <div className="h-full w-full" style={wrapperBgStyle}>
      {bgIsImage && bgUrl && currentView === 'chat' && (
        <div
          className="fixed inset-0 pointer-events-none"
          style={{
            backgroundImage: `url(${bgUrl})`,
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

        {/* BottomNav for sessions/globalSettings; chat view embeds it inside ChatWindow */}
        {currentView !== 'sessionSettings' && currentView !== 'chat' && (
          <BottomNav currentView={currentView} onChange={setCurrentView} theme={theme} />
        )}
      </div>
    </div>
  )
}
