function baseUrl(workerUrl) {
  const base = (workerUrl || '').trim().replace(/\/$/, '')
  if (!base) throw new Error('未配置 Worker 地址')
  return base
}

async function fortuneFetch(workerUrl, path, init = {}) {
  const password = localStorage.getItem('auth.password') || ''
  if (!password) throw new Error('请先登录 Eunoia')
  const headers = new Headers(init.headers || {})
  headers.set('X-Eunoia-Password', password)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${baseUrl(workerUrl)}${path}`, { ...init, headers, cache: 'no-store' })
  let body = null
  try { body = await response.json() } catch { /* ignored */ }
  if (!response.ok) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

export function rollFortune(workerUrl, input) {
  return fortuneFetch(workerUrl, '/api/fortune/roll', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listFortuneSessions(workerUrl, count = 8) {
  return fortuneFetch(workerUrl, `/api/fortune/recent?n=${encodeURIComponent(count)}`)
}

export function getFortuneSession(workerUrl, id) {
  return fortuneFetch(workerUrl, `/api/fortune/session/${encodeURIComponent(id)}`)
}

export function saveFortuneVerdict(workerUrl, id, verdict) {
  return fortuneFetch(workerUrl, '/api/fortune/verdict', {
    method: 'POST',
    body: JSON.stringify({ id, verdict }),
  })
}

const RWS_MAJOR = [
  'RWS_Tarot_00_Fool.jpg',
  'RWS_Tarot_01_Magician.jpg',
  'RWS_Tarot_02_High_Priestess.jpg',
  'RWS_Tarot_03_Empress.jpg',
  'RWS_Tarot_04_Emperor.jpg',
  'RWS_Tarot_05_Hierophant.jpg',
  'RWS_Tarot_06_Lovers.jpg',
  'RWS_Tarot_07_Chariot.jpg',
  'RWS_Tarot_08_Strength.jpg',
  'RWS_Tarot_09_Hermit.jpg',
  'RWS_Tarot_10_Wheel_of_Fortune.jpg',
  'RWS_Tarot_11_Justice.jpg',
  'RWS_Tarot_12_Hanged_Man.jpg',
  'RWS_Tarot_13_Death.jpg',
  'RWS_Tarot_14_Temperance.jpg',
  'RWS_Tarot_15_Devil.jpg',
  'RWS_Tarot_16_Tower.jpg',
  'RWS_Tarot_17_Star.jpg',
  'RWS_Tarot_18_Moon.jpg',
  'RWS_Tarot_19_Sun.jpg',
  'RWS_Tarot_20_Judgement.jpg',
  'RWS_Tarot_21_World.jpg',
]

const RWS_ROOT = 'https://raw.githubusercontent.com/Zailef/whispers-of-the-carnival/main/textures/tarot_cards'

export function tarotCardImageUrl(_workerUrl, id) {
  const value = String(id || '').trim().toLowerCase()
  const major = value.match(/^major(\d{2})$/)
  if (major) {
    const index = Number(major[1])
    const file = RWS_MAJOR[index]
    return file ? `${RWS_ROOT}/major/${file}` : ''
  }

  const minor = value.match(/^(cups|wands|swords|pentacles)(\d{2})$/)
  if (!minor) return ''
  const rank = Number(minor[2])
  if (rank < 1 || rank > 14) return ''
  const dir = minor[1]
  const prefix = dir === 'cups' ? 'Cups' : dir === 'wands' ? 'Wands' : dir === 'swords' ? 'Swords' : 'Pents'
  return `${RWS_ROOT}/${dir}/${prefix}${String(rank).padStart(2, '0')}.jpg`
}
