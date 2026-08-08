import { useEffect, useState, useRef } from 'react'
import { useStore, getCustomFont, getBlob, getMessages, saveMessage, saveBlob, deleteMessagesForSession } from './store'
import { THEMES } from './themes'
import ChatWindow from './components/Chat/ChatWindow'
import GroupChatWindow from './components/GroupChat/GroupChatWindow'
import GlobalSettings from './components/GlobalSettings'
import SessionSettings from './components/SessionSettings'
import SessionList from './components/SessionList'
import BottomNav from './components/BottomNav'
import LoginPage from './components/LoginPage'
import VoiceFavorites from './components/VoiceFavorites'
import CompanionMemory from './components/CompanionMemory'
import TidalMemory from './components/TidalMemory'
import CodexMemory from './components/CodexMemory'
import DesktopPet from './components/DesktopPet'
import { getSettings, saveSettings, extractSettings, saveSessionMsgs, deleteSessionMsgs, putAsset, putAssetDataUrl, loadAsset, getLetters } from './services/sync'
import { mergeLetters } from './services/letters'
import { compressImage, slimSettings } from './utils/image'
import { ensureConnected as ensureCompanionConnected, getAuthStatus as getCompanionAuthStatus, onProactiveMessage, onCcReset } from './services/companion'
import { fetchTTSAudio } from './services/tts'

const FONT_MAP = {
  noto: "'Noto Sans SC', 'PingFang SC', -apple-system, sans-serif",
  zcool: "'ZCOOL XiaoWei', serif",
  mashan: "'Ma Shan Zheng', cursive",
}

// 用于「settings 是否真的变了」的对比指纹。lastMsgTime/lastMsgPreview 每条消息都在变，
// 如果不剔除，聊天全程每轮都会触发一次整包 settings 上传，白白消耗 KV 每天
// 1000 次的写入配额。这两个字段只影响会话列表排序展示，跟着下一次真实变更捎带上传即可。
function settingsFingerprint(settings) {
  return JSON.stringify({
    ...settings,
    sessions: (settings.sessions || []).map(({ lastMsgTime: _t, lastMsgPreview: _p, ...s }) => s),
  })
}

export default function App() {
  const {
    currentView, setCurrentView,
    setCurrentSessionId,
    currentGroupChatId, setCurrentGroupChatId,
    themeId: globalThemeId,
    chatBg: globalChatBg,
    fontFamily: globalFontFamily,
    defaultFontSize,
    customFonts,
    sessions, currentSessionId,
  } = useStore()

  // Web Push notifications carry the session that generated the message.
  // Older notifications only opened `/`, which focused whichever window was
  // already selected (often Codex) and made a valid ordinary-session
  // message look missing.  Navigate explicitly before rendering the chat.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const source = params.get('source')
    let targetId = null
    if (source === 'api-proactive') {
      targetId = params.get('session')
    } else if (source === 'cc-proactive') {
      targetId = sessions?.find(s => s.providerName === 'claude-code-vps')?.id || null
    } else {
      return
    }
    if (!targetId || !sessions?.some(s => s.id === targetId)) return
    setCurrentSessionId(targetId)
    setCurrentView('chat')
    params.delete('session')
    params.delete('source')
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
    window.history.replaceState({}, '', next)
  }, [sessions, setCurrentSessionId, setCurrentView])

  // ── Auth ───────────────────────────────────────────────────────
  const [loggedIn, setLoggedIn] = useState(() => !!localStorage.getItem('auth.password'))
  const [syncError, setSyncError] = useState(null)
  const [migrationStatus, setMigrationStatus] = useState(null)
  const syncReady = useRef(false)
  const syncTimer = useRef(null)
  const lastSyncedSettings = useRef('')
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

  // One-time migration: legacy image messages carry full-resolution base64 inline,
  // which rides along in every sessions:msgs:* upload. Compress each one, move the
  // bytes to an asset:img:* KV key, then re-upload the (now slim) message arrays.
  // Flag is only set when every image succeeded, so failures retry next login.
  const runImageAssetMigration = async (password) => {
    if (localStorage.getItem('imgAssetV1')) return
    const { sessions: allSessions, currentSessionId } = useStore.getState()
    let failures = 0
    let scanned = 0
    try {
      for (const session of (allSessions || [])) {
        const msgs = await getMessages(session.id)
        scanned += msgs.length
        const legacy = msgs.filter(m => m.type === 'image' && !m.imageAssetKey && (m.imageUrl || m.imageData))
        if (!legacy.length) continue
        let done = 0
        let migrated = 0
        for (const m of legacy) {
          done++
          setMigrationStatus(`正在压缩历史图片 ${done}/${legacy.length}`)
          try {
            const src = m.imageUrl || `data:${m.imageType || 'image/jpeg'};base64,${m.imageData}`
            const { dataUrl, base64, mimeType } = await compressImage(src, { maxDim: 1280, quality: 0.8 })
            const assetKey = `asset:img:${m.id}`
            await putAssetDataUrl(password, assetKey, dataUrl)
            await saveMessage({ ...m, imageAssetKey: assetKey, imageUrl: dataUrl, imageData: base64, imageType: mimeType })
            migrated++
          } catch (e) {
            failures++
            console.warn('[IMG-MIGRATE] 失败:', m.id, e.message)
          }
        }
        if (migrated > 0) {
          // Re-upload this session's msgs so the fat KV value is replaced by the slim one
          try {
            const fresh = await getMessages(session.id)
            fresh.sort((a, b) => a.timestamp - b.timestamp)
            await saveSessionMsgs(password, session.id, fresh)
            if (session.id === currentSessionId) useStore.getState().setMessages(fresh)
          } catch (e) {
            failures++
            console.warn('[IMG-MIGRATE] 会话上传失败:', session.id, e.message)
          }
        }
      }
    } finally {
      setMigrationStatus(null)
    }
    // 本地一条消息都没有（新设备刚登录、历史还没从云端拉下来）时不落标记，
    // 等用户打开会话把云端消息拉进 IDB 后，下次启动再真正执行迁移
    if (failures === 0 && scanned > 0) localStorage.setItem('imgAssetV1', '1')
    console.log('[IMG-MIGRATE] 完成 | 扫描消息数=', scanned, '| 失败数=', failures)
  }

  // One-time cleanup: recompress oversized inline avatars (global + per-session).
  // They live inside the synced `settings` blob, so every settings upload used to
  // carry them at full resolution.
  const slimAvatars = async () => {
    if (localStorage.getItem('avatarSlimV1')) return
    const LIMIT = 60_000 // data URL 字符数 ≈ 45KB 二进制
    const slimOne = async (v) => {
      if (!v || typeof v !== 'string' || !v.startsWith('data:image/') || v.length <= LIMIT) return null
      try {
        const { dataUrl } = await compressImage(v, { maxDim: 384, quality: 0.82 })
        return dataUrl.length < v.length ? dataUrl : null
      } catch { return null }
    }
    const state = useStore.getState()
    const g1 = await slimOne(state.userAvatar)
    if (g1) state.setUserAvatar(g1)
    const g2 = await slimOne(state.aiAvatar)
    if (g2) state.setAiAvatar(g2)
    for (const s of (state.sessions || [])) {
      const a1 = await slimOne(s.aiAvatar)
      if (a1) useStore.getState().setSessionAiAvatar(s.id, a1)
      const a2 = await slimOne(s.userAvatar)
      if (a2) useStore.getState().setSessionUserAvatar(s.id, a2)
    }
    localStorage.setItem('avatarSlimV1', '1')
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
      .then(async cloud => {
        console.log('[SYNC] 云端配置拉取完成 | hasCloud=', !!cloud)
        if (cloud) {
          // 云端可能还是旧版的"胖配置"，先压小再入库，避免 localStorage 爆容量
          const { settings: slimmed, changed } = await slimSettings(cloud)
          try {
            useStore.getState().restoreFromCloud(slimmed)
          } catch (e) {
            console.warn('[SYNC] 本地持久化失败（配置已在内存生效）:', e.message)
          }
          // 刚恢复的状态和云端一致，记为已同步基线，避免启动后无意义的整包回传
          lastSyncedSettings.current = settingsFingerprint(extractSettings(useStore.getState()))
          if (changed) {
            // 云端还是胖版本：立刻把瘦身后的写回去，之后所有设备直接拉到瘦版本
            try {
              await saveSettings(password, extractSettings(useStore.getState()))
              console.log('[SYNC] 瘦身后的配置已回传云端')
            } catch (e) {
              console.warn('[SYNC] 瘦身配置回传失败（下次启动重试）:', e.message)
            }
          }
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
        await runImageAssetMigration(password)
        await slimAvatars()
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
        const fingerprint = settingsFingerprint(settings)
        if (fingerprint === lastSyncedSettings.current) return
        try {
          await saveSettings(password, settings)
          lastSyncedSettings.current = fingerprint
        } catch {
          setSyncError('云端同步失败，将在下次自动重试')
          setTimeout(() => setSyncError(null), 3000)
        }
      }, 2000)
    })

    // 修复"改完设置马上刷新就丢"：2s 防抖窗口内刷新/关页，云端还是旧配置，
    // 下次启动的云端拉取会用旧配置覆盖本地刚改的值。页面隐藏时立即抢发一次
    // （keepalive 让请求在页面卸载后也能送达）。
    const flushOnHide = (e) => {
      if (e?.type !== 'pagehide' && document.visibilityState !== 'hidden') return
      if (!syncReady.current) return
      const password = localStorage.getItem('auth.password')
      if (!password) return
      const settings = extractSettings(useStore.getState())
      const fingerprint = settingsFingerprint(settings)
      if (fingerprint === lastSyncedSettings.current) return
      clearTimeout(syncTimer.current)
      lastSyncedSettings.current = fingerprint // 乐观标记，避免 pagehide 后重复发
      try {
        fetch('https://chat.xiaoman.xyz/sync/set', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, key: 'settings', value: settings }),
          keepalive: true,
        }).catch(() => {})
      } catch {
        // keepalive 不可用时只能靠下一次防抖同步
      }
    }
    document.addEventListener('visibilitychange', flushOnHide)
    window.addEventListener('pagehide', flushOnHide)
    return () => {
      unsub()
      clearTimeout(syncTimer.current)
      document.removeEventListener('visibilitychange', flushOnHide)
      window.removeEventListener('pagehide', flushOnHide)
    }
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

  // Keep the companion WS alive whenever a VPS-bound session exists, not
  // just while the user is actively sending — proactive messages can arrive
  // with no user action to lazily trigger a connection otherwise.
  useEffect(() => {
    const vpsSession = sessions?.find(s => s.providerName === 'claude-code-vps')
    if (!vpsSession) return
    let cancelled = false
    getCompanionAuthStatus().then(({ loggedIn: companionLoggedIn }) => {
      if (!cancelled && companionLoggedIn) ensureCompanionConnected()
    })
    return () => { cancelled = true }
  }, [sessions])

  // Proactive (VPS-initiated) messages: land only in the single VPS-bound
  // session's real message store, deduped by Wire.id against what's already
  // in IndexedDB (survives page reloads, unlike the in-memory dedup cache in
  // companion.js which resets per page load). Never fabricates a user
  // bubble or a sendMessage() call — this only ever appends an assistant
  // (from:'cc') message.
  //
  // Gomoku's in-game chat (including a gomoku-triggered CC turn's own
  // reply/send_voice calls) never reaches this listener at all — it's routed
  // server-side into the game's own persisted `messages` log (see
  // GomokuBoard.jsx's onGomokuUpdate subscription), not broadcast as a main
  // chat wire `msg` in the first place, so there's nothing to skip here.
  useEffect(() => {
    const unsub = onProactiveMessage(async ({ id, text, ts, kind, voice, thinking }) => {
      const vpsSession = useStore.getState().sessions?.find(s => s.providerName === 'claude-code-vps')
      if (!vpsSession) return
      const existing = await getMessages(vpsSession.id)
      // A live-delivered turn saves its bubbles under local ids but records
      // the server wire ids it displayed in `wireIds` — check both, otherwise
      // every reconnect's history snapshot re-appends replies this browser
      // already showed live.
      if (existing.some(m => m.id === id || (Array.isArray(m.wireIds) && m.wireIds.includes(id)))) return
      const reasoningFields = thinking ? { reasoning: thinking, reasoningStreaming: false } : {}

      if (kind === 'voice') {
        const s = useStore.getState()
        const ttsApiKey = vpsSession.ttsApiKey || s.ttsApiKey
        const ttsGroupId = vpsSession.ttsGroupId || s.ttsGroupId
        const ttsVoiceId = vpsSession.ttsVoiceId || s.ttsVoiceId
        const ttsModel = vpsSession.ttsModel || s.ttsModel
        const hasTts = ttsApiKey && ttsGroupId
        if (!hasTts) {
          const msg = { id, conversationId: vpsSession.id, role: 'assistant', type: 'text', content: text, voiceText: text, voiceFailed: true, timestamp: ts, streaming: false, source: 'cc-proactive', ...reasoningFields }
          await saveMessage(msg)
          if (useStore.getState().currentSessionId === vpsSession.id) useStore.getState().addMessage(msg)
          return
        }
        try {
          const blob = await fetchTTSAudio(text, { apiKey: ttsApiKey, groupId: ttsGroupId, voiceId: voice || ttsVoiceId || 'English_Trustworthy_Man', model: ttsModel })
          let duration = 0
          try {
            const ab = await blob.arrayBuffer()
            const ac = new AudioContext()
            const decoded = await ac.decodeAudioData(ab)
            duration = Math.round(decoded.duration)
            ac.close()
          } catch {}
          const voiceBlobId = id + '-blob'
          await saveBlob(voiceBlobId, blob)
          const msg = { id, conversationId: vpsSession.id, role: 'assistant', type: 'voice', voiceBlobId, duration, content: '', voiceText: text, timestamp: ts, streaming: false, source: 'cc-proactive', ...reasoningFields }
          await saveMessage(msg)
          if (useStore.getState().currentSessionId === vpsSession.id) useStore.getState().addMessage(msg)
        } catch (e) {
          console.error('[PROACTIVE-VOICE] 合成失败:', e?.message)
          const msg = { id, conversationId: vpsSession.id, role: 'assistant', type: 'text', content: text, voiceText: text, voiceFailed: true, timestamp: ts, streaming: false, source: 'cc-proactive', ...reasoningFields }
          await saveMessage(msg)
          if (useStore.getState().currentSessionId === vpsSession.id) useStore.getState().addMessage(msg)
        }
        return
      }

      const msg = { id, conversationId: vpsSession.id, role: 'assistant', type: 'text', content: text, timestamp: ts, streaming: false, source: 'cc-proactive', ...reasoningFields }
      await saveMessage(msg)
      if (useStore.getState().currentSessionId === vpsSession.id) {
        useStore.getState().addMessage(msg)
      }
    })
    return unsub
  }, [])

  // CC context reset: the server clears its own history and genuinely
  // resets the VPS Claude Code session's context via /cc/reset; this side
  // just needs to make the local copy match. Fires for the tab that
  // triggered the reset (live broadcast), every other open tab (live
  // broadcast), and any tab that reconnects/reloads afterward and only
  // then discovers it happened (resetAt comparison — see onCcReset in
  // companion.js). Only ever touches the single VPS-bound session.
  useEffect(() => {
    const unsub = onCcReset(async () => {
      const vpsSession = useStore.getState().sessions?.find(s => s.providerName === 'claude-code-vps')
      if (!vpsSession) return
      await deleteMessagesForSession(vpsSession.id)
      // The cloud KV copy must go too — useChat's scheduleMsgSync uploads
      // this session's messages after every turn, and loadHistory re-pulls
      // the cloud copy (and re-saves it into IndexedDB) whenever local
      // storage is empty, which is exactly the state this handler just
      // created. Without this, "清空上下文" looked like a no-op: the next
      // loadHistory resurrected the entire conversation.
      const password = localStorage.getItem('auth.password')
      if (password) {
        try {
          await deleteSessionMsgs(password, vpsSession.id)
        } catch (e) {
          console.warn('[CC-RESET] 云端消息副本删除失败（下次 loadHistory 可能拉回旧记录）:', e.message)
        }
      }
      useStore.getState().updateSession(vpsSession.id, { lastMsgPreview: '', lastMsgTime: null })
      if (useStore.getState().currentSessionId === vpsSession.id) {
        useStore.getState().setMessages([])
      }
    })
    return unsub
  }, [])

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
          {/* One shared window for every provider (Claude Code VPS, Codex
              VPS, plain API-key) — ChatWindow.jsx itself picks the right
              runtime adapter internally, see its own top-of-file comment. */}
          {currentView === 'chat' && <ChatWindow theme={theme} />}
          {currentView === 'groupChat' && currentGroupChatId && (
            <GroupChatWindow theme={theme} chatId={currentGroupChatId} onClose={() => setCurrentView('sessions')} />
          )}
          {currentView === 'sessions' && (
            <SessionList
              theme={theme}
              onSelectSession={() => setCurrentView('chat')}
              onOpenGroupChat={(id) => { setCurrentGroupChatId(id); setCurrentView('groupChat') }}
            />
          )}
          {currentView === 'globalSettings' && <GlobalSettings theme={theme} onLogout={handleLogout} onForceSync={handleForceSync} />}
          {currentView === 'sessionSettings' && <SessionSettings theme={theme} />}
          {currentView === 'voiceFavorites' && <VoiceFavorites theme={theme} />}
          {currentView === 'companionMemory' && <CompanionMemory theme={theme} onBack={() => setCurrentView('sessionSettings')} />}
          {currentView === 'tidalMemory' && <TidalMemory theme={theme} onBack={() => setCurrentView('sessionSettings')} />}
          {currentView === 'codexMemory' && <CodexMemory theme={theme} onBack={() => setCurrentView('sessionSettings')} />}
        </div>

        {currentView !== 'sessionSettings' && currentView !== 'voiceFavorites' && currentView !== 'chat' && currentView !== 'companionMemory' && currentView !== 'codexMemory' && currentView !== 'tidalMemory' && currentView !== 'groupChat' && (
          <BottomNav currentView={currentView} onChange={setCurrentView} theme={theme} />
        )}
      </div>

      {/* 同一只桌宠跨私聊、群聊和牌桌保留位置与绑定身份。 */}
      <DesktopPet theme={theme} />

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
