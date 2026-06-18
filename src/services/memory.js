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


export async function fetchMemories(endpoint) {
  try {
    const res = await fetch(`${endpoint}/list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'list_memories', arguments: {} }, id: 1 })
    })
    if (!res.ok) return []
    const data = await res.json()
    return data?.result?.content?.[0]?.text || ''
  } catch {
    return ''
  }
}

export async function saveMemory(endpoint, content) {
  try {
    const res = await fetch(`${endpoint}/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'add_memory', arguments: { content } },
        id: 2
      })
    })
    return res.ok
  } catch {
    return false
  }
}
