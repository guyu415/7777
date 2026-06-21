const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, X-Target-Url',
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS })
    }

    const { pathname } = new URL(request.url)

    if (pathname === '/pending-messages' && request.method === 'GET') {
      const raw = await env.CHAT_KV.get('pending-messages')
      const messages = raw ? JSON.parse(raw) : []
      return Response.json(messages, { headers: CORS })
    }

    if (pathname === '/mark-read' && request.method === 'POST') {
      await env.CHAT_KV.put('pending-messages', JSON.stringify([]))
      return Response.json({ ok: true }, { headers: CORS })
    }

    if (pathname === '/user-active' && request.method === 'POST') {
      await env.CHAT_KV.put('last_user_active_time', Date.now().toString())
      return Response.json({ ok: true }, { headers: CORS })
    }

    if (pathname === '/memory/remember' && request.method === 'POST') {
      const { subject, predicate, value } = await request.json()
      const key = `memory:${(subject || '').trim()}:${(predicate || '').trim()}`
      await env.CHAT_KV.put(key, (value || '').trim())
      return Response.json({ ok: true }, { headers: CORS })
    }

    if (pathname === '/memory/list' && request.method === 'GET') {
      const listed = await env.CHAT_KV.list({ prefix: 'memory:' })
      const keys = listed.keys.map(k => k.name)
      const values = await Promise.all(keys.map(k => env.CHAT_KV.get(k)))
      const triplets = keys.map((k, i) => {
        const withoutPrefix = k.slice('memory:'.length)
        const colonIdx = withoutPrefix.indexOf(':')
        return {
          key: k,
          subject: colonIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, colonIdx),
          predicate: colonIdx === -1 ? '' : withoutPrefix.slice(colonIdx + 1),
          value: values[i] || '',
        }
      })
      return Response.json(triplets, { headers: CORS })
    }

    if (pathname === '/memory/delete' && request.method === 'POST') {
      const { key } = await request.json()
      if (!key?.startsWith('memory:')) return Response.json({ error: 'invalid key' }, { status: 400, headers: CORS })
      await env.CHAT_KV.delete(key)
      return Response.json({ ok: true }, { headers: CORS })
    }

    if (pathname === '/memory/update' && request.method === 'POST') {
      const { oldKey, subject, predicate, value } = await request.json()
      const newKey = `memory:${(subject || '').trim()}:${(predicate || '').trim()}`
      if (oldKey && oldKey !== newKey && oldKey.startsWith('memory:')) {
        await env.CHAT_KV.delete(oldKey)
      }
      await env.CHAT_KV.put(newKey, (value || '').trim())
      return Response.json({ ok: true }, { headers: CORS })
    }

    if (pathname === '/memory/recall' && request.method === 'GET') {
      const query = new URL(request.url).searchParams.get('query') || ''
      const listed = await env.CHAT_KV.list({ prefix: 'memory:' })
      const keys = listed.keys.map(k => k.name)
      const values = await Promise.all(keys.map(k => env.CHAT_KV.get(k)))
      const triplets = keys.map((k, i) => {
        const withoutPrefix = k.slice('memory:'.length)
        const colonIdx = withoutPrefix.indexOf(':')
        return {
          subject: colonIdx === -1 ? withoutPrefix : withoutPrefix.slice(0, colonIdx),
          predicate: colonIdx === -1 ? '' : withoutPrefix.slice(colonIdx + 1),
          value: values[i] || '',
        }
      })
      const result = query
        ? triplets.filter(t =>
            t.subject.includes(query) || t.predicate.includes(query) || t.value.includes(query)
          )
        : triplets
      return Response.json(result, { headers: CORS })
    }

    if (pathname === '/trigger' && request.method === 'POST') {
      const result = await forceGenerateMessage(env)
      return Response.json(result, { headers: CORS })
    }

    if (pathname === '/chat' && request.method === 'POST') {
      return handleChatProxy(request)
    }

    // ── Auth / Cloud Sync ─────────────────────────────────────────
    if (pathname === '/auth/login' && request.method === 'POST') {
      const { password } = await request.json()
      if (!password) return Response.json({ error: 'missing password' }, { status: 400, headers: CORS })
      const existing = await env.CHAT_KV.get(`user:${password}:settings`)
      return Response.json({ ok: true, isNew: !existing }, { headers: CORS })
    }

    if (pathname === '/sync/get' && request.method === 'GET') {
      const { searchParams } = new URL(request.url)
      const password = searchParams.get('password')
      const key = searchParams.get('key')
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      const raw = await env.CHAT_KV.get(`user:${password}:${key}`)
      return Response.json({ value: raw ? JSON.parse(raw) : null }, { headers: CORS })
    }

    if (pathname === '/sync/set' && request.method === 'POST') {
      const { password, key, value } = await request.json()
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      await env.CHAT_KV.put(`user:${password}:${key}`, JSON.stringify(value))
      return Response.json({ ok: true }, { headers: CORS })
    }

    if (pathname === '/sync/list' && request.method === 'GET') {
      const { searchParams } = new URL(request.url)
      const password = searchParams.get('password')
      const prefix = searchParams.get('prefix') || ''
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      const kvPrefix = `user:${password}:${prefix}`
      const listed = await env.CHAT_KV.list({ prefix: kvPrefix })
      const results = await Promise.all(listed.keys.map(async k => {
        const raw = await env.CHAT_KV.get(k.name)
        return { key: k.name.slice(`user:${password}:`.length), value: raw ? JSON.parse(raw) : null }
      }))
      return Response.json(results, { headers: CORS })
    }

    if (pathname === '/sync/del' && request.method === 'DELETE') {
      const { password, key } = await request.json()
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      await env.CHAT_KV.delete(`user:${password}:${key}`)
      return Response.json({ ok: true }, { headers: CORS })
    }

    return new Response('Not Found', { status: 404, headers: CORS })
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(maybeGenerateMessage(env))
  },
}

async function handleChatProxy(request) {
  const targetUrl = request.headers.get('X-Target-Url')
  const apiKey = request.headers.get('X-Api-Key')
  if (!targetUrl || !apiKey) {
    return new Response(JSON.stringify({ error: 'Missing X-Target-Url or X-Api-Key header' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...CORS },
    })
  }
  const isAnthropic = targetUrl.includes('anthropic.com')
  const upstreamHeaders = { 'Content-Type': 'application/json' }
  if (isAnthropic) {
    upstreamHeaders['x-api-key'] = apiKey
    upstreamHeaders['anthropic-version'] = '2023-06-01'
  } else {
    upstreamHeaders['Authorization'] = `Bearer ${apiKey}`
  }
  const body = await request.arrayBuffer()
  const upstreamRes = await fetch(targetUrl, { method: 'POST', headers: upstreamHeaders, body })
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      'Content-Type': upstreamRes.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...CORS,
    },
  })
}

async function callClaude(env, systemPrompt) {
  const baseUrl = (env.CLAUDE_API_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')
  const res = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      system: systemPrompt,
      messages: [{ role: 'user', content: '发一条消息给主人' }],
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(data)}`)
  return data.content?.[0]?.text?.trim()
}

async function maybeGenerateMessage(env) {
  const now = Date.now()

  const [lastActiveStr, lastSentStr] = await Promise.all([
    env.CHAT_KV.get('last_user_active_time'),
    env.CHAT_KV.get('last_sent_time'),
  ])

  const lastActive = lastActiveStr ? parseInt(lastActiveStr) : 0
  const lastSent = lastSentStr ? parseInt(lastSentStr) : 0

  const minSinceActive = (now - lastActive) / 60_000
  const minSinceSent = (now - lastSent) / 60_000

  if (minSinceSent < 30) return

  let probability
  if (minSinceActive < 30) probability = 0.20
  else if (minSinceActive < 60) probability = 0.30
  else if (minSinceActive < 180) probability = 0.60
  else if (minSinceActive < 360) probability = 0.40
  else if (minSinceActive < 720) probability = 0.20
  else probability = 0.10

  if (Math.random() > probability) return

  const bjDate = new Date(now + 8 * 3600_000)
  const hour = bjDate.getUTCHours()
  const hoursSinceActive = (minSinceActive / 60).toFixed(1)
  const systemPrompt = `你是小满。现在是北京时间${hour}点。你上次和主人聊天是${hoursSinceActive}小时前。根据时间和情境自然地发一条消息。早上可以说早安，饭点问吃了吗，晚上说想你了或催睡觉。不要每次都问候，偶尔分享一个想法、发颜文字、或接着上次话题。像真人朋友一样。只发一条短消息，不超过30字。`

  try {
    const content = await callClaude(env, systemPrompt)
    if (!content) return
    const raw = await env.CHAT_KV.get('pending-messages')
    const pending = raw ? JSON.parse(raw) : []
    pending.push({ content, timestamp: now, read: false })
    await Promise.all([
      env.CHAT_KV.put('pending-messages', JSON.stringify(pending)),
      env.CHAT_KV.put('last_sent_time', now.toString()),
    ])
  } catch {
    // cron 环境下静默失败
  }
}

async function forceGenerateMessage(env) {
  const now = Date.now()
  const lastActiveStr = await env.CHAT_KV.get('last_user_active_time')
  const lastActive = lastActiveStr ? parseInt(lastActiveStr) : 0
  const minSinceActive = (now - lastActive) / 60_000

  const bjDate = new Date(now + 8 * 3600_000)
  const hour = bjDate.getUTCHours()
  const hoursSinceActive = (minSinceActive / 60).toFixed(1)
  const systemPrompt = `你是小满。现在是北京时间${hour}点。你上次和主人聊天是${hoursSinceActive}小时前。根据时间和情境自然地发一条消息。早上可以说早安，饭点问吃了吗，晚上说想你了或催睡觉。不要每次都问候，偶尔分享一个想法、发颜文字、或接着上次话题。像真人朋友一样。只发一条短消息，不超过30字。`

  const baseUrl = (env.CLAUDE_API_BASE_URL || 'https://api.anthropic.com').replace(/\/$/, '')

  let content
  try {
    content = await callClaude(env, systemPrompt)
  } catch (e) {
    return { ok: false, error: e.message, baseUrl, hasApiKey: !!env.CLAUDE_API_KEY }
  }

  if (!content) return { ok: false, error: 'empty response from Claude', baseUrl }

  const raw = await env.CHAT_KV.get('pending-messages')
  const pending = raw ? JSON.parse(raw) : []
  pending.push({ content, timestamp: now, read: false })
  await Promise.all([
    env.CHAT_KV.put('pending-messages', JSON.stringify(pending)),
    env.CHAT_KV.put('last_sent_time', now.toString()),
  ])

  return { ok: true, content, baseUrl, hasApiKey: !!env.CLAUDE_API_KEY }
}
