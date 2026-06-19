export async function g1Remember(workerUrl, { subject, predicate, value }) {
  const base = (workerUrl || '').replace(/\/$/, '')
  if (!base) throw new Error('未配置 Worker 地址')
  const res = await fetch(`${base}/memory/remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, predicate, value }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return true
}

export async function fetchMemories(workerUrl, query = '') {
  try {
    const base = (workerUrl || '').replace(/\/$/, '')
    if (!base) return []
    const url = query
      ? `${base}/memory/recall?query=${encodeURIComponent(query)}`
      : `${base}/memory/recall`
    console.log('[Memory] 请求:', url)
    const res = await fetch(url)
    console.log('[Memory] 状态:', res.status)
    if (!res.ok) return []
    const data = await res.json()
    console.log('[Memory] 返回:', data)
    return Array.isArray(data) ? data : []
  } catch (e) {
    console.error('[Memory] 请求失败:', e)
    return []
  }
}

export function formatMemories(triplets) {
  if (!triplets.length) return ''
  return '【记忆库】\n' + triplets.map(t => `- ${t.subject}${t.predicate}：${t.value}`).join('\n')
}

export async function listMemories(workerUrl) {
  const base = (workerUrl || '').replace(/\/$/, '')
  if (!base) return []
  const res = await fetch(`${base}/memory/list`)
  if (!res.ok) return []
  return res.json()
}

export async function deleteMemory(workerUrl, key) {
  const base = (workerUrl || '').replace(/\/$/, '')
  const res = await fetch(`${base}/memory/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return true
}

export async function updateMemory(workerUrl, oldKey, { subject, predicate, value }) {
  const base = (workerUrl || '').replace(/\/$/, '')
  const res = await fetch(`${base}/memory/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldKey, subject, predicate, value }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return true
}
