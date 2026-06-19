const MODE_MAP = { cool: 0, heat: 1, auto: 2, fan: 3, dry: 4 }
const WIND_MAP = { auto: 0, low: 1, mid: 2, high: 3 }
const KEY = 'xiaoman2026'

function url(base, path, params = {}) {
  const u = new URL(path, base)
  u.searchParams.set('key', KEY)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

async function get(endpoint) {
  const res = await fetch(endpoint)
  if (!res.ok) throw new Error(`AC API ${res.status}`)
}

export async function acOn(base, temp = 26, mode = 'cool', wind = 'auto') {
  await get(url(base, '/ac/on'))
  // On alone: also set params
  await get(url(base, '/ac/set', {
    temp: String(temp),
    mode: String(MODE_MAP[mode] ?? 0),
    wind: String(WIND_MAP[wind] ?? 0),
  }))
}

export async function acOff(base) {
  await get(url(base, '/ac/off'))
}

export async function acSet(base, temp = 26, mode = 'cool', wind = 'auto') {
  await get(url(base, '/ac/set', {
    temp: String(temp),
    mode: String(MODE_MAP[mode] ?? 0),
    wind: String(WIND_MAP[wind] ?? 0),
  }))
}

export async function executeAcCommand(base, action, temp, mode, wind) {
  const b = (base || 'https://ac.xiaoman.xyz').replace(/\/$/, '')
  if (action === 'on') return acOn(b, temp || 26, mode || 'cool', wind || 'auto')
  if (action === 'off') return acOff(b)
  if (action === 'set') return acSet(b, temp || 26, mode || 'cool', wind || 'auto')
  throw new Error(`Unknown AC action: ${action}`)
}

export const MODE_LABELS = { cool: '制冷', heat: '制热', auto: '自动', fan: '送风', dry: '除湿' }
export const WIND_LABELS = { auto: '自动', low: '低速', mid: '中速', high: '高速' }
