const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key, X-Target-Url, X-VPS-Key, X-Eunoia-Password',
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

    if (pathname === '/stt' && request.method === 'POST') {
      return handleSpeechTranscription(request, env)
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

    // ── Web Push ──────────────────────────────────────────────────
    if (pathname === '/push/subscribe' && request.method === 'POST') {
      const { password, subscription } = await request.json()
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return Response.json({ error: 'invalid subscription' }, { status: 400, headers: CORS })
      }
      const key = `user:${password}:push:subs`
      const existing = await kvGetJson(env, key)
      const subs = Array.isArray(existing) ? existing : []
      const filtered = subs.filter(s => s.endpoint !== subscription.endpoint)
      filtered.push(subscription)
      // 一个人的设备数有限，最多保留最近 5 个订阅
      await env.CHAT_KV.put(key, JSON.stringify(filtered.slice(-5)))
      return Response.json({ ok: true, count: filtered.length }, { headers: CORS })
    }

    if (pathname === '/push/unsubscribe' && request.method === 'POST') {
      const { password, endpoint } = await request.json()
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      const key = `user:${password}:push:subs`
      const existing = await kvGetJson(env, key)
      const subs = (Array.isArray(existing) ? existing : []).filter(s => s.endpoint !== endpoint)
      await env.CHAT_KV.put(key, JSON.stringify(subs))
      return Response.json({ ok: true, count: subs.length }, { headers: CORS })
    }

    if (pathname === '/push/test' && request.method === 'POST') {
      const { password } = await request.json()
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      if (!env.VAPID_PRIVATE_KEY) {
        return Response.json({ error: 'VAPID_PRIVATE_KEY secret not set' }, { status: 500, headers: CORS })
      }
      const result = await sendPushToUser(env, password, {
        title: '通知测试 🔔',
        body: '推送链路正常，小满的主动消息会送到这里～',
      })
      return Response.json(result, { headers: CORS })
    }

    // Server-to-server push trigger for the VPS-resident companion
    // (ai-companion/channel-server.ts) — its own proactive check-ins and
    // dream announcements only ever broadcast over its own WebSocket, which
    // is useless once the app is backgrounded/closed. This lets it reuse the
    // exact same VAPID/sendPushToUser plumbing the API-key sessions already
    // have, without the VPS ever needing to know the user's real login
    // password — auth here is a separate secret (VPS_SERVICE_KEY), and the
    // real password is resolved server-side via getUserPassword(env).
    if (pathname === '/vps/push' && request.method === 'POST') {
      const vpsKey = request.headers.get('X-VPS-Key') || ''
      if (!env.VPS_SERVICE_KEY || vpsKey !== env.VPS_SERVICE_KEY) {
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      }
      if (!env.VAPID_PRIVATE_KEY) {
        return Response.json({ error: 'VAPID_PRIVATE_KEY secret not set' }, { status: 500, headers: CORS })
      }
      const password = getUserPassword(env)
      if (!password) {
        return Response.json({ error: 'USER_PASSWORD secret not set' }, { status: 500, headers: CORS })
      }
      const payload = await request.json().catch(() => ({}))
      const body = typeof payload?.body === 'string' ? payload.body.trim() : ''
      if (!body) return Response.json({ error: 'missing body' }, { status: 400, headers: CORS })
      const result = await sendPushToUser(env, password, {
        title: typeof payload?.title === 'string' ? payload.title : '小满 🌸',
        body: body.slice(0, 120),
        tag: typeof payload?.tag === 'string' ? payload.tag : 'eunoia-cc-proactive',
        url: typeof payload?.url === 'string' ? payload.url : '/?source=cc-proactive',
      })
      return Response.json(result, { headers: CORS })
    }

    // ── 日记信箱（Google Drive 服务账号后端）─────────────────────
    // Storage moved off KV: each letter is one JSON file in a dedicated
    // Drive folder (the real Google account owns it, see driveGetAccessToken).
    // Two writers, one auth each: the logged-in user (password, same as
    // every other /sync/* route) and the VPS-resident companion (X-VPS-Key,
    // same secret/header as /vps/push above) — role is resolved server-side
    // per auth method, never trusted from a client-forgeable field alone.
    if (pathname === '/diary/latest' && request.method === 'GET') {
      const password = new URL(request.url).searchParams.get('password')
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      if (!driveConfigured(env)) {
        return Response.json({ error: 'drive not configured' }, { status: 500, headers: CORS })
      }
      try {
        const file = await driveGetLatestFile(env)
        const letter = file ? { id: file.id, ...(await driveReadFile(env, file.id)) } : null
        return Response.json({ letter }, { headers: CORS })
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502, headers: CORS })
      }
    }

    if (pathname === '/diary/get' && request.method === 'GET') {
      const { searchParams } = new URL(request.url)
      const password = searchParams.get('password')
      const id = searchParams.get('id')
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      if (!id) return Response.json({ error: 'missing id' }, { status: 400, headers: CORS })
      if (!driveConfigured(env)) return Response.json({ error: 'drive not configured' }, { status: 500, headers: CORS })
      try {
        const content = await driveReadFile(env, id)
        return Response.json({ letter: content ? { id, ...content } : null }, { headers: CORS })
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502, headers: CORS })
      }
    }

    // Lightweight per-session index (id/date/mood/weather/role only, never
    // downloading a letter body) — powers the "you know these letters exist
    // but not their content" line the AI gets in its system prompt every
    // turn (see recentLetters in useChat.js). Reads straight off Drive file
    // `properties`, set at creation time in driveCreateFile.
    if (pathname === '/diary/list' && request.method === 'GET') {
      const { searchParams } = new URL(request.url)
      const password = searchParams.get('password')
      const sessionId = searchParams.get('sessionId')
      const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '5', 10) || 5, 1), 50)
      if (!password) return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      if (!sessionId) return Response.json({ error: 'missing sessionId' }, { status: 400, headers: CORS })
      if (!driveConfigured(env)) return Response.json({ error: 'drive not configured' }, { status: 500, headers: CORS })
      try {
        const letters = await driveListBySession(env, sessionId, limit)
        return Response.json({ letters }, { headers: CORS })
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502, headers: CORS })
      }
    }

    if (pathname === '/diary/write' && request.method === 'POST') {
      const vpsKey = request.headers.get('X-VPS-Key') || ''
      const isVps = !!env.VPS_SERVICE_KEY && vpsKey === env.VPS_SERVICE_KEY
      const payload = await request.json().catch(() => ({}))
      if (!isVps && !payload.password) {
        return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
      }
      const content = typeof payload.content === 'string' ? payload.content.trim() : ''
      if (!content) return Response.json({ error: 'missing content' }, { status: 400, headers: CORS })
      if (!driveConfigured(env)) {
        return Response.json({ error: 'drive not configured' }, { status: 500, headers: CORS })
      }
      const letter = {
        sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
        // VPS calls are always cc, never trust the payload for that path.
        // Password-authed calls (the browser) may legitimately claim either
        // role — the in-chat [LETTER] tag mechanism runs client-side for
        // every provider (Codex/API-key sessions have no VPS key at all) and
        // has always written 'ai' letters this way; the diary compose box
        // writes 'user'. The password itself is the only real boundary here
        // (single-user app), so trusting role within that boundary is fine.
        role: isVps ? 'ai' : (payload.role === 'ai' ? 'ai' : 'user'),
        mood: typeof payload.mood === 'string' ? payload.mood : '😊',
        weather: typeof payload.weather === 'string' ? payload.weather : '☀️',
        date: typeof payload.date === 'string' ? payload.date : new Date().toISOString().slice(0, 10),
        content,
        createdAt: Date.now(),
      }
      try {
        const id = await driveCreateFile(env, letter)
        return Response.json({ ok: true, letter: { id, ...letter } }, { headers: CORS })
      } catch (e) {
        return Response.json({ error: e.message }, { status: 502, headers: CORS })
      }
    }

    // ── iTunes/Apple Music 代理（前端碟片播放器用）───────────────
    if (pathname.startsWith('/itunes/') && request.method === 'GET') {
      return handleItunesApi(request, env)
    }

    // ── 网易云手机控制：只搜索歌曲元数据，不获取或代理音频 ─────
    if (pathname.startsWith('/netease/') && (request.method === 'GET' || request.method === 'POST')) {
      return handleNeteaseControlApi(request, env)
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

// 120 s of 16 kHz/16-bit mono PCM plus the WAV header is ~3.84 MB.
const STT_MAX_AUDIO_BYTES = 4_100_000

export function encodeAudioBase64(bytes) {
  let binary = ''
  // Avoid spreading the whole utterance at once: two minutes of PCM is large
  // enough to overflow the JavaScript argument stack in a Worker.
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return btoa(binary)
}

async function transcribeWithVpsSenseVoice(bytes, env) {
  if (!env.VPS_SERVICE_KEY) return null
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(env.SENSEVOICE_URL || 'https://companion.xiaoman.xyz/stt/sensevoice', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/wav',
        'X-VPS-Key': env.VPS_SERVICE_KEY,
      },
      body: bytes,
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`SenseVoice upstream ${response.status}`)
    const result = await response.json()
    const text = String(result?.text || '').trim()
    if (!text) throw new Error('SenseVoice returned no transcript')
    return {
      text,
      emotion: String(result?.emotion || 'unknown').toLowerCase(),
      event: String(result?.event || ''),
      language: String(result?.language || ''),
      acoustics: result?.acoustics && typeof result.acoustics === 'object' ? result.acoustics : null,
      engine: String(result?.engine || 'sensevoice'),
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function handleSpeechTranscription(request, env) {
  let form
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'multipart form required' }, { status: 415, headers: CORS })
  }
  const password = String(form.get('password') || '')
  const secretMatches = !!env.USER_PASSWORD && password === env.USER_PASSWORD
  const existingUser = !secretMatches && password
    ? await env.CHAT_KV?.get?.(`user:${password}:settings`)
    : null
  if (!password || (!secretMatches && existingUser == null)) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
  }
  const audio = form.get('audio')
  if (!audio || typeof audio.arrayBuffer !== 'function') {
    return Response.json({ error: 'WAV audio file required' }, { status: 400, headers: CORS })
  }
  const bytes = new Uint8Array(await audio.arrayBuffer())
  if (bytes.length < 44 || bytes.length > STT_MAX_AUDIO_BYTES) {
    return Response.json({ error: bytes.length > STT_MAX_AUDIO_BYTES ? 'audio too large' : 'audio too short' }, {
      status: bytes.length > STT_MAX_AUDIO_BYTES ? 413 : 400,
      headers: CORS,
    })
  }
  try {
    const senseVoiceResult = await transcribeWithVpsSenseVoice(bytes, env)
    if (senseVoiceResult) {
      return Response.json(senseVoiceResult, { headers: { ...CORS, 'Cache-Control': 'no-store' } })
    }
  } catch (error) {
    // SenseVoice is the real acoustic-emotion path. Whisper stays available
    // strictly as a transcription-only outage fallback.
    console.error('[STT] VPS SenseVoice failed, falling back to Workers AI:', error?.message || String(error))
  }
  if (!env.AI?.run) {
    return Response.json({ error: 'Speech recognition backends are unavailable' }, { status: 503, headers: CORS })
  }
  try {
    const result = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
      // Current Workers AI schema accepts a base64 string (or a structured
      // binary object). The old number[] form is rejected by the model with a
      // generic 5xx, which surfaced to the iPhone as a permanent 502.
      audio: encodeAudioBase64(bytes),
      task: 'transcribe',
      language: 'zh',
      vad_filter: true,
      condition_on_previous_text: false,
      no_speech_threshold: 0.6,
      initial_prompt: '以下是自然的普通话对话，也可能夹杂常见英文名称。请准确转写，保留原意。',
    })
    const text = String(result?.text || result?.transcription_info?.text || '').trim()
    return Response.json({ text, emotion: 'unknown', event: '', language: 'zh', acoustics: null, engine: 'whisper' }, {
      headers: { ...CORS, 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    console.error('[STT] Workers AI failed:', error?.message || String(error))
    const status = /limit|quota|capacity|rate/i.test(error?.message || '') ? 429 : 502
    return Response.json({ error: status === 429 ? 'Cloudflare STT quota unavailable' : 'Cloudflare STT failed' }, {
      status,
      headers: { ...CORS, 'Cache-Control': 'no-store' },
    })
  }
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

// ── iTunes / Apple Music 代理（/itunes/*）─────────────────────────
// 迭代史：
//   网易云（源 IP 判海外 → 曲链 404）
//   → B 站音频区（HTTP 412 反爬）
//   → B 站视频区（WBI+buvid 也被机房 IP 风控 412）
//   → 现在：iTunes 搜索接口。
// 关键洞察：Worker 出口是境外机房 IP，国内服务（网易/B站/QQ）都对机房
// IP 做风控，怎么伪装都绕不过。反过来用「不封境外」的境外源就一劳永逸。
// iTunes Search API 零登录、零风控、境外 IP 照用，几乎每首华语流行都有，
// 返回可直接播放的 m4a。代价：只有 30 秒官方试听片段。
//
//   搜索  /itunes/search?keywords=&limit=
//   播放  /itunes/playurl?id=<trackId>（lookup 取 previewUrl）
//   歌词  /itunes/lyric（iTunes 无歌词接口，返回空）
//   探测  /itunes/status
//
// previewUrl 由 Apple CDN 提供，<audio> 跨域直连即可播放（媒体元素不受
// CORS 限制），无需再走 Worker 反代。只有搜索/lookup 的 JSON 需要经
// Worker 补 CORS 头。

const ITUNES_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function httpsify(u) {
  return typeof u === 'string' ? u.replace(/^http:\/\//, 'https://') : u
}

// artworkUrl100 形如 .../100x100bb.jpg，替换成更大尺寸
function upsizeArtwork(u, size = 300) {
  return typeof u === 'string' ? u.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) : u
}

function mapItunesTrack(t) {
  return {
    id: t.trackId,
    name: t.trackName || '',
    artists: t.artistName || '',
    album: t.collectionName || '',
    cover: upsizeArtwork(httpsify(t.artworkUrl100 || t.artworkUrl60 || ''), 300),
    duration: Math.round((t.trackTimeMillis || 0) / 1000), // 整首时长（试听仍是 30s）
    preview: httpsify(t.previewUrl || ''),
    fee: 0,
  }
}

async function handleItunesApi(request, env) {
  const url = new URL(request.url)
  const q = url.searchParams

  const authKey = q.get('authKey') || q.get('key') || ''
  const referer = request.headers.get('Referer') || ''
  const keyOk = !!env.MUSIC_AUTH_KEY && authKey === env.MUSIC_AUTH_KEY
  const refOk = referer.includes('xiaoman.xyz') || referer.includes('pink-chat-blt.pages.dev')
  if (!keyOk && !refOk) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
  }

  const ITUNES_HEADERS = { 'User-Agent': ITUNES_UA }

  try {
    if (url.pathname === '/itunes/search') {
      const term = (q.get('keywords') || '').slice(0, 100)
      if (!term) return Response.json({ ok: true, songs: [] }, { headers: CORS })
      const limit = Math.min(parseInt(q.get('limit') || '12', 10) || 12, 25)
      // country=CN 用中国区商店，华语匹配和中文元数据更准
      const api = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=${limit}&country=CN`
      const res = await fetch(api, { headers: ITUNES_HEADERS })
      const data = await res.json().catch(() => null)
      const songs = (data?.results || [])
        .map(mapItunesTrack)
        .filter(s => s.preview) // 没试听链接的丢掉（放不了）
      return Response.json({ ok: true, songs }, { headers: CORS })
    }

    if (url.pathname === '/itunes/playurl') {
      const id = (q.get('id') || '').trim()
      if (!/^\d+$/.test(id)) {
        return Response.json({ ok: false, url: null, br: 0, code: -1 }, { headers: CORS })
      }
      const api = `https://itunes.apple.com/lookup?id=${id}&country=CN`
      const res = await fetch(api, { headers: ITUNES_HEADERS })
      const data = await res.json().catch(() => null)
      const track = (data?.results || [])[0]
      const preview = httpsify(track?.previewUrl || '')
      return Response.json({
        ok: !!preview,
        url: preview || null,
        br: 0,
        code: preview ? 0 : -1,
      }, { headers: CORS })
    }

    // iTunes 没有歌词接口，返回空（前端已容错）
    if (url.pathname === '/itunes/lyric') {
      return Response.json({ ok: true, lrc: '', tlyric: '' }, { headers: CORS })
    }

    // 数据源探测：ping 一下搜索，透传上游状态给前端
    if (url.pathname === '/itunes/status') {
      let probe = null
      try {
        const api = 'https://itunes.apple.com/search?term=%E5%91%A8%E6%9D%B0%E4%BC%A6&media=music&entity=song&limit=3&country=CN'
        const res = await fetch(api, { headers: ITUNES_HEADERS })
        const text = await res.text()
        let data = null
        try { data = JSON.parse(text) } catch {}
        probe = {
          httpStatus: res.status,
          resultCount: (data?.results || []).length,
          rawSnippet: text.slice(0, 200),
        }
      } catch (e) {
        probe = { error: `${e.name}: ${e.message}` }
      }
      return Response.json({
        ok: true,
        source: 'Apple Music 试听',
        probe,
      }, { headers: CORS })
    }

    return Response.json({ error: 'unknown itunes route' }, { status: 404, headers: CORS })
  } catch (e) {
    return Response.json({ error: `${e.name}: ${e.message}` }, { status: 500, headers: CORS })
  }
}

export async function handleNeteaseControlApi(request, env) {
  const url = new URL(request.url)
  const authKey = url.searchParams.get('authKey') || url.searchParams.get('key') || ''
  const referer = request.headers.get('Referer') || ''
  const keyOk = !!env.MUSIC_AUTH_KEY && authKey === env.MUSIC_AUTH_KEY
  const refOk = referer.includes('xiaoman.xyz') || referer.includes('pink-chat-blt.pages.dev')
  if (!keyOk && !refOk) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
  }

  if (url.pathname === '/netease/lyric' && request.method === 'GET') {
    const id = (url.searchParams.get('id') || '').trim()
    if (!/^\d+$/.test(id)) return Response.json({ ok: false, error: 'invalid song id' }, { status: 400, headers: CORS })
    if (env.VPS_SERVICE_KEY) {
      try {
        const bridgeResponse = await fetch(`https://companion.xiaoman.xyz/netease/lyric?id=${id}`, { headers: { 'X-VPS-Key': env.VPS_SERVICE_KEY } })
        const bridgeData = await bridgeResponse.json().catch(() => null)
        if (bridgeResponse.ok && bridgeData?.ok) return Response.json(bridgeData, { headers: CORS })
      } catch { /* use direct fallback */ }
    }
    try {
      const upstream = await fetch(`https://music.163.com/api/song/lyric?id=${id}&lv=1&kv=1&tv=-1`, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/' } })
      const data = await upstream.json().catch(() => null)
      if (!upstream.ok || !data) throw new Error(`HTTP ${upstream.status}`)
      return Response.json({ ok: true, lrc: data.lrc?.lyric || '', tlyric: data.tlyric?.lyric || '' }, { headers: CORS })
    } catch (error) {
      return Response.json({ ok: false, error: `歌词上游失败: ${error.message}` }, { status: 502, headers: CORS })
    }
  }

  if (url.pathname === '/netease/playback' && request.method === 'POST') {
    if (!env.VPS_SERVICE_KEY) return Response.json({ ok: true, synced: false }, { headers: CORS })
    const body = await request.json().catch(() => ({}))
    if (body?.active === false) {
      try {
        const bridgeResponse = await fetch('https://companion.xiaoman.xyz/netease/playback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-VPS-Key': env.VPS_SERVICE_KEY },
          body: JSON.stringify({ active: false }),
        })
        const data = await bridgeResponse.json().catch(() => null)
        return Response.json(data || { ok: bridgeResponse.ok }, { status: bridgeResponse.status, headers: CORS })
      } catch (error) {
        return Response.json({ ok: false, error: `播放状态同步失败: ${error.message}` }, { status: 502, headers: CORS })
      }
    }
    if (!/^\d+$/.test(String(body.songId || ''))) return Response.json({ ok: false, error: 'invalid song id' }, { status: 400, headers: CORS })
    try {
      const bridgeResponse = await fetch('https://companion.xiaoman.xyz/netease/playback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-VPS-Key': env.VPS_SERVICE_KEY },
        body: JSON.stringify(body),
      })
      const data = await bridgeResponse.json().catch(() => null)
      return Response.json(data || { ok: bridgeResponse.ok }, { status: bridgeResponse.status, headers: CORS })
    } catch (error) {
      return Response.json({ ok: false, error: `播放状态同步失败: ${error.message}` }, { status: 502, headers: CORS })
    }
  }

  if (url.pathname !== '/netease/search' || request.method !== 'GET') {
    return Response.json({ error: 'unknown netease route' }, { status: 404, headers: CORS })
  }

  const keywords = (url.searchParams.get('keywords') || '').trim().slice(0, 100)
  const wantedTitle = (url.searchParams.get('title') || '').trim().slice(0, 100)
  const wantedArtist = (url.searchParams.get('artist') || '').trim().slice(0, 100)
  if (!keywords) return Response.json({ ok: true, songs: [] }, { headers: CORS })
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '12', 10) || 12, 1), 20)

  // NetEase returns an empty catalog to Cloudflare datacenter IPs. Reuse the
  // already-authenticated VPS bridge for metadata search; playback itself
  // still happens only in the user's official mobile app.
  if (env.VPS_SERVICE_KEY) {
    try {
      const bridgeUrl = new URL('https://companion.xiaoman.xyz/netease/search')
      bridgeUrl.searchParams.set('keywords', keywords)
      bridgeUrl.searchParams.set('title', wantedTitle || keywords)
      if (wantedArtist) bridgeUrl.searchParams.set('artist', wantedArtist)
      bridgeUrl.searchParams.set('limit', String(limit))
      const bridgeResponse = await fetch(bridgeUrl, { headers: { 'X-VPS-Key': env.VPS_SERVICE_KEY } })
      const bridgeData = await bridgeResponse.json().catch(() => null)
      if (bridgeResponse.ok && bridgeData?.ok && bridgeData.songs?.length) {
        return Response.json(bridgeData, { headers: CORS })
      }
    } catch {
      // Fall through to direct search for local development/temporary VPS downtime.
    }
  }
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer': 'https://music.163.com/',
  }
  if (env.NCM_COOKIE) headers.Cookie = env.NCM_COOKIE

  try {
    const upstream = await fetch('https://music.163.com/api/search/get', {
      method: 'POST',
      headers,
      // Fetch a wider candidate pool because this legacy endpoint often puts
      // covers/remixes before the requested original recording.
      body: new URLSearchParams({ s: keywords, type: '1', limit: '100', offset: '0' }).toString(),
    })
    const data = await upstream.json().catch(() => null)
    if (!upstream.ok || !data) {
      return Response.json({ ok: false, error: `网易云搜索上游 HTTP ${upstream.status}` }, { status: 502, headers: CORS })
    }
    const normalize = (value) => String(value || '').toLocaleLowerCase('zh-CN').replace(/[\s·・•,，.。:：()（）[\]【】《》〈〉'"“”‘’_-]/g, '')
    const titleNeedle = normalize(wantedTitle)
    const artistNeedle = normalize(wantedArtist)
    let songs = (data.result?.songs || []).map((song, index) => ({
      id: song.id,
      name: song.name || '',
      artists: (song.artists || song.ar || []).map((artist) => artist.name || '').filter(Boolean).join(' / '),
      album: song.album?.name || song.al?.name || '',
      cover: song.album?.picUrl || song.al?.picUrl || '',
      duration: Math.round(Number(song.duration || song.dt || 0) / 1000),
      _index: index,
    })).filter((song) => /^\d+$/.test(String(song.id))).map((song) => {
      const name = normalize(song.name)
      const artists = normalize(song.artists)
      let score = 0
      if (titleNeedle) score += name === titleNeedle ? 120 : (name.includes(titleNeedle) ? 35 : 0)
      if (artistNeedle) score += artists === artistNeedle ? 120 : (artists.includes(artistNeedle) ? 55 : 0)
      if (titleNeedle && name !== titleNeedle && /翻唱|翻自|伴奏|dj|live|版/i.test(song.name)) score -= 25
      return { ...song, _score: score }
    }).sort((a, b) => b._score - a._score || a._index - b._index).slice(0, limit)
      .map(({ _index, _score, ...song }) => song)
    try {
      const ids = songs.map((song) => song.id).join(',')
      if (ids) {
        const detailResponse = await fetch(`https://music.163.com/api/song/detail?ids=[${ids}]`, {
          headers: { 'User-Agent': headers['User-Agent'], 'Referer': headers.Referer, ...(headers.Cookie ? { Cookie: headers.Cookie } : {}) },
        })
        const details = await detailResponse.json().catch(() => null)
        const covers = new Map((details?.songs || []).map((song) => [String(song.id), song.album?.picUrl || song.al?.picUrl || '']))
        songs = songs.map((song) => ({ ...song, cover: song.cover || covers.get(String(song.id)) || '' }))
      }
    } catch {
      // The app-opening action only needs a song id; artwork is best-effort.
    }
    return Response.json({ ok: true, source: 'netease-catalog', songs }, { headers: CORS })
  } catch (error) {
    return Response.json({ ok: false, error: `${error.name}: ${error.message}` }, { status: 502, headers: CORS })
  }
}

// ── NetEase Cloud Music OpenAPI proxy（RSA 签名走开放平台）───────
// 说明：这套是走网易云开放平台 OAuth 的另一条路，历史遗留、前端未使用。
// 保留在这里是因为 Worker 的其它入口（如手动 /music/qrcode 扫码流程）
// 可能还挂着；如需彻底移除也很直接。

const NCM_BASE = 'https://openapi.music.163.com'

const NCM_DEVICE = {
  channel: 'ncmcli',
  deviceId: 'eunoia_web_001',
  deviceType: 'openapi',
  appVer: '0.1.6',
  os: 'ncmcli',
  osVer: '1.0',
  brand: 'ncmcli',
  model: 'Linux_x64_cli',
  clientIp: '192.0.2.2',
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

  // Auth: key matches the MUSIC_AUTH_KEY secret OR Referer from xiaoman.xyz
  const authKey = params.authKey || url.searchParams.get('authKey') || params.key || url.searchParams.get('key') || ''
  const referer = request.headers.get('Referer') || ''
  const keyOk = !!env.MUSIC_AUTH_KEY && authKey === env.MUSIC_AUTH_KEY
  if (!keyOk && !referer.includes('xiaoman.xyz')) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
  }

  try {
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
  const signedUrl = await buildNcmUrl(env, upstreamPath, bizContent, { accessToken })
  if (pathname === '/music/search') {
    const device_raw = JSON.stringify({
      channel: 'ncmcli', deviceId: 'eunoia_web_001', deviceType: 'openapi',
      appVer: '0.1.6', os: 'ncmcli', osVer: '1.0',
      brand: 'ncmcli', model: 'Linux_x64_cli', clientIp: '2a06:98c0:3600::103',
    })
    const bizContent_raw = JSON.stringify(bizContent)
    const timestamp = Date.now().toString()
    // Sign base: appId, bizContent, device, signType, timestamp — NO accessToken, NO appSecret
    const signBase = `appId=${env.NCM_APP_ID}&bizContent=${bizContent_raw}&device=${device_raw}&signType=RSA_SHA256&timestamp=${timestamp}`
    const sign = await rsaSign(env.NCM_PRIVATE_KEY, signBase)

    // POST body: all fields + accessToken + sign (no appSecret)
    const bodyFields = { appId: env.NCM_APP_ID, bizContent: bizContent_raw, device: device_raw, signType: 'RSA_SHA256', timestamp, sign }
    if (accessToken) bodyFields.accessToken = accessToken
    const body = new URLSearchParams(bodyFields).toString()
    const res = await fetch(`${NCM_BASE}${upstreamPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'ncm-cli/0.1.6',
        'Referer': 'https://music.163.com',
      },
      body,
    })
    const text = await res.text()
    return Response.json({
      http_status: res.status,
      response_text: text.substring(0, 1000),
      signString: signBase,
      sign_value: sign,
      device_in_sign: device_raw,
      device_in_body: new URLSearchParams(body).get('device'),
    }, { headers: CORS })
  }
  return Response.json({ url: signedUrl.url }, { headers: CORS })
}

// Build a signed NCM GET URL without fetching (frontend will fetch directly)
async function buildNcmUrl(env, path, bizContentObj, { accessToken } = {}) {
  const device_raw = JSON.stringify(NCM_DEVICE)
  const bizContent_raw = JSON.stringify(bizContentObj)
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
  const allParams = { ...signParams, sign }
  const query = Object.keys(allParams).sort()
    .map(k => `${k}=${encodeURIComponent(allParams[k])}`)
    .join('&')
  return { url: `${NCM_BASE}${path}?${query}`, signBase }
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
  return { status: res.status, data }
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

// ── Web Push（VAPID RFC 8292 + aes128gcm RFC 8291，纯 WebCrypto 零依赖）──
// 私钥来自 Worker Secret VAPID_PRIVATE_KEY；公钥是公开信息，与前端
// src/services/push.js 中的常量一致。

const VAPID_PUBLIC_KEY = 'BMt7bfuZSZsuIQGuLp0QGZKbdPNwr1oZ9esLiS-Gu_Pm4gfKx9ymV-CxLcH1M1P2OCreeRXlKAXftcRPhNJFgNY'

function b64uToBytes(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const bin = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64u(bytes) {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function utf8(s) {
  return new TextEncoder().encode(s)
}

function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

async function hkdf(ikm, salt, info, byteLen) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info }, key, byteLen * 8)
  return new Uint8Array(bits)
}

async function vapidJwt(env, audience) {
  const pub = b64uToBytes(VAPID_PUBLIC_KEY)
  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64u(pub.slice(1, 33)),
    y: bytesToB64u(pub.slice(33, 65)),
    d: env.VAPID_PRIVATE_KEY,
  }
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const header = bytesToB64u(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = bytesToB64u(utf8(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT || 'mailto:xw06085@gmail.com',
  })))
  const input = `${header}.${claims}`
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(input))
  return `${input}.${bytesToB64u(new Uint8Array(sig))}`
}

// RFC 8291: ECDH(P-256) + HKDF → AES-128-GCM，Content-Encoding: aes128gcm
async function encryptPushPayload(subscription, payloadStr) {
  const uaPub = b64uToBytes(subscription.keys.p256dh)   // 65B 未压缩公钥
  const authSecret = b64uToBytes(subscription.keys.auth) // 16B

  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256))

  const keyInfo = concatBytes(utf8('WebPush: info\0'), uaPub, asPub)
  const ikm = await hkdf(ecdhSecret, authSecret, keyInfo, 32)

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\0'), 12)

  // 明文末尾追加 0x02 = 最后一条记录的分隔符
  const plaintext = concatBytes(utf8(payloadStr), new Uint8Array([2]))
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext))

  // aes128gcm 头：salt(16) + 记录大小(4, BE) + 公钥长度(1) + 发送方公钥(65)
  const header = new Uint8Array(16 + 4 + 1 + asPub.length)
  header.set(salt, 0)
  new DataView(header.buffer).setUint32(16, 4096)
  header[20] = asPub.length
  header.set(asPub, 21)
  return concatBytes(header, ct)
}

async function sendWebPush(env, subscription, payloadStr) {
  const endpoint = subscription.endpoint
  const aud = new URL(endpoint).origin
  const [jwt, body] = await Promise.all([
    vapidJwt(env, aud),
    encryptPushPayload(subscription, payloadStr),
  ])
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${jwt}, k=${VAPID_PUBLIC_KEY}`,
      TTL: '86400',
      Urgency: 'high',
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
    },
    body,
  })
  // Push services return a real diagnostic body on rejection (Apple in
  // particular) — surfacing it is the difference between guessing and
  // actually knowing why a send failed. Only read it on non-2xx so a normal
  // successful send (body is empty anyway) pays no extra cost.
  const bodyText = res.ok ? null : await res.text().catch(() => null)
  return { status: res.status, bodyText }
}

// 给该用户的所有订阅设备推送；永久性失败的订阅顺手清掉
async function sendPushToUser(env, password, payload) {
  const key = `user:${password}:push:subs`
  const stored = await kvGetJson(env, key)
  const list = Array.isArray(stored) ? stored : []
  if (!list.length) return { ok: false, error: 'no push subscriptions' }
  const payloadStr = JSON.stringify(payload)
  const results = []
  const alive = []
  for (const sub of list) {
    try {
      const { status, bodyText } = await sendWebPush(env, sub, payloadStr)
      results.push({ endpoint: sub.endpoint.slice(0, 60), status, ...(bodyText ? { body: bodyText.slice(0, 300) } : {}) })
      // Any 4xx (except 429, which is transient rate-limiting, not a broken
      // subscription) means the push service itself has given up on this
      // subscription for good — 404/410 (gone), 400 with reason
      // VapidPkHashMismatch (subscription tied to a since-rotated VAPID key,
      // confirmed live 2026-08-05 after regenerating the keypair), etc.
      // Keeping a permanently-dead subscription around just means it fails
      // silently forever instead of the device ever getting a chance to
      // re-subscribe and actually receive pushes again.
      if (status >= 400 && status < 500 && status !== 429) continue
      alive.push(sub)
    } catch (e) {
      results.push({ endpoint: sub.endpoint.slice(0, 60), error: `${e.name}: ${e.message}` })
      alive.push(sub)
    }
  }
  if (alive.length !== list.length) {
    await env.CHAT_KV.put(key, JSON.stringify(alive))
  }
  return { ok: results.some(r => r.status >= 200 && r.status < 300), results }
}

// ── Proactive message generation (session-aware) ─────────────────

// 用户密码只能来自 Worker Secret（wrangler secret put USER_PASSWORD），
// 不允许硬编码在源码里
function getUserPassword(env) {
  return env.USER_PASSWORD || null
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

// Fixed VPS runtimes have their own message protocols.  The ordinary API
// worker must never generate for either one: Claude Code has the companion's
// VPS-native proactive pipeline, while Codex has no ordinary-worker proactive
// pipeline at all.  Keeping this as an explicit predicate prevents a
// Codex session selected in the synced settings from becoming a target by
// accident.
export function isFixedVpsSession(session) {
  const providerName = session?.providerName
  return providerName === 'claude-code-vps' || providerName === 'codex-vps'
}

export function ordinaryProactiveEnabled(settings) {
  // The field was added after the worker shipped.  Undefined therefore
  // means "preserve the old behaviour" for existing synced settings.
  return settings?.apiProactiveEnabled !== false
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
  }
  if (!password) {
    return { ...debug, error: 'USER_PASSWORD secret not set — run: wrangler secret put USER_PASSWORD', savedToKV: false }
  }

  // 1. Load synced settings
  const settings = await kvGetJson(env, `user:${password}:settings`)
  if (!settings) {
    return { ...debug, error: 'no settings in KV for this user', savedToKV: false }
  }

  if (!ordinaryProactiveEnabled(settings)) {
    return { ...debug, skipped: 'ordinary API proactive messages are disabled', savedToKV: false }
  }

  // 2. Target session
  const session = resolveTargetSession(settings)
  if (!session) {
    return { ...debug, error: 'no sessions found in settings', savedToKV: false }
  }
  if (isFixedVpsSession(session)) {
    // This session is bound to the VPS-resident Claude Code companion, which
    // runs its own proactive-message pipeline when applicable.  Codex is a
    // separate fixed VPS runtime and is intentionally not handled by this
    // worker either.  Neither one should ever receive an Eunoia
    // persona/context prompt or an API-generated pending message.
    return { ...debug, skipped: `target session is fixed VPS runtime (${session.providerName})`, savedToKV: false, targetSessionId: session.id }
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

  // 10. Web Push：把主动消息推到已订阅的设备（未配置 VAPID 或未订阅时静默跳过）
  if (env.VAPID_PRIVATE_KEY) {
    try {
      const aiName = session.aiName || settings.aiName || '小满'
      debug.push = await sendPushToUser(env, password, {
        title: `${aiName} 🌸`,
        body: result.text.slice(0, 120),
        // Carry the target through the notification click.  A bare `/` used
        // to focus whichever window happened to be open, so a notification
        // generated for another session looked like an empty Codex/CC chat.
        url: `/?session=${encodeURIComponent(session.id)}&source=api-proactive`,
        tag: `eunoia-${session.id}`,
      })
    } catch (e) {
      debug.push = { ok: false, error: `${e.name}: ${e.message}` }
    }
  }

  return debug
}

// ── Google Drive (diary letters) ────────────────────────────────────
// OAuth against the real Google account that owns the folder — NOT a
// service account. Service accounts have no storage quota of their own, so
// even with Editor access to a personal (non-Workspace) folder, file
// creation gets rejected with storageQuotaExceeded; a Shared Drive would
// fix that but requires a paid Workspace plan. This uses a refresh token
// obtained once via a manual consent flow (see AGENTS/DEPLOY_INFO for the
// one-time steps) — GOOGLE_DRIVE_OAUTH_CLIENT_ID/_SECRET/_REFRESH_TOKEN,
// all set via `wrangler secret put`. GOOGLE_DRIVE_DIARY_FOLDER_ID is the
// Drive folder itself (Owner = the same account, so no quota problem).
//
// Module-scope cache: Worker isolates are frequently reused warm across
// requests, so this saves a token-refresh round trip most of the time — but
// nothing here assumes it survives, a cold isolate just re-fetches.
let _driveTokenCache = null // { token, exp }

function driveConfigured(env) {
  return !!(env.GOOGLE_DRIVE_OAUTH_CLIENT_ID && env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET &&
    env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN && env.GOOGLE_DRIVE_DIARY_FOLDER_ID)
}

async function driveGetAccessToken(env) {
  const now = Date.now()
  if (_driveTokenCache && _driveTokenCache.exp > now + 60_000) return _driveTokenCache.token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_DRIVE_OAUTH_CLIENT_ID,
      client_secret: env.GOOGLE_DRIVE_OAUTH_CLIENT_SECRET,
      refresh_token: env.GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`drive token refresh failed: ${res.status} ${JSON.stringify(data)}`)
  _driveTokenCache = { token: data.access_token, exp: now + data.expires_in * 1000 }
  return _driveTokenCache.token
}

async function driveGetLatestFile(env) {
  const token = await driveGetAccessToken(env)
  const q = encodeURIComponent(`'${env.GOOGLE_DRIVE_DIARY_FOLDER_ID}' in parents and trashed=false`)
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,createdTime)&orderBy=createdTime desc&pageSize=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`drive list failed: ${res.status} ${JSON.stringify(data)}`)
  return data.files?.[0] || null
}

async function driveListBySession(env, sessionId, limit) {
  const token = await driveGetAccessToken(env)
  const escaped = sessionId.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const q = encodeURIComponent(
    `'${env.GOOGLE_DRIVE_DIARY_FOLDER_ID}' in parents and trashed=false and properties has { key='sessionId' and value='${escaped}' }`
  )
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,createdTime,properties)&orderBy=createdTime desc&pageSize=${limit}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await res.json()
  if (!res.ok) throw new Error(`drive list failed: ${res.status} ${JSON.stringify(data)}`)
  const files = data.files || []
  // Newest-first from the API, reversed to oldest-of-the-recent-N-first —
  // matches the old local getLettersByCharacter(...).slice(-5) ordering.
  return files.reverse().map(f => ({
    id: f.id,
    date: f.properties?.date || '',
    mood: f.properties?.mood || '',
    weather: f.properties?.weather || '',
    role: f.properties?.role || 'user',
  }))
}

async function driveReadFile(env, fileId) {
  const token = await driveGetAccessToken(env)
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`drive read failed: ${res.status} ${await res.text()}`)
  return res.json()
}

async function driveCreateFile(env, letter) {
  const token = await driveGetAccessToken(env)
  const metadata = {
    name: `${new Date(letter.createdAt).toISOString()}-${letter.role}.json`,
    parents: [env.GOOGLE_DRIVE_DIARY_FOLDER_ID],
    mimeType: 'application/json',
    // Mirrored onto the file itself (not just inside its JSON body) so
    // /diary/list can build a per-session index via a single files.list
    // call — metadata only, never downloading letter bodies just to know
    // they exist (see the "index, not content" note on the system-prompt
    // injection in useChat.js).
    properties: {
      sessionId: letter.sessionId || '',
      role: letter.role,
      mood: letter.mood,
      weather: letter.weather,
      date: letter.date,
    },
  }
  const boundary = `diary-${crypto.randomUUID()}`
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(letter)}\r\n` +
    `--${boundary}--`
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(`drive create failed: ${res.status} ${JSON.stringify(data)}`)
  return data.id
}
