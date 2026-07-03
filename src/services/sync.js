import { getAssetCache, saveAssetCache } from '../store'

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

// ── Message cloud sync ────────────────────────────────────────────

export async function getSessionMsgs(password, sessionId) {
  const key = `sessions:msgs:${sessionId}`
  const res = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=${encodeURIComponent(key)}`)
  if (!res.ok) return null
  const { value } = await res.json()
  return value // array or null
}

// 上传前剥离逐条消息里的 base64 大字段。图片以独立的 asset:img:* key 存 KV
// （见 imageAssetKey），消息数组本身保持轻量，否则整包重传会撑爆
// KV 单 value 25 MiB 上限。没有 assetKey 的旧消息原样保留，等迁移补齐。
function slimMsgsForCloud(msgs) {
  return msgs.map(m => {
    if (m.type !== 'image' || !m.imageAssetKey) return m
    const { imageUrl: _u, imageData: _d, ...rest } = m
    return rest
  })
}

export async function saveSessionMsgs(password, sessionId, msgs) {
  const body = { password, key: `sessions:msgs:${sessionId}`, value: slimMsgsForCloud(msgs) }
  const res = await fetch(`${SYNC_BASE}/sync/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`)
}

// ── Letters (交换日记) cloud sync ─────────────────────────────────

export async function getLetters(password) {
  const res = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=letters`)
  if (!res.ok) return null
  const { value } = await res.json()
  return value // array or null
}

export async function saveLetters(password, letters) {
  const res = await fetch(`${SYNC_BASE}/sync/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, key: 'letters', value: letters }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// ── Asset (KV-backed base64 data URL) ────────────────────────────

const _assetCache = new Map() // assetKey → data URL string

function _blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

// Upload a data URL string to KV directly (skips the blob round-trip)
export async function putAssetDataUrl(password, assetKey, dataUrl) {
  const res = await fetch(`${SYNC_BASE}/sync/set`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, key: assetKey, value: dataUrl }),
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`HTTP ${res.status}: ${t}`)
  }
  _assetCache.set(assetKey, dataUrl)
  return dataUrl
}

// Upload blob to KV as base64 data URL; returns the data URL for immediate use
export async function putAsset(password, assetKey, blob) {
  const dataUrl = await _blobToDataUrl(blob)
  return putAssetDataUrl(password, assetKey, dataUrl)
}

// Fetch asset data URL from KV (in-memory cached)
export async function getAssetDataUrl(password, assetKey) {
  if (_assetCache.has(assetKey)) return _assetCache.get(assetKey)
  const res = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=${encodeURIComponent(assetKey)}`)
  if (!res.ok) return null
  const { value } = await res.json()
  if (!value) return null
  _assetCache.set(assetKey, value)
  return value
}

// Lazy asset loader: IDB cache first, then a single-key KV fetch on miss.
// On a KV hit, writes through to IDB so later loads are zero-network. This is the
// path the app should use for fonts/backgrounds — never bulk-pull big assets.
export async function loadAsset(password, assetKey) {
  if (!assetKey) return null
  try {
    const cached = await getAssetCache(assetKey)
    if (cached) {
      _assetCache.set(assetKey, cached)
      return cached
    }
  } catch (e) {
    console.warn('[ASSET] IDB缓存读取失败:', e.message)
  }
  const dataUrl = await getAssetDataUrl(password, assetKey)
  if (dataUrl) {
    try { await saveAssetCache(assetKey, dataUrl) } catch (e) { console.warn('[ASSET] IDB缓存写入失败:', e.message) }
  }
  return dataUrl
}

export async function deleteAsset(password, assetKey) {
  _assetCache.delete(assetKey)
  const res = await fetch(`${SYNC_BASE}/sync/del`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, key: assetKey }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export async function deleteSessionMsgs(password, sessionId) {
  const res = await fetch(`${SYNC_BASE}/sync/del`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, key: `sessions:msgs:${sessionId}` }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}
