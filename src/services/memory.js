// MCP memory client for memory.xiaoman.xyz

export async function g1Remember(endpoint, { subject, predicate, value }) {
  const base = (endpoint || 'https://memory.xiaoman.xyz').replace(/\/$/, '')
  const res = await fetch(`${base}/g1_remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, predicate, value }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return true
}


export async function fetchMemories(endpoint, query = '') {
  try {
    const base = (endpoint || 'https://memory.xiaoman.xyz').replace(/\/$/, '')
    const url = query
      ? `${base}/g1_recall?query=${encodeURIComponent(query)}`
      : `${base}/g1_recall`
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
  return '[记忆]\n' + triplets.map(t => `${t.subject} ${t.predicate} ${t.value}`).join('\n')
}
