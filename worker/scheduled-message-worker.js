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

    // ── NetEase Cloud Music API proxy ─────────────────────────────
    if (pathname.startsWith('/music/') && (request.method === 'GET' || request.method === 'POST')) {
      return handleMusicProxy(request, env)
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
  // Read body as text so we can log fields while still forwarding the original bytes
  const bodyText = await request.text()
  let parsedBody = null
  try { parsedBody = JSON.parse(bodyText) } catch {}
  console.log(
    '[WORKER] 转发给上游的body字段=', parsedBody ? Object.keys(parsedBody) : '(parse error)',
    '| 含web_search=', !!(parsedBody?.web_search),
    '| 含tools=', !!(parsedBody?.tools),
    '| tools内容=', JSON.stringify(parsedBody?.tools ?? null),
    '| model=', parsedBody?.model ?? '?',
    '| targetUrl=', targetUrl,
  )
  const upstreamRes = await fetch(targetUrl, { method: 'POST', headers: upstreamHeaders, body: bodyText })
  return new Response(upstreamRes.body, {
    status: upstreamRes.status,
    headers: {
      'Content-Type': upstreamRes.headers.get('Content-Type') || 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...CORS,
    },
  })
}

// ── NetEase Cloud Music API proxy ────────────────────────────────

const NCM_BASE = 'https://openapi.music.163.com'

const NCM_DEVICE = {
  deviceType: 'openapi',
  os: 'ncmcli',
  appVer: '0.1.6',
  channel: 'ncmcli',
  model: 'Linux_x64_cli',
  brand: 'ncmcli',
  osVer: '1.0',
  clientIp: '192.0.2.2',
  deviceId: 'eunoia_web_001',
}

const NCM_MUSIC_ROUTES = {
  '/music/search':  '/openapi/music/basic/search/song/get/v3',
  '/music/song':    '/openapi/music/basic/song/detail/get/v2',
  '/music/playurl': '/openapi/music/basic/song/playurl/get/v2',
  '/music/lyric':   '/openapi/music/basic/song/lyric/get/v2',
}

const DAY_MS = 86_400_000

async function handleMusicProxy(request, env) {
  const url = new URL(request.url)
  const { pathname } = url

  let params = {}
  if (request.method === 'POST') {
    try { params = await request.json() } catch { params = {} }
  } else {
    params = Object.fromEntries(url.searchParams.entries())
  }

  // Auth: key=xiaoman2026 OR Referer from xiaoman.xyz
  const authKey = params.authKey || url.searchParams.get('authKey') || params.key || url.searchParams.get('key') || ''
  const referer = request.headers.get('Referer') || ''
  if (authKey !== 'xiaoman2026' && !referer.includes('xiaoman.xyz')) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
  }

  try {
    // ── Debug: build signed search URL without fetching ─────────
    if (pathname === '/music/test') {
      const accessToken = env.NCM_ACCESS_TOKEN || ''
      const device_raw = JSON.stringify(NCM_DEVICE)
      const bizContent_raw = JSON.stringify({ keyword: 'test', limit: 5 })
      const sp = {
        accessToken,
        appId: env.NCM_APP_ID,
        bizContent: bizContent_raw,
        device: device_raw,
        signType: 'RSA_SHA256',
        timestamp: Date.now().toString(),
      }
      const signBase = Object.keys(sp).filter(k => sp[k]).sort().map(k => `${k}=${sp[k]}`).join('&')
      const sign = await rsaSign(env.NCM_PRIVATE_KEY, signBase)
      const query = Object.keys({ ...sp, sign }).sort().map(k => `${k}=${encodeURIComponent({ ...sp, sign }[k])}`).join('&')
      const fullUrl = `${NCM_BASE}/openapi/music/basic/search/song/get/v3?${query}`
      return Response.json({ url: fullUrl }, { headers: CORS })
    }

    // ── Anonymous login (one-time) ──────────────────────────────
    if (pathname === '/music/anonymous-login') {
      const { data } = await ncmRequest(env,
        '/openapi/music/basic/oauth2/login/anonymous',
        { clientId: env.NCM_APP_ID })
      if (data?.data?.accessToken) {
        try {
          await env.CHAT_KV.put('ncm:anonymous_token', data.data.accessToken)
        } catch (e) {
          console.log('[ncm] KV put ncm:anonymous_token failed:', e.message)
        }
      }
      return Response.json(data, { headers: CORS })
    }

    // ── QR code generation ──────────────────────────────────────
    if (pathname === '/music/qrcode') {
      const { data } = await ncmRequest(env,
        '/openapi/music/basic/user/oauth2/qrcodekey/get/v2',
        { type: 2, expiredKey: '300' })
      return Response.json(data, { headers: CORS })
    }

    // ── QR code poll ────────────────────────────────────────────
    // ?authKey=xiaoman2026&uniKey=<qrcode_uniKey>
    if (pathname === '/music/qrcode/poll') {
      const uniKey = url.searchParams.get('uniKey') || ''
      const anonymousToken = env.NCM_ANONYMOUS_TOKEN
        || await env.CHAT_KV.get('ncm:anonymous_token')
      if (!anonymousToken) {
        return Response.json(
          { error: 'anonymous_token missing — call /music/anonymous-login first' },
          { status: 400, headers: CORS })
      }
      const { data } = await ncmRequest(
        env,
        '/openapi/music/basic/oauth2/device/login/qrcode/get',
        { key: uniKey, clientId: env.NCM_APP_ID },
        { accessToken: anonymousToken })
      // code 803 = scan success → persist user tokens
      if (data?.code === 803 && data?.data) {
        const { accessToken, refreshToken, expireTime } = data.data
        await Promise.all([
          env.CHAT_KV.put('ncm:access_token', accessToken || ''),
          env.CHAT_KV.put('ncm:refresh_token', refreshToken || ''),
          env.CHAT_KV.put('ncm:token_expire', String(Date.now() + (Number(expireTime) || 0) * 1000)),
        ])
      }
      return Response.json(data, { headers: CORS })
    }

    // ── Manual token refresh ────────────────────────────────────
    if (pathname === '/music/token/refresh') {
      const refreshToken = await env.CHAT_KV.get('ncm:refresh_token')
      if (!refreshToken) {
        return Response.json({ error: 'no refresh token — please log in first' }, { status: 400, headers: CORS })
      }
      const { data } = await doTokenRefresh(env, refreshToken)
      return Response.json(data, { headers: CORS })
    }

    // ── Authenticated music routes ──────────────────────────────
    const upstreamPath = NCM_MUSIC_ROUTES[pathname]
    if (!upstreamPath) {
      return Response.json({ error: 'unknown music route' }, { status: 404, headers: CORS })
    }

    // env var takes priority — skip all expiry/refresh logic
    const accessToken = env.NCM_ACCESS_TOKEN
      || await env.CHAT_KV.get('ncm:access_token').catch(() => null)
    if (!accessToken) {
      return Response.json({ error: 'need_login', message: '请先扫码登录' }, { status: 401, headers: CORS })
    }

    if (!env.NCM_ACCESS_TOKEN) {
      const [tokenExpireStr, refreshToken] = await Promise.all([
        env.CHAT_KV.get('ncm:token_expire'),
        env.CHAT_KV.get('ncm:refresh_token'),
      ])
      const tokenExpire = tokenExpireStr ? parseInt(tokenExpireStr) : 0
      const now = Date.now()

      if (tokenExpire < now) {
        if (!refreshToken || tokenExpire < now - 20 * DAY_MS) {
          return Response.json({ error: 'need_login', message: '请先扫码登录' }, { status: 401, headers: CORS })
        }
        const { ok, newToken } = await doTokenRefresh(env, refreshToken)
        if (!ok || !newToken) {
          return Response.json({ error: 'need_login', message: '请先扫码登录' }, { status: 401, headers: CORS })
        }
        return ncmMusicRequest(env, pathname, upstreamPath, params, newToken)
      }

      if (tokenExpire - now < DAY_MS && refreshToken) {
        await doTokenRefresh(env, refreshToken)
      }
    }

    return ncmMusicRequest(env, pathname, upstreamPath, params, accessToken)
  } catch (e) {
    return Response.json({ error: `${e.name}: ${e.message}` }, { status: 500, headers: CORS })
  }
}

async function doTokenRefresh(env, refreshToken) {
  const { data } = await ncmRequest(env,
    '/openapi/music/basic/user/oauth2/token/refresh/v2',
    { refreshToken })
  if (data?.data?.accessToken) {
    const { accessToken, refreshToken: newRefresh, expireTime } = data.data
    await Promise.all([
      env.CHAT_KV.put('ncm:access_token', accessToken),
      env.CHAT_KV.put('ncm:refresh_token', newRefresh || refreshToken),
      env.CHAT_KV.put('ncm:token_expire', String(Date.now() + (Number(expireTime) || 0) * 1000)),
    ])
    return { ok: true, newToken: accessToken, data }
  }
  return { ok: false, newToken: null, data }
}

async function ncmMusicRequest(env, pathname, upstreamPath, params, accessToken) {
  let bizContent
  if (pathname === '/music/search') {
    bizContent = { keyword: params.keyword || '', limit: Number(params.limit) || 10 }
  } else if (pathname === '/music/song') {
    bizContent = { songId: String(params.songId || ''), withUrl: true }
  } else if (pathname === '/music/playurl') {
    bizContent = { songId: String(params.songId || ''), bitrate: Number(params.bitrate) || 320 }
  } else {
    bizContent = { songId: String(params.songId || '') }
  }
  const result = await ncmRequest(env, upstreamPath, bizContent,
    { accessToken: pathname === '/music/search' ? (env.NCM_ACCESS_TOKEN || accessToken) : accessToken })
  if (pathname === '/music/search') {
    return Response.json({ http_status: result.status, response_text: result.rawText.substring(0, 1000) }, { headers: CORS })
  }
  return Response.json(result.data, { headers: CORS })
}

// Assemble common params, sign with RSA_SHA256, forward to NCM open API
async function ncmRequest(env, path, bizContentObj, { accessToken } = {}) {
  const device_raw = JSON.stringify(NCM_DEVICE)
  const bizContent_raw = JSON.stringify(bizContentObj)

  // Sign base includes accessToken if present (raw JSON values, sorted)
  const signParams = {
    appId: env.NCM_APP_ID,
    signType: 'RSA_SHA256',
    timestamp: Date.now().toString(),
    device: device_raw,
    bizContent: bizContent_raw,
  }
  if (accessToken) signParams.accessToken = accessToken

  const signBase = Object.keys(signParams)
    .filter(k => signParams[k] !== '' && signParams[k] != null)
    .sort()
    .map(k => `${k}=${signParams[k]}`)
    .join('&')

  const sign = await rsaSign(env.NCM_PRIVATE_KEY, signBase)

  // GET with encodeURIComponent on all values
  const allParams = { ...signParams, sign }
  const query = Object.keys(allParams).sort()
    .map(k => `${k}=${encodeURIComponent(allParams[k])}`)
    .join('&')

  const res = await fetch(`${NCM_BASE}${path}?${query}`, {
    headers: {
      'User-Agent': 'ncm-cli/0.1.6',
      'Referer': 'https://music.163.com',
    },
  })
  const body = await res.text()
  let data
  try { data = JSON.parse(body) } catch { data = body }
  return { status: res.status, data, rawText: body }
}

async function rsaSign(pemKey, data) {
  const keyData = pemToArrayBuffer(pemKey)
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(data))
  return arrayBufferToBase64(signature)
}

function pemToArrayBuffer(pem) {
  const b64 = (pem || '')
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
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
    if (minSinceSent < 120) return { ...debug, skipped: `cooldown <120min since last sent (minSinceSent=${minSinceSent.toFixed(1)})`, savedToKV: false }
    let probability
    if (minSinceActive < 30) probability = 0.20
    else if (minSinceActive < 60) probability = 0.30
    else if (minSinceActive < 180) probability = 0.60
    else if (minSinceActive < 360) probability = 0.40
    else if (minSinceActive < 720) probability = 0.20
    else probability = 0.10
    const rand = Math.random()
    const willSend = rand <= probability
    console.log('[CRON] hoursSinceLastChat=', debug.hoursSinceLastChat, '对应概率=', probability, 'random=', rand.toFixed(4), '结果发不发=', willSend)
    if (!willSend) return { ...debug, skipped: `probability ${probability} not hit (rand=${rand.toFixed(4)})`, savedToKV: false }
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
    `【发消息时的时间】北京时间：${timeStr}。${timeGuide}\n` +
    memoryBlock +
    `\n\n【现在要做的事】你要主动给主人发一条消息。这条消息是你"主动投递"的，就像发微信——你不知道他此刻在不在看手机、醒没醒、会不会马上看到。请遵守以下原则：\n` +
    `1. 【不预设对方在线】不要直接质问"你怎么还不睡""怎么还醒着"——这预设了对方正在看屏幕。要用"投递给未知"的语气：表达你此刻的心情/想念/惦记，允许对方晚点才看到。比如凌晨不说"怎么还不睡"，而是"不知道你睡了没，有点想你""我先睡啦，看到记得回我"。\n` +
    `2. 【时间只影响你的心情，不断言主人的状态】凌晨=你自己安静的想念，清晨=你想道个早安，饭点=你惦记他有没有吃饭——但都是你的感受，不是对他现在在做什么的判断。\n` +
    `3. 【追问留到他回复之后】等他回了、确认在线，下一轮聊天才适合追问"这么晚还醒着呀"。这第一条主动消息不问这个。\n` +
    `4. 结合最近对话，能接上之前的话题或梗，语气连贯，不要像第一次说话。\n` +
    `5. 绝对不要用"在干嘛呢""今天怎么样"这种毫无个性的开场白。\n` +
    `6. 只发一条，简短口语化，符合你的人设风格。\n` +
    `7. 这条消息只是聊天，不要在其中包含任何工具指令（如空调控制标签 [AC:...] 等），不要替主人操控任何设备。`

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
