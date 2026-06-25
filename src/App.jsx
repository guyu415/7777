import { useEffect, useState, useRef } from 'react'
import { useStore, getCustomFont, getBlob, getMessages } from './store'
import { THEMES } from './themes'
import ChatWindow from './components/Chat/ChatWindow'
import GlobalSettings from './components/GlobalSettings'
import SessionSettings from './components/SessionSettings'
import SessionList from './components/SessionList'
import BottomNav from './components/BottomNav'
import LoginPage from './components/LoginPage'
import { getSettings, saveSettings, extractSettings, saveSessionMsgs, putAsset, loadAsset, getLetters } from './services/sync'
import { mergeLetters } from './services/letters'

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
  const [migrationStatus, setMigrationStatus] = useState(null)
  const syncReady = useRef(false)
  const syncTimer = useRef(null)
  const registeredFonts = useRef(new Set())

  // One-time migration: upload all local IDB messages to cloud
  const runMsgMigration = async (password) => {
    const { sessions: allSessions } = useStore.getState()
    console.log('[MIGRATE] 开始 | sessions数量=', allSessions?.length ?? 0)
    if (!allSessions?.length) {
      console.log('[MIGRATE] 无会话，跳过，设置flag')
      localStorage.setItem('msgSyncV1', '1')
      return
    }
    const total = allSessions.length
    let done = 0
    setMigrationStatus(`正在上传会话 0/${total}`)
    for (const session of allSessions) {
      done++
      setMigrationStatus(`正在上传会话 ${done}/${total}`)
      console.log(`[MIGRATE] 处理 ${done}/${total}: id=${session.id} name=${session.name}`)
      try {
        const msgs = await getMessages(session.id)
        console.log(`[MIGRATE] IDB消息数=${msgs.length}`)
        if (msgs.length > 0) {
          msgs.sort((a, b) => a.timestamp - b.timestamp)
          console.log(`[MIGRATE] 上传中, 请求体约${JSON.stringify(msgs).length}字节...`)
          await saveSessionMsgs(password, session.id, msgs)
          console.log(`[MIGRATE] 上传成功: ${session.id}`)
        } else {
          console.log(`[MIGRATE] IDB无消息，跳过`)
        }
      } catch (e) {
        console.warn('[MIGRATE] 上传失败:', session.id, e.message)
      }
    }
    localStorage.setItem('msgSyncV1', '1')
    setMigrationStatus(null)
    console.log('[MIGRATE] 全部完成，flag已设置')
  }

  // Force re-sync: clears flag, re-runs migration (called from GlobalSettings button)
  const handleForceSync = async () => {
    const password = localStorage.getItem('auth.password')
    if (!password) return
    console.log('[FORCE-SYNC] 强制重新同步开始...')
    await runMsgMigration(password)
    console.log('[FORCE-SYNC] 完成')
  }

  // One-time migration: upload existing IDB fonts/backgrounds to KV as base64
  const runAssetMigration = async (password) => {
    const { customFonts, sessions } = useStore.getState()
    const fontsToMigrate = (customFonts || []).filter(f => !f.assetKey)
    const bgsToMigrate = (sessions || []).filter(s => s.chatBg?.blobKey && !s.chatBg?.assetKey)
    const total = fontsToMigrate.length + bgsToMigrate.length
    console.log('[ASSET-MIGRATE] 开始 | fonts=', fontsToMigrate.length, 'bgs=', bgsToMigrate.length)
    if (total === 0) { localStorage.setItem('assetSyncV1', '1'); return }

    let done = 0
    setMigrationStatus(`正在迁移资源 0/${total}`)

    for (const font of fontsToMigrate) {
      done++
      setMigrationStatus(`正在迁移字体 ${done}/${total}`)
      try {
        const blob = await getCustomFont(font.id)
        if (blob) {
          const assetKey = `asset:font:${font.id}`
          await putAsset(password, assetKey, blob)
          useStore.getState().updateCustomFont(font.id, { assetKey })
          console.log('[ASSET-MIGRATE] 字体完成:', font.id)
        }
      } catch (e) {
        console.warn('[ASSET-MIGRATE] 字体失败:', font.id, e.message)
      }
    }

    for (const session of bgsToMigrate) {
      done++
      setMigrationStatus(`正在迁移背景 ${done}/${total}`)
      try {
        const blob = await getBlob(session.chatBg.blobKey)
        if (blob) {
          const randomId = Date.now().toString(36) + Math.random().toString(36).slice(2)
          const assetKey = `asset:bg:${randomId}`
          await putAsset(password, assetKey, blob)
          useStore.getState().setSessionChatBg(session.id, { ...session.chatBg, assetKey, blobKey: undefined })
          console.log('[ASSET-MIGRATE] 背景完成:', session.id)
        }
      } catch (e) {
        console.warn('[ASSET-MIGRATE] 背景失败:', session.id, e.message)
      }
    }

    localStorage.setItem('assetSyncV1', '1')
    setMigrationStatus(null)
    console.log('[ASSET-MIGRATE] 全部完成')
  }

  // One-time cleanup: a legacy image background may have stored its base64 inline
  // in chatBg.value, which then rides along in the synced `settings` blob. Move any
  // such inline data URL out to a KV asset key so settings stays lightweight.
  const separateInlineBgValues = async (password) => {
    if (localStorage.getItem('bgValueSepV1')) return
    const state = useStore.getState()
    const isInline = (bg) => bg?.type === 'image' && typeof bg.value === 'string' && bg.value.startsWith('data:') && !bg.assetKey
    const newKey = () => `asset:bg:${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
    let migrated = 0
    try {
      if (isInline(state.chatBg)) {
        const blob = await (await fetch(state.chatBg.value)).blob()
        const assetKey = newKey()
        await putAsset(password, assetKey, blob)
        useStore.getState().setChatBg({ ...state.chatBg, assetKey, value: '' })
        migrated++
      }
      for (const s of (state.sessions || [])) {
        if (isInline(s.chatBg)) {
          const blob = await (await fetch(s.chatBg.value)).blob()
          const assetKey = newKey()
          await putAsset(password, assetKey, blob)
          useStore.getState().setSessionChatBg(s.id, { ...s.chatBg, assetKey, value: '' })
          migrated++
        }
      }
      localStorage.setItem('bgValueSepV1', '1')
      if (migrated > 0) console.log(`[BG-SEP] 分离了 ${migrated} 张内联背景图到 KV`)
    } catch (e) {
      console.warn('[BG-SEP] 背景分离失败（下次登录重试）:', e.message)
    }
  }

  // Pull latest cloud settings after login (startup sync), then run migration if first time
  useEffect(() => {
    if (!loggedIn) return
    const password = localStorage.getItem('auth.password')
    if (!password) { console.log('[SYNC] 无密码，跳过'); return }
    const migratedFlag = localStorage.getItem('msgSyncV1')
    console.log('[SYNC] 登录后流程开始 | msgSyncV1=', migratedFlag)
    console.log('[SYNC] 开始拉取云端配置...')
    getSettings(password)
      .then(cloud => {
        console.log('[SYNC] 云端配置拉取完成 | hasCloud=', !!cloud)
        if (cloud) {
          useStore.getState().restoreFromCloud(cloud)
          console.log('[SYNC] restoreFromCloud 完成')
        }
      })
      .catch(e => { console.warn('[SYNC] 拉取云端配置失败:', e.message) })
      .finally(async () => {
        syncReady.current = true
        const migrated = localStorage.getItem('msgSyncV1')
        console.log('[SYNC] finally: syncReady=true | msgSyncV1=', migrated)
        if (!migrated) {
          console.log('[SYNC] 首次迁移开始...')
          await runMsgMigration(password)
        } else {
          console.log('[SYNC] 跳过迁移（已迁移）')
        }
        if (!localStorage.getItem('assetSyncV1')) {
          console.log('[SYNC] 资源迁移开始...')
          await runAssetMigration(password)
        } else {
          console.log('[SYNC] 跳过资源迁移（已迁移）')
        }
        await separateInlineBgValues(password)
      })
  }, [loggedIn])

  // Pull letters (交换日记) from cloud once on login, merge into local
  useEffect(() => {
    if (!loggedIn) return
    const password = localStorage.getItem('auth.password')
    if (!password) return
    getLetters(password)
      .then(cloud => { if (cloud) mergeLetters(cloud) })
      .catch(e => console.warn('[LETTERS] 云端拉取失败:', e.message))
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

  const selectedCustomFont = customFonts?.find(f => f.id === effectiveFontFamily) ?? null

  useEffect(() => {
    const fontId = effectiveFontFamily
    const builtIn = FONT_MAP[fontId]
    const password = localStorage.getItem('auth.password')

    const run = async () => {
      // Built-in font: just set the CSS var, nothing to load.
      if (builtIn) {
        document.documentElement.style.setProperty('--app-font', builtIn)
        return
      }

      const font = selectedCustomFont
      if (!font) return

      try {
        let fontUrl = null
        if (font.assetKey) {
          fontUrl = await loadAsset(password, font.assetKey)
          console.log('[FONT INIT] loadAsset 完成, family=', font.family, '长度=', fontUrl?.length ?? 'null')
        } else {
          const blob = await getCustomFont(font.id)
          if (blob) fontUrl = URL.createObjectURL(blob)
        }

        if (!fontUrl) {
          console.warn('[FONT INIT] 无fontUrl, 放弃加载:', font.family)
          return
        }

        if (!registeredFonts.current.has(font.family)) {
          const face = new FontFace(font.family, `url(${fontUrl})`)
          await face.load()
          document.fonts.add(face)
          registeredFonts.current.add(font.family)
          console.log('[FONT INIT] FontFace 注册完成, family=', font.family)
        }

        document.documentElement.style.setProperty('--app-font', `'${font.family}', sans-serif`)
      } catch (err) {
        console.error('[FONT INIT] 加载失败:', font.family, 'name=', err?.name, 'message=', err?.message)
      }
    }

    run()
  }, [effectiveFontFamily, selectedCustomFont?.id, selectedCustomFont?.assetKey])

  useEffect(() => {
    document.documentElement.style.fontSize = `${effectiveFontSize}px`
  }, [effectiveFontSize])

  useEffect(() => {
    if (effectiveChatBg?.type !== 'image') { setBgUrl(null); return }
    const password = localStorage.getItem('auth.password')
    if (effectiveChatBg.assetKey) {
      if (!password) { setBgUrl(null); return }
      loadAsset(password, effectiveChatBg.assetKey).then(dataUrl => setBgUrl(dataUrl || null))
    } else if (effectiveChatBg.blobKey) {
      getBlob(effectiveChatBg.blobKey).then(blob => setBgUrl(blob ? URL.createObjectURL(blob) : null))
    } else if (effectiveChatBg.value) {
      setBgUrl(effectiveChatBg.value)
    } else {
      setBgUrl(null)
    }
  }, [effectiveChatBg?.assetKey, effectiveChatBg?.blobKey, effectiveChatBg?.type, effectiveChatBg?.value])

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
          {currentView === 'globalSettings' && <GlobalSettings theme={theme} onLogout={handleLogout} onForceSync={handleForceSync} />}
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

      {/* Migration progress toast (bottom-right, blue) */}
      {migrationStatus && (
        <div
          className="fixed z-50"
          style={{
            bottom: syncError ? 136 : 100, right: 16,
            background: 'rgba(60,120,220,0.92)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            color: 'white', fontSize: 12, fontWeight: 500,
            padding: '8px 14px', borderRadius: 16,
            boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
            maxWidth: 220,
          }}
        >
          {migrationStatus}
        </div>
      )}
    </div>
  )
}
