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

const DEFAULT_SESSIONS = [{ id: 'main', name: '默认对话', systemPrompt: '你是小漫，一个温柔可爱的AI助手。你说话简洁、有趣，偶尔会用一些可爱的语气词。', createdAt: Date.now() }]
const DEFAULT_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiKey: '', models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'] },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner'] },
]

export const useStore = create(
  persist(
    (set, get) => ({
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      systemPrompt: '你是小漫，一个温柔可爱的AI助手。你说话简洁、有趣，偶尔会用一些可爱的语气词。',
      memoryEnabled: false,
      workerUrl: '',
      userAvatar: '',
      aiAvatar: '',
      aiName: '小漫',

      sessions: DEFAULT_SESSIONS,
      currentSessionId: 'main',
      providers: DEFAULT_PROVIDERS,
      selectedProviderId: 'anthropic',
      selectedModelId: 'claude-sonnet-4-6',

      currentView: 'chat',
      isLoading: false,
      streamingMessageId: null,
      messages: [],

      setApiKey: (key) => set({ apiKey: key }),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setModel: (model) => set({ model }),
      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
      setMemoryEnabled: (v) => set({ memoryEnabled: v }),
      setWorkerUrl: (v) => set({ workerUrl: v }),
      setUserAvatar: (v) => set({ userAvatar: v }),
      setAiAvatar: (v) => set({ aiAvatar: v }),
      setAiName: (name) => set({ aiName: name }),
      setCurrentView: (view) => set({ currentView: view }),
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
      addSession: (session) => set((state) => ({ sessions: [...state.sessions, session] })),
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
      version: 2,
      migrate: (persisted, version) => {
        if (version < 2) {
          const providers = [
            { id: 'anthropic', name: 'Anthropic', baseUrl: persisted.apiBaseUrl || 'https://api.anthropic.com', apiKey: persisted.apiKey || '', models: ['claude-sonnet-4-6', 'claude-opus-4-8', 'claude-haiku-4-5-20251001'] },
            { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', apiKey: '', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
            { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: '', models: ['deepseek-chat', 'deepseek-reasoner'] },
          ]
          return {
            ...persisted,
            providers,
            selectedProviderId: 'anthropic',
            selectedModelId: persisted.model || 'claude-sonnet-4-6',
            sessions: [{ id: 'main', name: '默认对话', systemPrompt: persisted.systemPrompt || '', createdAt: Date.now() }],
            currentSessionId: 'main',
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
        userAvatar: state.userAvatar,
        aiAvatar: state.aiAvatar,
        aiName: state.aiName,
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
        providers: state.providers,
        selectedProviderId: state.selectedProviderId,
        selectedModelId: state.selectedModelId,
      }),
    }
  )
)
