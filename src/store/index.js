import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { openDB } from 'idb'

let db

async function getDB() {
  if (!db) {
    db = await openDB('pink-chat', 3, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        let messagesStore
        if (!database.objectStoreNames.contains('messages')) {
          messagesStore = database.createObjectStore('messages', { keyPath: 'id' })
          messagesStore.createIndex('conversationId', 'conversationId')
        } else {
          messagesStore = transaction.objectStore('messages')
        }
        // A normal CC reply may be displayed under a local id while retaining
        // the server wire ids in `wireIds`. Index those ids so reconnect
        // history can be deduplicated with one indexed lookup rather than
        // reading the entire (often very long) conversation for every item.
        if (!messagesStore.indexNames.contains('wireIds')) {
          messagesStore.createIndex('wireIds', 'wireIds', { multiEntry: true })
        }
        if (!database.objectStoreNames.contains('blobs')) {
          database.createObjectStore('blobs', { keyPath: 'id' })
        }
      },
    })
  }
  return db
}

export async function saveMessage(msg) {
  const database = await getDB()
  await database.put('messages', msg)
}

export async function getMessages(conversationId) {
  const database = await getDB()
  return database.getAllFromIndex('messages', 'conversationId', conversationId)
}

export async function getMessage(id) {
  const database = await getDB()
  return database.get('messages', id)
}

export async function hasMessageWithWireId(wireId) {
  const database = await getDB()
  return Boolean(await database.getKeyFromIndex('messages', 'wireIds', wireId))
}

export async function saveBlob(id, blob) {
  const database = await getDB()
  await database.put('blobs', { id, blob })
}

export async function getBlob(id) {
  const database = await getDB()
  const record = await database.get('blobs', id)
  return record?.blob
}

export async function saveCustomFont(fontId, blob) {
  const database = await getDB()
  await database.put('blobs', { id: `font:${fontId}`, blob })
}

export async function getCustomFont(fontId) {
  const database = await getDB()
  const record = await database.get('blobs', `font:${fontId}`)
  return record?.blob
}

export async function deleteCustomFont(fontId) {
  const database = await getDB()
  await database.delete('blobs', `font:${fontId}`)
}

// Asset data-URL cache (fonts / backgrounds), keyed by the KV assetKey.
// Stores the base64 data URL string in the existing `blobs` store so big assets
// are pulled from the Worker at most once per device, then served from IDB.
export async function saveAssetCache(assetKey, dataUrl) {
  const database = await getDB()
  await database.put('blobs', { id: `assetcache:${assetKey}`, dataUrl })
}

export async function getAssetCache(assetKey) {
  const database = await getDB()
  const record = await database.get('blobs', `assetcache:${assetKey}`)
  return record?.dataUrl || null
}

export async function deleteMessageFromDB(id) {
  const database = await getDB()
  await database.delete('messages', id)
}

export async function clearAllData() {
  const database = await getDB()
  await database.clear('messages')
  await database.clear('blobs')
}

export async function deleteMessagesForSession(conversationId) {
  const database = await getDB()
  const msgs = await database.getAllFromIndex('messages', 'conversationId', conversationId)
  for (const msg of msgs) {
    await database.delete('messages', msg.id)
  }
}

export async function getAllMessages() {
  const database = await getDB()
  return database.getAll('messages')
}

const DEFAULT_SESSIONS = [{
  id: 'main',
  name: '新对话',
  systemPrompt: '',
  createdAt: Date.now(),
  signature: '',
  // per-session overrides (null = use global default)
  themeId: null,
  chatBg: null,
  fontFamily: null,
  fontSize: null,
  memoryEnabled: null,
  apiKey: '',
  baseUrl: '',
  providerName: '',
  model: '',
  webSearch: false,
  ttsApiKey: '',
  ttsGroupId: '',
  ttsVoiceId: '',
  followGlobalTts: null,
}]

const DEFAULT_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'] },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner'] },
]

export const useStore = create(
  persist(
    (set, get) => ({
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      // 默认不带任何预设人设——用户没写系统提示词就保持空白
      systemPrompt: '',
      memoryEnabled: false,
      workerUrl: 'https://chat.xiaoman.xyz',
      useWorkerProxy: false,
      // Ordinary API proactive messages are a separate, account-wide
      // feature.  The Claude Code switch lives on the VPS; Codex is never a
      // target of this worker pipeline.  Keep the historical worker
      // behaviour (enabled) for existing users, while making it explicit and
      // independently controllable in Global Settings.
      apiProactiveEnabled: true,
      userAvatar: '',
      aiAvatar: '',
      aiName: '',

      // Theme, background, font (global defaults)
      themeId: 'pink',
      // Null follows the selected theme; a hex value overrides only text in
      // the user's own message bubbles across every single-chat theme.
      userBubbleTextColor: null,
      chatBg: { type: 'gradient', value: '', opacity: 1.0 },
      fontFamily: 'noto',
      defaultFontSize: 16,

      // Custom fonts (stored in IndexedDB, ids tracked here)
      customFonts: [],

      // TTS / AI voice
      ttsApiKey: '',
      ttsGroupId: '',
      ttsVoiceId: 'English_Trustworthy_Man',
      aiVoiceEnabled: true,
      aiVoiceFrequency: 0.5,

      // AC control
      acWorkerUrl: 'https://ac.xiaoman.xyz',

      sessions: DEFAULT_SESSIONS,
      currentSessionId: 'main',
      providers: DEFAULT_PROVIDERS,
      selectedProviderId: 'anthropic',
      selectedModelId: 'claude-sonnet-4-6',

      currentView: 'sessions',
      isLoading: false,
      streamingMessageId: null,
      summaryToast: null,
      diaryTarget: null,
      messages: [],
      // Which group chat (多AI群聊) is currently open, when currentView is
      // 'groupChat' — a real server-side id (see channel-server.ts's Group
      // chat section), never persisted alongside currentView itself (that
      // one already isn't persisted either, see partialize below — the app
      // always opens back to the plain chat view, same as before).
      currentGroupChatId: null,
      // Each group chat's OWN user avatar, keyed by group chat id — never
      // the global/per-session `userAvatar` above, and never an AI avatar
      // fallback. Persisted (see partialize below) so it survives a reload;
      // a group with no entry here just shows the neutral 🐣 placeholder,
      // same as any single-chat session with no custom user avatar set.
      groupUserAvatars: {},
      // Each group chat's OWN chat background, keyed by group chat id —
      // { type: 'image', value: dataUrl } for a custom uploaded background,
      // or absent/undefined for the default sage frosted-glass look (see
      // GroupChatWindow.jsx). Never the single-chat chatBg — independent
      // per group, never affects any single-chat window or other group.
      groupChatBg: {},
      // 每个群聊自己的剧本杀存档，按群聊 id 分开：{ [chatId]: GameState }。
      // GameState 是 mysteryEngine.js 产出的普通对象（选本、座位、章节、
      // 发言日志、票型），所以持久化就是原样存进 localStorage —— 关掉页面、
      // 刷新、换标签页回来都能接着玩。一个群聊同时只有一局；"结束本局"
      // 走 clearMysteryGame 把这条删掉。
      mysteryGames: {},
      // 斗地主/炸金花存档，和 mysteryGames 同一个模式：{ [chatId]: GameState }，
      // GameState 分别是 doudizhuEngine.js / zhajinhuaEngine.js 产出的普通
      // 对象，原样存 localStorage 即可续玩。两种扑克游戏各自独立、互不影响，
      // 也和剧本杀完全独立——一个群聊三种小游戏可以同时各有一局在进行。
      doudizhuGames: {},
      zhajinhuaGames: {},
      sichuanUpgradeGames: {},
      // Finished poker summaries wait here until the user explicitly chooses
      // to expand one into group discussion. Merely creating a summary must
      // never trigger group-model replies.
      pokerSummaries: {},
      // 全局桌宠：本质上就是当前这条会话的缩小版聊天窗，不是另开的独立
      // 会话——它始终跟随 currentSessionId。只有桌宠输入框里的真实文字
      // 对话走原会话；摸/捏/锤/拖与屏幕感知走一次性桌宠隔离线程，
      // 回复后立即销毁，不写入原聊天或任何长期模型上下文。没有自己
      // 的一套长期记忆或系统
      // 提示词。active=false 时不渲染；petImage/scale/position、batchSize
      // （攒够几次手势才真的问一次模型）、sfxEnabled（手势音效开关——应用
      // 里目前没有别的全局静音设置，这个就是桌宠这块唯一的音效控制）、
      // replyMode（回复以文字气泡还是语音播出，只影响桌宠这层展示，不动
      // 会话本身的语音设置）跨页面、刷新与设备同步。
      desktopPet: { active: false, sessionId: '', petImage: '', x: null, y: null, scale: 0.8, batchSize: 15, sfxEnabled: true, replyMode: 'text', sceneAwareness: true },

      setApiKey: (key) => set({ apiKey: key }),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setModel: (model) => set({ model }),
      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
      setMemoryEnabled: (v) => set({ memoryEnabled: v }),
      setWorkerUrl: (v) => set({ workerUrl: v }),
      setUseWorkerProxy: (v) => set({ useWorkerProxy: v }),
      setApiProactiveEnabled: (v) => set({ apiProactiveEnabled: !!v }),
      setUserAvatar: (v) => set({ userAvatar: v }),
      setAiAvatar: (v) => set({ aiAvatar: v }),
      setAiName: (name) => set({ aiName: name }),
      setChatTheme: (id) => set({ themeId: id }),
      setUserBubbleTextColor: (value) => set({ userBubbleTextColor: value }),
      setChatBg: (bg) => set({ chatBg: bg }),
      setFontFamily: (f) => set({ fontFamily: f }),
      setDefaultFontSize: (s) => set({ defaultFontSize: s }),
      setTtsApiKey: (v) => set({ ttsApiKey: v }),
      setTtsGroupId: (v) => set({ ttsGroupId: v }),
      setTtsVoiceId: (v) => set({ ttsVoiceId: v }),
      setAiVoiceEnabled: (v) => set({ aiVoiceEnabled: v }),
      setAiVoiceFrequency: (v) => set({ aiVoiceFrequency: v }),
      setAcWorkerUrl: (v) => set({ acWorkerUrl: v }),
      setCurrentView: (view) => set({ currentView: view }),
      setCurrentGroupChatId: (id) => set({ currentGroupChatId: id }),
      setDiaryTarget: (id) => set({ diaryTarget: id }),
      setIsLoading: (v) => set({ isLoading: v }),
      setStreamingMessageId: (id) => set({ streamingMessageId: id }),
      setMessages: (messages) => set({ messages }),
      addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
      updateMessage: (id, updates) => set((state) => ({
        messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
      })),
      deleteMessage: (id) => set((state) => ({
        messages: state.messages.filter(m => m.id !== id)
      })),
      deleteMessagesFrom: (id) => set((state) => {
        const idx = state.messages.findIndex(m => m.id === id)
        return idx === -1 ? {} : { messages: state.messages.slice(0, idx) }
      }),

      setCurrentSessionId: (id) => set({ currentSessionId: id }),
      addSession: (session) => set((state) => {
        const { aiName, aiAvatar, userAvatar } = state
        return {
          sessions: [...state.sessions, {
            aiName,
            aiAvatar,
            userAvatar,
            signature: '',
            themeId: null,
            chatBg: null,
            fontFamily: null,
            fontSize: null,
            memoryEnabled: null,
            apiKey: '',
            baseUrl: '',
            providerName: '',
            model: '',
            ttsApiKey: '',
            ttsGroupId: '',
            ttsVoiceId: '',
            followGlobalTts: null,
            ...session,
          }]
        }
      }),
      updateSession: (id, updates) => set((state) => ({
        sessions: state.sessions.map(s => s.id === id ? { ...s, ...updates } : s)
      })),
      deleteSession: (id) => set((state) => {
        const remaining = state.sessions.filter(s => s.id !== id)
        return {
          sessions: remaining,
          currentSessionId: state.currentSessionId === id
            ? (remaining[0]?.id || 'main')
            : state.currentSessionId,
        }
      }),

      // Per-session avatar/name/signature actions
      setSessionAiName: (sessionId, name) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, aiName: name } : s)
      })),
      setSessionAiAvatar: (sessionId, url) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, aiAvatar: url } : s)
      })),
      setSessionUserAvatar: (sessionId, url) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, userAvatar: url } : s)
      })),
      setGroupUserAvatar: (groupId, url) => set((state) => ({
        groupUserAvatars: { ...state.groupUserAvatars, [groupId]: url }
      })),
      setGroupChatBg: (groupId, bg) => set((state) => ({
        groupChatBg: { ...state.groupChatBg, [groupId]: bg }
      })),
      // Real removal (not just clearing to a falsy value) — used when a
      // group chat is deleted, so no orphaned per-group avatar/background
      // entry lingers in the store for an id that no longer exists.
      removeGroupUserAvatar: (groupId) => set((state) => {
        const { [groupId]: _removed, ...rest } = state.groupUserAvatars
        return { groupUserAvatars: rest }
      }),
      removeGroupChatBg: (groupId) => set((state) => {
        const { [groupId]: _removed, ...rest } = state.groupChatBg
        return { groupChatBg: rest }
      }),
      // 整局覆盖式写入：引擎是纯函数，每次推进都返回一个全新的 GameState，
      // 这里直接换掉那一格，不做增量合并（省得两套真相源）。
      setMysteryGame: (groupId, game) => set((state) => ({
        mysteryGames: { ...state.mysteryGames, [groupId]: game }
      })),
      clearMysteryGame: (groupId) => set((state) => {
        const { [groupId]: _removed, ...rest } = state.mysteryGames
        return { mysteryGames: rest }
      }),
      setDoudizhuGame: (groupId, game) => set((state) => ({
        doudizhuGames: { ...state.doudizhuGames, [groupId]: game }
      })),
      clearDoudizhuGame: (groupId) => set((state) => {
        const { [groupId]: _removed, ...rest } = state.doudizhuGames
        return { doudizhuGames: rest }
      }),
      setZhajinhuaGame: (groupId, game) => set((state) => ({
        zhajinhuaGames: { ...state.zhajinhuaGames, [groupId]: game }
      })),
      clearZhajinhuaGame: (groupId) => set((state) => {
        const { [groupId]: _removed, ...rest } = state.zhajinhuaGames
        return { zhajinhuaGames: rest }
      }),
      setSichuanUpgradeGame: (groupId, game) => set((state) => ({
        sichuanUpgradeGames: { ...state.sichuanUpgradeGames, [groupId]: game }
      })),
      clearSichuanUpgradeGame: (groupId) => set((state) => {
        const { [groupId]: _removed, ...rest } = state.sichuanUpgradeGames
        return { sichuanUpgradeGames: rest }
      }),
      addPokerSummary: (groupId, summary) => set((state) => {
        const current = state.pokerSummaries?.[groupId] || []
        if (current.some((item) => item.id === summary.id)) return {}
        return { pokerSummaries: { ...state.pokerSummaries, [groupId]: [...current, { ...summary, createdAt: Date.now() }].slice(-20) } }
      }),
      removePokerSummary: (groupId, summaryId) => set((state) => ({
        pokerSummaries: { ...state.pokerSummaries, [groupId]: (state.pokerSummaries?.[groupId] || []).filter((item) => item.id !== summaryId) }
      })),
      clearPokerSummaries: (groupId) => set((state) => {
        const { [groupId]: _removed, ...rest } = state.pokerSummaries || {}
        return { pokerSummaries: rest }
      }),
      updateDesktopPet: (updates) => set((state) => ({
        desktopPet: { ...state.desktopPet, ...updates },
      })),
      setSessionSignature: (sessionId, sig) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, signature: sig } : s)
      })),
      setSessionTheme: (sessionId, themeId) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, themeId } : s)
      })),
      setSessionChatBg: (sessionId, chatBg) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, chatBg } : s)
      })),
      setSessionFont: (sessionId, fontFamily) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, fontFamily } : s)
      })),
      setSessionFontSize: (sessionId, fontSize) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, fontSize } : s)
      })),
      setSessionMemoryEnabled: (sessionId, memoryEnabled) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, memoryEnabled } : s)
      })),
      setSessionSystemPrompt: (sessionId, systemPrompt) => set((state) => ({
        sessions: state.sessions.map(s => s.id === sessionId ? { ...s, systemPrompt } : s)
      })),
      setSessionApiKey: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, apiKey: v } : s) })),
      setSessionBaseUrl: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, baseUrl: v } : s) })),
      setSessionProviderName: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, providerName: v } : s) })),
      setSessionModel: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, model: v } : s) })),
      setSessionDisableThinking: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, disableThinking: v } : s) })),
      setSessionWebSearch: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, webSearch: v } : s) })),
      setSessionTtsApiKey: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, ttsApiKey: v } : s) })),
      setSessionTtsGroupId: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, ttsGroupId: v } : s) })),
      setSessionTtsVoiceId: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, ttsVoiceId: v } : s) })),
      setSessionTtsModel: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, ttsModel: v } : s) })),
      setSessionVoiceFrequency: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, voiceFrequency: v } : s) })),
      setSessionFollowGlobalTts: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, followGlobalTts: v } : s) })),
      setSessionSummary: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, summary: v } : s) })),
      setSessionSummarizedCount: (sessionId, v) => set((state) => ({ sessions: state.sessions.map(s => s.id === sessionId ? { ...s, summarizedCount: v } : s) })),
      setSummaryToast: (v) => set({ summaryToast: v }),

      // 云端旧配置可能还带着出厂预设人设（云端 blob 不经过 zustand 的 migrate），
      // 恢复时做和 v14 迁移相同的清理，防止清掉的默认人设从云端"复活"。
      restoreFromCloud: (settings) => set(() => {
        const OLD_PROMPT = '你是小满，一个温柔可爱的AI。你说话简洁、有趣，偶尔会用一些可爱的语气词。'
        const OLD_SIGNATURES = new Set(['小满一直在这里等你～', '小满一直在这里等你~'])
        const cleaned = { ...settings }
        if (cleaned.systemPrompt === OLD_PROMPT) cleaned.systemPrompt = ''
        if (cleaned.aiName === '小满') cleaned.aiName = ''
        if (Array.isArray(cleaned.sessions)) {
          cleaned.sessions = cleaned.sessions.map((session) => ({
            ...session,
            systemPrompt: session.systemPrompt === OLD_PROMPT ? '' : session.systemPrompt,
            signature: OLD_SIGNATURES.has(session.signature) ? '' : session.signature,
          }))
        }
        if (cleaned.desktopPet) {
          const pet = cleaned.desktopPet
          const rawScale = Number(pet.scale)
          const normalizedScale = [0.66, 0.8, 0.94].includes(rawScale)
            ? rawScale
            : rawScale >= 1.1 ? 0.94 : rawScale >= 0.9 ? 0.8 : 0.66
          cleaned.desktopPet = {
            ...pet,
            scale: normalizedScale,
            batchSize: [10, 15, 20].includes(pet.batchSize) ? pet.batchSize : 15,
            sceneAwareness: pet.sceneAwareness !== false,
          }
        }
        return cleaned
      }),

      addCustomFont: (font) => set((state) => ({ customFonts: [...state.customFonts, font] })),
      removeCustomFont: (id) => set((state) => ({ customFonts: state.customFonts.filter(f => f.id !== id) })),
      updateCustomFont: (id, updates) => set((state) => ({
        customFonts: state.customFonts.map(f => f.id === id ? { ...f, ...updates } : f),
      })),

      setSelectedProviderId: (id) => set({ selectedProviderId: id }),
      setSelectedModelId: (id) => set({ selectedModelId: id }),
      updateProvider: (id, updates) => set((state) => ({
        providers: state.providers.map(p => p.id === id ? { ...p, ...updates } : p)
      })),
      addProvider: (provider) => set((state) => ({ providers: [...state.providers, provider] })),
      deleteProvider: (id) => set((state) => ({ providers: state.providers.filter(p => p.id !== id) })),
    }),
    {
      name: 'pink-chat-settings',
      version: 21,
      migrate: (persisted, version) => {
        if (version < 2) {
          const providers = [
            { id: 'anthropic', name: 'Anthropic', baseUrl: persisted.apiBaseUrl || 'https://api.anthropic.com', apiKey: persisted.apiKey || '', models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'] },
            { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
            { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner'] },
          ]
          persisted = {
            ...persisted,
            providers,
            selectedProviderId: 'anthropic',
            selectedModelId: persisted.model || 'claude-sonnet-4-6',
            sessions: [{ id: 'main', name: '默认对话', systemPrompt: persisted.systemPrompt || '', createdAt: Date.now(), signature: '小满一直在这里等你～' }],
            currentSessionId: 'main',
          }
        }
        if (version < 3) {
          const urlFix = { 'https://api.openai.com': 'https://api.openai.com/v1', 'https://api.deepseek.com': 'https://api.deepseek.com/v1' }
          persisted = {
            ...persisted,
            providers: (persisted.providers || []).map(p => urlFix[p.baseUrl] ? { ...p, baseUrl: urlFix[p.baseUrl] } : p),
          }
        }
        if (version < 4) {
          persisted = {
            themeId: 'pink',
            chatBg: { type: 'gradient', value: '', opacity: 1.0 },
            fontFamily: 'noto',
            ...persisted,
            sessions: (persisted.sessions || []).map(s => ({ signature: '小满一直在这里等你～', ...s })),
          }
        }
        if (version < 5) {
          persisted = { ttsApiKey: '', ttsGroupId: '', ttsVoiceId: 'English_Trustworthy_Man', ttsAutoRead: false, ...persisted }
        }
        if (version < 6) {
          persisted = { acWorkerUrl: 'https://ac.xiaoman.xyz', ...persisted }
        }
        if (version < 7) {
          const { ttsAutoRead: _removed, ...rest } = persisted
          persisted = { aiVoiceEnabled: true, aiVoiceFrequency: 0.5, ...rest }
        }
        if (version < 8) {
          persisted = {
            useWorkerProxy: false,
            defaultFontSize: 16,
            customFonts: [],
            ...persisted,
            // Rename milktea → skyblue
            themeId: persisted.themeId === 'milktea' ? 'skyblue' : persisted.themeId,
            // Add per-session nullable overrides
            sessions: (persisted.sessions || []).map(s => ({
              themeId: null,
              chatBg: null,
              fontFamily: null,
              fontSize: null,
              memoryEnabled: null,
              ...s,
              // also migrate per-session milktea
              themeId: (s.themeId === 'milktea' ? 'skyblue' : s.themeId) ?? null,
            })),
          }
        }
        if (version < 9) {
          const providers = persisted.providers || []
          persisted = {
            ...persisted,
            sessions: (persisted.sessions || []).map(s => {
              const ep = providers.find(p => p.id === s.providerId) || providers[0]
              return {
                apiKey: ep?.apiKey || persisted.apiKey || '',
                baseUrl: ep?.baseUrl || persisted.apiBaseUrl || '',
                providerName: ep?.name || '',
                model: s.modelId || persisted.selectedModelId || persisted.model || '',
                ttsApiKey: persisted.ttsApiKey || '',
                ttsGroupId: persisted.ttsGroupId || '',
                ttsVoiceId: persisted.ttsVoiceId || '',
                ...s,
                themeId: null,
                fontFamily: null,
                fontSize: null,
              }
            }),
          }
        }
        if (version < 10) {
          persisted = {
            ...persisted,
            sessions: (persisted.sessions || []).map(s => ({ voiceFrequency: null, ...s })),
          }
        }
        if (version < 11) {
          persisted = {
            ...persisted,
            sessions: (persisted.sessions || []).map(s => ({
              // Sessions that had custom TTS keys keep them; others follow global
              followGlobalTts: (s.ttsApiKey || s.ttsGroupId || s.ttsVoiceId) ? false : null,
              ...s,
            })),
          }
        }
        if (version < 12) {
          // Migrate old *.workers.dev worker URL to custom domain
          const OLD = 'https://scheduled-message-worker.xiaoman-ac.workers.dev'
          const NEW = 'https://chat.xiaoman.xyz'
          if (persisted.workerUrl === OLD) persisted = { ...persisted, workerUrl: NEW }
        }
        if (version < 13) {
          persisted = {
            ...persisted,
            sessions: (persisted.sessions || []).map(s => ({
              summary: null,
              summarizedCount: 0,
              ...s,
            })),
          }
        }
        if (version < 14) {
          // 清掉历史遗留的"出厂预设人设"。只清和旧默认值完全一致的字段——
          // 用户自己改过的提示词/名字一律原样保留。
          const OLD_PROMPT = '你是小满，一个温柔可爱的AI。你说话简洁、有趣，偶尔会用一些可爱的语气词。'
          persisted = {
            ...persisted,
            systemPrompt: persisted.systemPrompt === OLD_PROMPT ? '' : persisted.systemPrompt,
            aiName: persisted.aiName === '小满' ? '' : persisted.aiName,
            sessions: (persisted.sessions || []).map(s => ({
              ...s,
              systemPrompt: s.systemPrompt === OLD_PROMPT ? '' : s.systemPrompt,
            })),
          }
        }
        if (version < 17) {
          // 桌宠几经改版（单例挂件 → 可抱走的会话分身 → 跟随当前会话的缩小
          // 版聊天窗 → 加音效开关与语音/文字回复模式），历史 persisted 里
          // 可能残留 sessionId/mood* 等已经没有意义的字段——统一收敛到最终
          // 形状。
          const old = persisted.desktopPet || {}
          persisted = {
            ...persisted,
            desktopPet: {
              active: !!old.active,
              sessionId: old.sessionId || '',
              petImage: old.petImage || '',
              x: old.x ?? null,
              y: old.y ?? null,
              scale: old.scale || 1,
              batchSize: old.batchSize || 5,
              sfxEnabled: old.sfxEnabled ?? true,
              replyMode: old.replyMode === 'voice' ? 'voice' : 'text',
            },
          }
        }
        if (version < 18) {
          // The old Worker pipeline had no explicit account-wide switch;
          // preserve that behaviour when hydrating existing local settings.
          persisted = { ...persisted, apiProactiveEnabled: persisted.apiProactiveEnabled !== false }
        }
        if (version < 19) {
          const oldPet = persisted.desktopPet || {}
          const oldScale = Number(oldPet.scale)
          const nextScale = oldScale >= 1.1 ? 0.94 : oldScale >= 0.9 ? 0.8 : 0.66
          persisted = {
            ...persisted,
            desktopPet: {
              ...oldPet,
              scale: nextScale,
              batchSize: [10, 15, 20].includes(oldPet.batchSize) ? oldPet.batchSize : 15,
              sceneAwareness: oldPet.sceneAwareness !== false,
            },
          }
        }
        if (version < 20) {
          // 早期出厂签名沿用了应用开发期的临时角色名“小满”。它不是用户
          // 创建的任何角色，只清理完全相同的两种旧默认值；自定义签名不动。
          const OLD_SIGNATURES = new Set(['小满一直在这里等你～', '小满一直在这里等你~'])
          persisted = {
            ...persisted,
            sessions: (persisted.sessions || []).map((session) => ({
              ...session,
              signature: OLD_SIGNATURES.has(session.signature) ? '' : session.signature,
            })),
          }
        }
        if (version < 21) {
          persisted = { userBubbleTextColor: null, ...persisted }
        }
        return persisted
      },
      partialize: (state) => ({
        apiKey: state.apiKey,
        apiBaseUrl: state.apiBaseUrl,
        model: state.model,
        systemPrompt: state.systemPrompt,
        memoryEnabled: state.memoryEnabled,
        workerUrl: state.workerUrl,
        useWorkerProxy: state.useWorkerProxy,
        apiProactiveEnabled: state.apiProactiveEnabled,
        userAvatar: state.userAvatar,
        aiAvatar: state.aiAvatar,
        aiName: state.aiName,
        themeId: state.themeId,
        userBubbleTextColor: state.userBubbleTextColor,
        chatBg: state.chatBg,
        fontFamily: state.fontFamily,
        defaultFontSize: state.defaultFontSize,
        customFonts: state.customFonts,
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
        providers: state.providers,
        selectedProviderId: state.selectedProviderId,
        selectedModelId: state.selectedModelId,
        ttsApiKey: state.ttsApiKey,
        ttsGroupId: state.ttsGroupId,
        ttsVoiceId: state.ttsVoiceId,
        aiVoiceEnabled: state.aiVoiceEnabled,
        aiVoiceFrequency: state.aiVoiceFrequency,
        acWorkerUrl: state.acWorkerUrl,
        groupUserAvatars: state.groupUserAvatars,
        groupChatBg: state.groupChatBg,
        mysteryGames: state.mysteryGames,
        doudizhuGames: state.doudizhuGames,
        zhajinhuaGames: state.zhajinhuaGames,
        sichuanUpgradeGames: state.sichuanUpgradeGames,
        pokerSummaries: state.pokerSummaries,
        desktopPet: state.desktopPet,
      }),
    }
  )
)
