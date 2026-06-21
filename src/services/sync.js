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
  console.log('[KEY] getSettings 实际使用的password=', password)
  const res = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=settings`)
  if (!res.ok) return null
  const { value } = await res.json()
  return value
}

export async function saveSettings(password, settings) {
  console.log('[KEY] saveSettings 实际使用的password=', password)
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

// ── Message cloud sync ────────────────────────────────────────────

export async function getSessionMsgs(password, sessionId) {
  console.log('[KEY] getSessionMsgs 实际使用的password=', password, 'sessionId=', sessionId)
  const key = `sessions:msgs:${sessionId}`
  const res = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=${encodeURIComponent(key)}`)
  if (!res.ok) return null
  const { value } = await res.json()
  return value // array or null
}

export async function saveSessionMsgs(password, sessionId, msgs) {
  console.log('[KEY] saveSessionMsgs 实际使用的password=', password, 'sessionId=', sessionId)
  const body = { password, key: `sessions:msgs:${sessionId}`, value: msgs }
  console.log('[SYNC-UP] fetch请求', 'key=', body.key, 'valueLen=', msgs.length, '请求体字节≈', JSON.stringify(body).length)
  const res = await fetch(`${SYNC_BASE}/sync/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  console.log('[SYNC-UP] 响应', 'status=', res.status, 'body=', text)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
}

export async function deleteSessionMsgs(password, sessionId) {
  const res = await fetch(`${SYNC_BASE}/sync/del`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, key: `sessions:msgs:${sessionId}` }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
