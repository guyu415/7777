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

  // Combined font effect: load any unregistered custom FontFaces from IDB first,
  // then set --app-font. This order ensures the CSS var is never set to an
  // unregistered family (which would cause the browser to fall back to the
  // :root default and stay there even after the font loads).
  useEffect(() => {
    const applyFont = async () => {
      console.log(`[FONT] applyFont triggered — effectiveFontFamily: ${effectiveFontFamily}, customFonts: ${customFonts?.length ?? 0}个`)

      // Step 1: load any unregistered custom FontFaces from IDB
      const toLoad = (customFonts ?? []).filter(f => !document.fonts.check(`12px "${f.family}"`))
      if (toLoad.length) {
        console.log(`[FONT] 需从IDB加载: ${toLoad.map(f => f.family).join(', ')}`)
      }
      for (const font of toLoad) {
        try {
          const blob = await getCustomFont(font.id)
          console.log(`[FONT] getCustomFont(${font.id}) → ${blob ? `blob ${(blob.size/1024).toFixed(1)}KB` : 'null'}`)
          if (!blob) continue
          const url = URL.createObjectURL(blob)
          const face = new FontFace(font.family, `url(${url})`)
          await face.load()
          document.fonts.add(face)
          console.log(`[FONT] FontFace已注册: ${font.family}`)
        } catch (e) {
          console.warn(`[FONT] 加载失败: ${font.family}`, e)
        }
      }

      // Step 2: now that fonts are registered, set --app-font
      const fontId = effectiveFontFamily
      const builtIn = FONT_MAP[fontId]
      if (builtIn) {
        document.documentElement.style.setProperty('--app-font', builtIn)
        console.log(`[FONT] 设置内置字体: ${fontId}`)
      } else {
        const cf = (customFonts ?? []).find(f => f.id === fontId)
        if (cf) {
          document.documentElement.style.setProperty('--app-font', `'${cf.family}', sans-serif`)
          console.log(`[FONT] 设置自定义字体: ${cf.family}`)
        } else {
          console.log(`[FONT] 未找到字体ID: ${fontId}, customFonts ids: ${(customFonts ?? []).map(f => f.id).join(',')}`)
        }
      }
    }
    applyFont()
  }, [effectiveFontFamily, customFonts])

  useEffect(() => {
    // Scale all rem-based Tailwind utilities globally
    document.documentElement.style.fontSize = `${effectiveFontSize}px`
  }, [effectiveFontSize])

  // Load background image from IndexedDB
  useEffect(() => {
    console.log(`[BG-APP] effectiveChatBg:`, effectiveChatBg)
    if (effectiveChatBg?.type !== 'image') { setBgUrl(null); return }
    if (effectiveChatBg.blobKey) {
      console.log(`[BG-APP] getBlob(${effectiveChatBg.blobKey}) 开始…`)
      getBlob(effectiveChatBg.blobKey).then(blob => {
        console.log(`[BG-APP] getBlob 返回:`, blob ? `blob ${(blob.size/1024).toFixed(1)}KB type=${blob.type}` : 'null')
        const url = blob ? URL.createObjectURL(blob) : null
        console.log(`[BG-APP] setBgUrl →`, url)
        setBgUrl(url)
      })
    } else if (effectiveChatBg.value) {
      console.log(`[BG-APP] 使用 value URL`)
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
