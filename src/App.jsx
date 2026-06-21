import { useEffect, useState, useRef } from 'react'
import { useStore, getCustomFont, getBlob } from './store'
import { THEMES } from './themes'
import ChatWindow from './components/Chat/ChatWindow'
import GlobalSettings from './components/GlobalSettings'
import SessionSettings from './components/SessionSettings'
import SessionList from './components/SessionList'
import BottomNav from './components/BottomNav'
import LoginPage from './components/LoginPage'
import { getSettings, saveSettings, extractSettings } from './services/sync'

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

  // ── Auth ───────────────────────────────────────────────────────
  const [loggedIn, setLoggedIn] = useState(() => !!localStorage.getItem('auth.password'))
  const [syncError, setSyncError] = useState(null)
  const syncReady = useRef(false)
  const syncTimer = useRef(null)

  // Pull latest cloud settings after login (startup sync)
  useEffect(() => {
    if (!loggedIn) return
    const password = localStorage.getItem('auth.password')
    if (!password) return
    getSettings(password)
      .then(cloud => { if (cloud) useStore.getState().restoreFromCloud(cloud) })
      .catch(() => {})
      .finally(() => { syncReady.current = true })
  }, [loggedIn])

  // Debounced auto-sync: fires 2s after any store change, once startup pull is done
  useEffect(() => {
    if (!loggedIn) return
    const unsub = useStore.subscribe(() => {
      if (!syncReady.current) return
      const password = localStorage.getItem('auth.password')
      if (!password) return
      clearTimeout(syncTimer.current)
      syncTimer.current = setTimeout(async () => {
        const settings = extractSettings(useStore.getState())
        try {
          await saveSettings(password, settings)
        } catch {
          setSyncError('云端同步失败，将在下次自动重试')
          setTimeout(() => setSyncError(null), 3000)
        }
      }, 2000)
    })
    return () => { unsub(); clearTimeout(syncTimer.current) }
  }, [loggedIn])

  // ── Theme / font / bg ──────────────────────────────────────────
  const currentSession = sessions?.find(s => s.id === currentSessionId)

  const effectiveThemeId = currentSession?.themeId ?? globalThemeId
  const effectiveChatBg = currentSession?.chatBg ?? globalChatBg
  const effectiveFontFamily = currentSession?.fontFamily ?? globalFontFamily
  const effectiveFontSize = currentSession?.fontSize ?? defaultFontSize

  const theme = THEMES[effectiveThemeId] || THEMES.pink

  const [bgUrl, setBgUrl] = useState(null)

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
      const cf = customFonts?.find(f => f.id === fontId)
      if (cf) document.documentElement.style.setProperty('--app-font', `'${cf.family}', sans-serif`)
    }
  }, [effectiveFontFamily, customFonts])

  useEffect(() => {
    document.documentElement.style.fontSize = `${effectiveFontSize}px`
  }, [effectiveFontSize])

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
        } catch (e) {
          console.warn(`[Font] 加载失败: ${font.family}`, e)
        }
      }
      const current = document.documentElement.style.getPropertyValue('--app-font')
      if (current) {
        document.documentElement.style.removeProperty('--app-font')
        requestAnimationFrame(() => document.documentElement.style.setProperty('--app-font', current))
      }
    }
    loadAll()
  }, [customFonts])

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

  // ── Login gate ─────────────────────────────────────────────────
  if (!loggedIn) {
    return <LoginPage onLogin={() => setLoggedIn(true)} />
  }

  // ── Main app ───────────────────────────────────────────────────
  const bgIsColor = effectiveChatBg?.type === 'color'
  const bgIsImage = effectiveChatBg?.type === 'image'

  const wrapperBgStyle = bgIsColor
    ? { background: effectiveChatBg.value || theme.appBg }
    : { background: theme.appBg }

  const handleLogout = () => {
    syncReady.current = false
    clearTimeout(syncTimer.current)
    localStorage.removeItem('auth.password')
    setLoggedIn(false)
  }

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
          {currentView === 'globalSettings' && <GlobalSettings theme={theme} onLogout={handleLogout} />}
          {currentView === 'sessionSettings' && <SessionSettings theme={theme} />}
        </div>

        {currentView !== 'sessionSettings' && currentView !== 'chat' && (
          <BottomNav currentView={currentView} onChange={setCurrentView} theme={theme} />
        )}
      </div>

      {/* Sync error toast (bottom-right) */}
      {syncError && (
        <div
          className="fixed z-50"
          style={{
            bottom: 100, right: 16,
            background: 'rgba(220,60,60,0.92)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: 'white', fontSize: 12, fontWeight: 500,
            padding: '8px 14px', borderRadius: 16,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            maxWidth: 220,
          }}
        >
          {syncError}
        </div>
      )}
    </div>
  )
}
