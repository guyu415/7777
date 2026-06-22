// 交换日记 — 信件数据层。与 chat/session 存储独立。
// 主存 localStorage（key=letters:all），通过现有 KV 通道同步到云端（key=letters）。
import { saveLetters } from './sync'

const STORAGE_KEY = 'letters:all'

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
export function addLetter(letter) {
  const full = { ...letter, id: genId(), createdAt: Date.now() }
  const all = readAll()
  all.push(full)
  writeAll(all)
  pushCloud()
  return full
}

// Merge cloud letters into local (union by id), used on startup pull
export function mergeLetters(cloudLetters) {
  if (!Array.isArray(cloudLetters) || cloudLetters.length === 0) return
  const local = readAll()
  const byId = new Map(local.map(l => [l.id, l]))
  for (const l of cloudLetters) {
    if (l && l.id && !byId.has(l.id)) byId.set(l.id, l)
  }
  writeAll([...byId.values()].sort((a, b) => a.createdAt - b.createdAt))
}
