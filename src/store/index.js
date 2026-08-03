import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { openDB } from 'idb'

let db

async function getDB() {
  if (!db) {
    db = await openDB('pink-chat', 2, {
      upgrade(database, oldVersion) {
        if (!database.objectStoreNames.contains('messages')) {
          const store = database.createObjectStore('messages', { keyPath: 'id' })
          store.createIndex('conversationId', 'conversationId')
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
      userAvatar: '',
      aiAvatar: '',
      aiName: '',

      // Theme, background, font (global defaults)
      themeId: 'pink',
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

      currentView: 'chat',
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

      setApiKey: (key) => set({ apiKey: key }),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setModel: (model) => set({ model }),
      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
      setMemoryEnabled: (v) => set({ memoryEnabled: v }),
      setWorkerUrl: (v) => set({ workerUrl: v }),
      setUseWorkerProxy: (v) => set({ useWorkerProxy: v }),
      setUserAvatar: (v) => set({ userAvatar: v }),
      setAiAvatar: (v) => set({ aiAvatar: v }),
      setAiName: (name) => set({ aiName: name }),
      setChatTheme: (id) => set({ themeId: id }),
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
        const cleaned = { ...settings }
        if (cleaned.systemPrompt === OLD_PROMPT) cleaned.systemPrompt = ''
        if (cleaned.aiName === '小满') cleaned.aiName = ''
        if (Array.isArray(cleaned.sessions)) {
          cleaned.sessions = cleaned.sessions.map(s =>
            s.systemPrompt === OLD_PROMPT ? { ...s, systemPrompt: '' } : s
          )
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
      version: 14,
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
        userAvatar: state.userAvatar,
        aiAvatar: state.aiAvatar,
        aiName: state.aiName,
        themeId: state.themeId,
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
      }),
    }
  )
)
