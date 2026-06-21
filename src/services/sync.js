const SYNC_BASE = 'https://chat.xiaoman.xyz'

export async function login(password) {
  const res = await fetch(`${SYNC_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function getSettings(password) {
  const res = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=settings`)
  if (!res.ok) return null
  const { value } = await res.json()
  return value
}

export async function saveSettings(password, settings) {
  const res = await fetch(`${SYNC_BASE}/sync/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, key: 'settings', value: settings }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Mirrors the store's partialize — keys that are synced to cloud
const SYNC_KEYS = [
  'apiKey', 'apiBaseUrl', 'model', 'systemPrompt', 'memoryEnabled',
  'workerUrl', 'useWorkerProxy', 'userAvatar', 'aiAvatar', 'aiName',
  'themeId', 'chatBg', 'fontFamily', 'defaultFontSize', 'customFonts',
  'sessions', 'currentSessionId', 'providers', 'selectedProviderId', 'selectedModelId',
  'ttsApiKey', 'ttsGroupId', 'ttsVoiceId', 'aiVoiceEnabled', 'aiVoiceFrequency',
  'acWorkerUrl',
]

export function extractSettings(state) {
  return Object.fromEntries(SYNC_KEYS.map(k => [k, state[k]]))
}
