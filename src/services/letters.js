// 交换日记 — 信件数据层。与 chat/session 存储独立。
// 主存 localStorage（key=letters:all），通过现有 KV 通道同步到云端（key=letters）。
import { saveLetters } from './sync'

const STORAGE_KEY = 'letters:all'
// Soft cap (~1MB buffer under the typical 5MB localStorage quota). We only warn,
// never auto-delete — losing letters silently would be worse than a full store.
const MAX_BYTES = 4 * 1024 * 1024
// Legacy fat fields that used to embed a full base64 avatar in every letter,
// which blew up the quota (QuotaExceededError on letters:all).
const FAT_FIELDS = ['characterAvatar', 'characterName']

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

function writeAll(letters) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(letters))
}

// Fire-and-forget cloud push (no-op if not logged in)
function pushCloud() {
  const password = localStorage.getItem('auth.password')
  if (!password) return
  saveLetters(password, readAll()).catch(e => console.warn('[LETTERS] 云端同步失败:', e.message))
}

export function getAllLetters() {
  return readAll().sort((a, b) => a.createdAt - b.createdAt)
}

export function getLettersByCharacter(sessionId) {
  return getAllLetters().filter(l => l.sessionId === sessionId)
}

export function getLetterById(id) {
  return readAll().find(l => l.id === id) || null
}

// letter: Omit<Letter, 'id'|'createdAt'>
// NOTE: 不再写入 characterName / characterAvatar —— 展示侧一律按 sessionId 实时查
// session（charOf）。早期把整张 base64 头像内联进每封信，撑爆了 localStorage 配额。
// 这两个字段在 Letter 类型里保留为 optional，仅为兼容存量读取，写入时不再填值。
export function addLetter(letter) {
  const full = { ...letter, id: genId(), createdAt: Date.now() }
  const all = readAll()
  all.push(full)
  const serialized = JSON.stringify(all)
  // Capacity guard: warn (don't throw / don't auto-prune) when approaching quota.
  // length ≈ byte count for the base64-heavy worst case; good enough for a warning.
  if (serialized.length > MAX_BYTES) {
    console.warn(`[LETTERS] letters:all 体积约 ${(serialized.length / 1024 / 1024).toFixed(2)}MB 已超过 4MB 阈值，建议清理（不会自动删除信件）`)
  }
  localStorage.setItem(STORAGE_KEY, serialized)
  pushCloud()
  return full
}

// Strip legacy fat fields from a letter; returns [cleaned, bytesSaved].
function stripFat(letter) {
  let touched = false
  const cleaned = { ...letter }
  for (const f of FAT_FIELDS) {
    if (f in cleaned) { delete cleaned[f]; touched = true }
  }
  if (!touched) return [letter, 0]
  const saved = JSON.stringify(letter).length - JSON.stringify(cleaned).length
  return [cleaned, saved]
}

// Merge cloud letters into local (union by id), used on startup pull.
// Also performs a one-time cleanup: strips legacy characterAvatar/characterName
// from every letter, writes back locally, and (if anything was stripped) pushes
// the slimmed array to KV so the cloud copy stops re-bloating local on next login.
export function mergeLetters(cloudLetters) {
  const byId = new Map(readAll().map(l => [l.id, l]))
  let addedFromCloud = 0
  if (Array.isArray(cloudLetters)) {
    for (const l of cloudLetters) {
      if (l && l.id && !byId.has(l.id)) { byId.set(l.id, l); addedFromCloud++ }
    }
  }

  let strippedCount = 0
  let savedBytes = 0
  const cleaned = [...byId.values()].map(l => {
    const [c, saved] = stripFat(l)
    if (saved > 0 || c !== l) { strippedCount++; savedBytes += saved }
    return c
  }).sort((a, b) => a.createdAt - b.createdAt)

  if (addedFromCloud > 0 || strippedCount > 0) {
    writeAll(cleaned)
  }
  if (strippedCount > 0) {
    console.log(`[LETTERS] 清洗了 ${strippedCount} 条信件，节省约 ${(savedBytes / 1024).toFixed(1)} KB`)
    pushCloud() // thin the cloud copy too
  }
}
