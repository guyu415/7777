// 交换日记 — 信件数据层。存储已从 KV 迁移到 Google Drive（经由 Worker 的
// /diary/* 代理，浏览器不直接持有 Drive 凭证）。不再有本地 localStorage 全量
// 副本：每次都直接问 Worker 要最新一封，或按 id 按需取某一封。

const SYNC_BASE = 'https://chat.xiaoman.xyz'

function authPassword() {
  return localStorage.getItem('auth.password') || ''
}

// 最新一封（不分角色/会话）。日记信箱面板打开时用这个。
export async function getLatestLetter() {
  const password = authPassword()
  if (!password) return null
  const res = await fetch(`${SYNC_BASE}/diary/latest?password=${encodeURIComponent(password)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { letter } = await res.json()
  return letter
}

// 按 id（Drive fileId）取一封 —— 聊天里点开一张旧信件卡片时用这个，
// 不管它是不是最新的那一封。
export async function getLetterById(id) {
  const password = authPassword()
  if (!password || !id) return null
  const res = await fetch(`${SYNC_BASE}/diary/get?password=${encodeURIComponent(password)}&id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const { letter } = await res.json()
  return letter
}

// Lightweight index only (id/date/mood/weather/role, never content) for a
// given session — feeds the "you know these letters exist but not their
// content" line in the system prompt (see useChat.js). Oldest-of-the-recent-
// N first, matching the old local .slice(-5) ordering.
export async function getRecentLettersByCharacter(sessionId, limit = 5) {
  const password = authPassword()
  if (!password || !sessionId) return []
  const res = await fetch(`${SYNC_BASE}/diary/list?password=${encodeURIComponent(password)}&sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`)
  if (!res.ok) return []
  const { letters } = await res.json()
  return Array.isArray(letters) ? letters : []
}

// letter: { sessionId, role?, mood, weather, date, content }
// role 省略时 Worker 按 'user' 处理；聊天里 AI 用 [LETTER] 标签写信时显式传
// role:'ai'（cc 自己的后台/主动写信走 channel-server.ts 里独立的 VPS-key
// 通道，不经过这个函数）。返回值带 Worker 生成的 id（Drive fileId）。
export async function addLetter(letter) {
  const password = authPassword()
  if (!password) throw new Error('not logged in')
  const res = await fetch(`${SYNC_BASE}/diary/write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, ...letter }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data.letter
}
