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

    if (pathname === '/trigger' && (request.method === 'GET' || request.method === 'POST')) {
      const result = await generateProactive(env, { force: true })
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
      const finalKey = `user:${password}:${key}`
      const serialized = JSON.stringify(value)
      console.log('[WORKER-SET] password前4位=', password.slice(0, 4), '| key=', key, '| valueType=', Array.isArray(value) ? 'array' : typeof value, '| valueLen=', Array.isArray(value) ? value.length : '?', '| serializedBytes=', serialized.length)
      console.log('[WORKER-SET] 写入KV finalKey=', finalKey)
      await env.CHAT_KV.put(finalKey, serialized)
      console.log('[WORKER-SET] KV写入完成')
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

    if (pathname === '/sync/debug' && request.method === 'GET') {
      const { searchParams } = new URL(request.url)
      const password = searchParams.get('password')
      // List ALL keys in the KV (no prefix filter) so we can see exactly what exists
      const listedAll = await env.CHAT_KV.list()
      console.log('[WORKER-DEBUG] KV全部keys=', listedAll.keys.map(k => k.name))
      const allKeys = await Promise.all(listedAll.keys.map(async k => {
        const raw = await env.CHAT_KV.get(k.name)
        return { rawKey: k.name, size: raw ? raw.length : 0 }
      }))
      // Also filter to user prefix if password provided
      const prefix = password ? `user:${password}:` : null
      console.log('[WORKER-DEBUG] 请求password前4位=', password ? password.slice(0, 4) : 'none', '| 过滤前缀=', prefix)
      const userKeys = prefix
        ? allKeys.filter(k => k.rawKey.startsWith(prefix)).map(k => ({ key: k.rawKey.slice(prefix.length), rawKey: k.rawKey, size: k.size }))
        : []
      return Response.json({ ok: true, allCount: allKeys.length, allKeys, userCount: userKeys.length, userKeys }, { headers: CORS })
    }

    return new Response('Not Found', { status: 404, headers: CORS })
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(generateProactive(env, { force: false }))
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

// ── Proactive message generation (session-aware) ─────────────────

function getUserPassword(env) {
  return env.USER_PASSWORD || 'xiaoman2.26'
}

async function kvGetJson(env, key) {
  const raw = await env.CHAT_KV.get(key)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

// Accurate Beijing time pieces + a human-readable string
function beijingTime(now = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: 'long', day: 'numeric',
    weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = t => parts.find(p => p.type === t)?.value || ''
  let hour = parseInt(get('hour'), 10)
  if (Number.isNaN(hour)) hour = 0
  hour = hour % 24
  const minute = get('minute')
  const display = `${get('year')}年${get('month')}${get('day')}日 ${get('weekday')} ${String(hour).padStart(2, '0')}:${minute}`
  return { hour, display }
}

function timeSegmentGuidance(hour) {
  if (hour >= 0 && hour < 5) return '现在是深夜/凌晨，主人多半还没睡或刚醒。要关心他怎么还没睡、提醒早点休息别熬夜。绝对不能说晒太阳、出门、吃早饭这类不符合凌晨的话。'
  if (hour >= 5 && hour < 8) return '现在是清晨，可以轻声道早安、问睡得好不好，但别太吵。'
  if (hour >= 8 && hour < 11) return '现在是上午，可以聊聊今天的安排、分享心情。'
  if (hour >= 11 && hour < 13) return '现在是中午饭点，可以问吃午饭了没、提醒好好吃饭。'
  if (hour >= 13 && hour < 17) return '现在是下午，可以关心累不累、要不要休息一下。'
  if (hour >= 17 && hour < 19) return '现在是傍晚饭点，可以问晚饭吃什么、今天过得怎么样。'
  if (hour >= 19 && hour < 23) return '现在是晚上，适合放松地闲聊、说想他了、聊聊今天的事。'
  return '现在是深夜，主人该睡了，温柔地催他早点睡、道晚安。'
}

// Pick the most recently active session from synced settings
function resolveTargetSession(settings) {
  const sessions = Array.isArray(settings?.sessions) ? settings.sessions : []
  if (sessions.length === 0) return null
  const byCurrent = sessions.find(s => s.id === settings.currentSessionId)
  if (byCurrent) return byCurrent
  // fallback: latest lastMsgTime
  return [...sessions].sort((a, b) => (b.lastMsgTime || 0) - (a.lastMsgTime || 0))[0]
}

// Mirror useChat.js effective config resolution
function resolveSessionConfig(settings, session) {
  const providers = Array.isArray(settings?.providers) ? settings.providers : []
  const provider = providers.find(p => p.id === settings.selectedProviderId)
  const apiKey = session.apiKey || provider?.apiKey || settings.apiKey || ''
  const baseUrl = session.baseUrl || provider?.baseUrl || settings.apiBaseUrl || 'https://api.anthropic.com'
  const model = session.model || settings.model || ''
  const persona = session.systemPrompt !== undefined
    ? (session.systemPrompt || settings.systemPrompt)
    : settings.systemPrompt
  return { apiKey, baseUrl, model, persona: persona || '' }
}

// Convert stored session messages into chat turns, normalized to alternate roles
function buildContextTurns(msgs) {
  const recent = (Array.isArray(msgs) ? msgs : []).slice(-8)
  const raw = recent.map(m => {
    let content = ''
    if (m.type === 'image') content = m.content || '[图片]'
    else if (m.type === 'voice') content = m.voiceText || m.transcript || '[语音消息]'
    else content = m.content || ''
    return { role: m.role === 'assistant' ? 'assistant' : 'user', content: (content || '').trim() }
  }).filter(t => t.content)

  // merge consecutive same-role turns
  const merged = []
  for (const t of raw) {
    const last = merged[merged.length - 1]
    if (last && last.role === t.role) last.content += '\n' + t.content
    else merged.push({ ...t })
  }
  // Anthropic requires the first turn to be 'user'
  while (merged.length && merged[0].role !== 'user') merged.shift()
  return merged
}

// Non-streaming model call, dual format (Anthropic vs OpenAI-compatible)
async function callModel({ apiKey, baseUrl, model, systemPrompt, turns }) {
  const base = (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')
  const isAnthropic = base.includes('anthropic.com')

  let url, headers, body
  if (isAnthropic) {
    url = `${base}/v1/messages`
    headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }
    body = { model, max_tokens: 1024, system: systemPrompt, messages: turns }
  } else {
    url = `${base}/chat/completions`
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` }
    body = {
      model,
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      messages: [{ role: 'system', content: systemPrompt }, ...turns],
    }
  }

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const rawText = await res.text()
  let data = null
  try { data = JSON.parse(rawText) } catch {}

  const choice = data?.choices?.[0]
  const finishReason = isAnthropic ? data?.stop_reason : choice?.finish_reason
  const reasoningContent = choice?.message?.reasoning_content
  const text = isAnthropic
    ? data?.content?.find(b => b.type === 'text')?.text
    : choice?.message?.content
  console.log('[GEN] finish_reason=', finishReason, 'content长度=', text?.length ?? 0, 'reasoning长度=', reasoningContent?.length ?? 0)

  return { ok: res.ok, status: res.status, rawText, url, text: text?.trim() ?? null }
}

// Core: build the full prompt and generate one proactive message for the target session
async function generateProactive(env, { force }) {
  const now = Date.now()
  const password = getUserPassword(env)
  const debug = {
    shouldSend: !!force,
    passwordPrefix: password.slice(0, 4),
  }

  // 1. Load synced settings
  const settings = await kvGetJson(env, `user:${password}:settings`)
  if (!settings) {
    return { ...debug, error: 'no settings in KV for this user', savedToKV: false }
  }

  // 2. Target session
  const session = resolveTargetSession(settings)
  if (!session) {
    return { ...debug, error: 'no sessions found in settings', savedToKV: false }
  }
  const { apiKey, baseUrl, model, persona } = resolveSessionConfig(settings, session)
  debug.targetSessionId = session.id
  debug.targetSessionName = session.name || ''
  debug.model = model
  debug.apiBaseUrl = baseUrl
  debug.apiKeyLength = apiKey?.length ?? 0

  // 3. Probability gate (cron only; /trigger forces send)
  const [lastActiveStr, lastSentStr] = await Promise.all([
    env.CHAT_KV.get('last_user_active_time'),
    env.CHAT_KV.get('last_sent_time'),
  ])
  const lastActive = lastActiveStr ? parseInt(lastActiveStr) : 0
  const lastSent = lastSentStr ? parseInt(lastSentStr) : 0
  const minSinceActive = (now - lastActive) / 60_000
  const minSinceSent = (now - lastSent) / 60_000
  debug.hoursSinceLastChat = parseFloat((minSinceActive / 60).toFixed(2))

  if (!force) {
    if (minSinceSent < 30) return { ...debug, skipped: 'cooldown <30min since last sent', savedToKV: false }
    let probability
    if (minSinceActive < 30) probability = 0.20
    else if (minSinceActive < 60) probability = 0.30
    else if (minSinceActive < 180) probability = 0.60
    else if (minSinceActive < 360) probability = 0.40
    else if (minSinceActive < 720) probability = 0.20
    else probability = 0.10
    if (Math.random() > probability) return { ...debug, skipped: `probability ${probability} not hit`, savedToKV: false }
    debug.shouldSend = true
  }

  // 4. Time
  const { hour, display: timeStr } = beijingTime(new Date(now))
  const timeGuide = timeSegmentGuidance(hour)

  // 5. Memory
  const memListed = await env.CHAT_KV.list({ prefix: 'memory:' })
  const memVals = await Promise.all(memListed.keys.map(k => env.CHAT_KV.get(k.name)))
  const memoryLines = memListed.keys.map((k, i) => {
    const without = k.name.slice('memory:'.length)
    const idx = without.indexOf(':')
    const subj = idx === -1 ? without : without.slice(0, idx)
    const pred = idx === -1 ? '' : without.slice(idx + 1)
    return `- ${subj}${pred ? ' ' + pred : ''}：${memVals[i] || ''}`
  })
  const memoryBlock = memoryLines.length ? `\n\n【你记得关于主人的事】\n${memoryLines.join('\n')}` : ''

  // 6. Recent conversation context
  const msgs = await kvGetJson(env, `user:${password}:sessions:msgs:${session.id}`)
  const turns = buildContextTurns(msgs)
  debug.contextTurnCount = turns.length

  // 7. Build system prompt = persona + time + guidance + memory + behavioral rules
  const systemPrompt =
    `${persona}\n\n` +
    `【当前时间】北京时间：${timeStr}。${timeGuide}\n` +
    memoryBlock +
    `\n\n【现在要做的事】你现在要主动给主人发一条消息（不是回答提问，是你自己想起他、想和他说说话）。要求：\n` +
    `1. 结合上面的最近对话，能接住之前的话题、语气连贯，别像第一次说话。\n` +
    `2. 符合当前时间段，说应景的话。\n` +
    `3. 像真人朋友一样自然——可以接上次的话题、分享一个小想法、随口关心一句，或者撒个娇。\n` +
    `4. 绝对不要用"今天天气真好""在干嘛呢"这种机械模板开场。\n` +
    `5. 只发一条，简短口语化，符合你的人设和说话风格。`

  // Trigger turn (append as user, merging if last context turn is also user)
  const triggerText = '（现在请你主动发一条消息给主人。）'
  if (turns.length && turns[turns.length - 1].role === 'user') {
    turns[turns.length - 1].content += '\n' + triggerText
  } else {
    turns.push({ role: 'user', content: triggerText })
  }

  // 8. Call the model
  let result
  try {
    result = await callModel({ apiKey, baseUrl, model, systemPrompt, turns })
  } catch (e) {
    return { ...debug, apiCalled: true, error: `${e.name}: ${e.message}`, savedToKV: false }
  }
  debug.apiCalled = true
  debug.apiUrl = result.url
  debug.apiStatus = result.status
  debug.apiResponseSnippet = result.rawText.slice(0, 300)
  debug.systemPromptPreview = systemPrompt.slice(0, 200)

  if (!result.ok || !result.text) {
    return { ...debug, generatedMessage: null, savedToKV: false }
  }
  debug.generatedMessage = result.text

  // 9. Store into this session's pending queue: user:{password}:pending:{sessionId}
  const pendingKey = `user:${password}:pending:${session.id}`
  const existing = await kvGetJson(env, pendingKey)
  const pending = Array.isArray(existing) ? existing : []
  pending.push({ content: result.text, timestamp: now, read: false })
  await Promise.all([
    env.CHAT_KV.put(pendingKey, JSON.stringify(pending)),
    env.CHAT_KV.put('last_sent_time', now.toString()),
  ])
  debug.savedToKV = true
  debug.kvKey = pendingKey
  return debug
}
