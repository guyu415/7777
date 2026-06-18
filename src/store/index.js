import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { openDB } from 'idb'

// IndexedDB for messages (handles large blobs like images/audio)
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

// Zustand store for settings and UI state
export const useStore = create(
  persist(
    (set, get) => ({
      // Settings
      apiKey: '',
      apiBaseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
      systemPrompt: '你是小漫，一个温柔可爱的AI助手。你说话简洁、有趣，偶尔会用一些可爱的语气词。',
      memoryEnabled: false,
      memoryEndpoint: 'https://memory.xiaoman.xyz',

      // UI State
      currentView: 'chat', // 'chat' | 'settings'
      isLoading: false,
      streamingMessageId: null,

      // Messages in memory (subset, full history in IDB)
      messages: [],

      setApiKey: (key) => set({ apiKey: key }),
      setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
      setModel: (model) => set({ model }),
      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
      setMemoryEnabled: (v) => set({ memoryEnabled: v }),
      setMemoryEndpoint: (v) => set({ memoryEndpoint: v }),
      setCurrentView: (view) => set({ currentView: view }),
      setIsLoading: (v) => set({ isLoading: v }),
      setStreamingMessageId: (id) => set({ streamingMessageId: id }),
      setMessages: (messages) => set({ messages }),
      addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
      updateMessage: (id, updates) => set((state) => ({
        messages: state.messages.map(m => m.id === id ? { ...m, ...updates } : m)
      })),
    }),
    {
      name: 'pink-chat-settings',
      partialize: (state) => ({
        apiKey: state.apiKey,
        apiBaseUrl: state.apiBaseUrl,
        model: state.model,
        systemPrompt: state.systemPrompt,
        memoryEnabled: state.memoryEnabled,
        memoryEndpoint: state.memoryEndpoint,
      }),
    }
  )
)
