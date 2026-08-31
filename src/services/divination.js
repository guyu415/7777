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

export function tarotCardImageUrl(workerUrl, id) {
  const base = (workerUrl || '').trim().replace(/\/$/, '')
  if (!base || !id) return ''
  return `${base}/api/fortune/tarot-card/${encodeURIComponent(id)}`
}
