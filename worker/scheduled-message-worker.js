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

    // ── Bilibili 音频代理（前端碟片播放器用）─────────────────────
    if (pathname.startsWith('/bili/') && request.method === 'GET') {
      return handleBiliWebApi(request, env)
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

// ── Bilibili 视频区代理（/bili/*）────────────────────────────────
// 迭代史：
//   1. 网易云直连（/ncm/*）：网易按 TCP 源 IP 做地区限制，Worker 出口
//      全在境外，realIP 头/加密体伪装全被忽略，大量曲目 404。
//   2. B 站音频区（/audio/music-service-c/*）：那套 API 在 2023 后期
//      开始对匿名请求返回 HTTP 412 + 反爬 HTML（B 站现在强制 WBI 签名
//      + buvid3 cookie），且 audio 区本身早已收缩、曲库很小。
//   3. 现在：走 B 站视频区。
//        搜索：/x/web-interface/wbi/search/type?search_type=video（WBI 签名）
//        播放：bvid → view 拿 cid → wbi/playurl 拿 dash.audio.baseUrl
//        音频流：B 站 CDN 检查 Referer=bilibili.com，客户端直连会 403，
//               所以经 /bili/stream 反代（透传 Range，加 Referer）
// 曲库巨大（几乎所有中文歌都有 MV/翻唱/正版），代价是每首播放消耗一
// 点 Cloudflare 出站带宽。

const BILI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BILI_HEADERS = {
  'User-Agent': BILI_UA,
  'Referer': 'https://www.bilibili.com/',
}
// /bili/stream 反代的目标域名白名单（防止被当成开放代理滥用）
const STREAM_HOST_ALLOW = /(?:^|\.)(bilibili\.com|bilivideo\.com|bilivideo\.cn|hdslb\.com|akamaized\.net|acgvideo\.com)$/i

function httpsify(u) {
  return typeof u === 'string' ? u.replace(/^http:\/\//, 'https://') : u
}

// 搜索结果 title/author 会带 <em class="keyword"> 高亮，去掉
function stripHtml(s) {
  return typeof s === 'string' ? s.replace(/<[^>]+>/g, '') : ''
}

// 视频区搜索的 duration 是 "3:45" 或 "1:23:45"，转成秒
function parseDuration(s) {
  if (typeof s !== 'string') return 0
  const parts = s.split(':').map(n => parseInt(n, 10) || 0)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return 0
}

// ── WBI 签名 ────────────────────────────────────────────────────
// 从 nav 接口的 wbi_img.{img_url,sub_url} 抠出文件名基名作为
// img_key/sub_key，按固定 64 长度索引表打乱拼成 32 字符 mixin_key；
// 请求参数按 key 字典序 + wts + w_rid=md5(sortedQuery + mixin_key)

const WBI_MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
  61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
  36, 20, 34, 44, 52,
]

async function fetchWbiKeys(env) {
  try {
    const cached = await env.CHAT_KV.get('bili:wbi_keys')
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed?.img_key && parsed?.sub_key) return parsed
    }
  } catch {}
  try {
    const res = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: BILI_HEADERS })
    const data = await res.json().catch(() => null)
    const imgUrl = data?.data?.wbi_img?.img_url || ''
    const subUrl = data?.data?.wbi_img?.sub_url || ''
    const base = u => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
    const keys = { img_key: base(imgUrl), sub_key: base(subUrl) }
    if (keys.img_key && keys.sub_key) {
      try { await env.CHAT_KV.put('bili:wbi_keys', JSON.stringify(keys), { expirationTtl: 21600 }) } catch {}
      return keys
    }
  } catch {}
  return { img_key: '', sub_key: '' }
}

function mixinKey(img_key, sub_key) {
  const s = img_key + sub_key
  return WBI_MIXIN_KEY_ENC_TAB.map(i => s[i] || '').join('').slice(0, 32)
}

async function wbiSign(env, params) {
  const { img_key, sub_key } = await fetchWbiKeys(env)
  const mk = mixinKey(img_key, sub_key)
  const wts = Math.floor(Date.now() / 1000)
  const merged = { ...params, wts }
  // value 去除 B 站签名规则里禁止的 !'()* 字符，再按 key 字典序 URL 编码
  const query = Object.keys(merged).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(merged[k]).replace(/[!'()*]/g, ''))}`)
    .join('&')
  const w_rid = md5Hex(query + mk)
  return `${query}&w_rid=${w_rid}`
}

// buvid3：从 finger/spi 拿一个匿名指纹，B 站有些接口要 Cookie 带上
async function getBuvid3(env) {
  try {
    const cached = await env.CHAT_KV.get('bili:buvid3')
    if (cached) return cached
  } catch {}
  try {
    const res = await fetch('https://api.bilibili.com/x/frontend/finger/spi', { headers: BILI_HEADERS })
    const data = await res.json().catch(() => null)
    const buvid = data?.data?.b_3 || ''
    if (buvid) {
      try { await env.CHAT_KV.put('bili:buvid3', buvid, { expirationTtl: 86400 }) } catch {}
      return buvid
    }
  } catch {}
  return ''
}

async function biliHeaders(env) {
  const buvid = await getBuvid3(env)
  const h = { ...BILI_HEADERS }
  if (buvid) h.Cookie = `buvid3=${buvid}`
  return h
}

// 迷你 MD5（Workers WebCrypto 不支持 MD5，只能自己写）— RFC 1321
function md5Hex(msg) {
  const bytes = typeof msg === 'string' ? new TextEncoder().encode(msg) : new Uint8Array(msg)
  const bitLen = bytes.length * 8
  const withOne = new Uint8Array(bytes.length + 1)
  withOne.set(bytes)
  withOne[bytes.length] = 0x80
  const padLen = (56 - withOne.length % 64 + 64) % 64
  const buf = new Uint8Array(withOne.length + padLen + 8)
  buf.set(withOne)
  const dv = new DataView(buf.buffer)
  dv.setUint32(buf.length - 8, bitLen >>> 0, true)
  dv.setUint32(buf.length - 4, Math.floor(bitLen / 0x100000000) >>> 0, true)
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21]
  const K = new Int32Array(64)
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0
  let a0 = 0x67452301|0, b0 = 0xefcdab89|0, c0 = 0x98badcfe|0, d0 = 0x10325476|0
  const M = new Int32Array(16)
  for (let off = 0; off < buf.length; off += 64) {
    for (let i = 0; i < 16; i++) M[i] = dv.getInt32(off + i * 4, true)
    let a = a0, b = b0, c = c0, d = d0
    for (let i = 0; i < 64; i++) {
      let f, g
      if (i < 16)      { f = (b & c) | (~b & d); g = i }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16 }
      else if (i < 48) { f = b ^ c ^ d;          g = (3 * i + 5) % 16 }
      else             { f = c ^ (b | ~d);       g = (7 * i) % 16 }
      const t = d; d = c; c = b
      const x = (a + f + K[i] + M[g]) | 0
      const s = S[i]
      b = (b + ((x << s) | (x >>> (32 - s)))) | 0
      a = t
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0
  }
  const out = new Uint8Array(16)
  const outDv = new DataView(out.buffer)
  outDv.setInt32(0, a0, true); outDv.setInt32(4, b0, true); outDv.setInt32(8, c0, true); outDv.setInt32(12, d0, true)
  return [...out].map(b => b.toString(16).padStart(2, '0')).join('')
}

async function handleBiliWebApi(request, env) {
  const url = new URL(request.url)
  const q = url.searchParams

  // /bili/stream 是 <audio> 直接命中的，不做 auth 检查（安全靠域名白名单）
  if (url.pathname === '/bili/stream') {
    return handleBiliStream(request, q)
  }

  const authKey = q.get('authKey') || q.get('key') || ''
  const referer = request.headers.get('Referer') || ''
  const keyOk = !!env.MUSIC_AUTH_KEY && authKey === env.MUSIC_AUTH_KEY
  const refOk = referer.includes('xiaoman.xyz') || referer.includes('pink-chat-blt.pages.dev')
  if (!keyOk && !refOk) {
    return Response.json({ error: 'unauthorized' }, { status: 401, headers: CORS })
  }

  try {
    if (url.pathname === '/bili/search') {
      const keyword = (q.get('keywords') || '').slice(0, 100)
      if (!keyword) return Response.json({ ok: true, songs: [] }, { headers: CORS })
      const limit = Math.min(parseInt(q.get('limit') || '12', 10) || 12, 30)
      const signed = await wbiSign(env, {
        search_type: 'video',
        keyword,
        page: 1,
        page_size: limit,
        order: 'totalrank',
      })
      const headers = await biliHeaders(env)
      const res = await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${signed}`, { headers })
      const data = await res.json().catch(() => null)
      const songs = ((data?.data?.result || []).slice(0, limit)).map(x => ({
        id: x.bvid, // 现在 id 是 bvid 字符串（如 "BV1xxxxxxxxx"）
        name: stripHtml(x.title || ''),
        artists: stripHtml(x.author || ''),
        album: '',
        cover: httpsify((x.pic || '').replace(/^\/\//, 'https://')),
        duration: parseDuration(x.duration),
        fee: 0,
      }))
      return Response.json({ ok: true, songs }, { headers: CORS })
    }

    if (url.pathname === '/bili/playurl') {
      const bvid = (q.get('id') || '').trim()
      if (!/^BV[0-9A-Za-z]+$/.test(bvid)) {
        return Response.json({ ok: false, url: null, br: 0, code: -1, stage: 'invalid_bvid' }, { headers: CORS })
      }
      const headers = await biliHeaders(env)
      // Step 1: bvid → cid（拿第一个分 P）
      const viewRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { headers })
      const viewData = await viewRes.json().catch(() => null)
      const cid = viewData?.data?.cid
      if (!cid) {
        return Response.json({ ok: false, url: null, br: 0, code: viewData?.code ?? -1, stage: 'view' }, { headers: CORS })
      }
      // Step 2: bvid + cid → dash 音频流（fnval=16 才带 dash）
      const signed = await wbiSign(env, { bvid, cid, fnval: 16, fourk: 1 })
      const purlRes = await fetch(`https://api.bilibili.com/x/player/wbi/playurl?${signed}`, { headers })
      const purlData = await purlRes.json().catch(() => null)
      const audio = (purlData?.data?.dash?.audio || [])[0]
      const audioUrl = audio?.baseUrl || audio?.base_url
      if (!audioUrl) {
        return Response.json({ ok: false, url: null, br: 0, code: purlData?.code ?? -1, stage: 'playurl' }, { headers: CORS })
      }
      // 客户端不能直连 CDN（要 Referer=bilibili.com），走 /bili/stream 反代
      const proxied = `${url.origin}/bili/stream?u=${encodeURIComponent(audioUrl)}`
      return Response.json({
        ok: true,
        url: proxied,
        br: audio?.bandwidth || 0,
        code: 0,
      }, { headers: CORS })
    }

    // 视频没有内建歌词接口；返回空（前端已容错）
    if (url.pathname === '/bili/lyric') {
      return Response.json({ ok: true, lrc: '', tlyric: '' }, { headers: CORS })
    }

    // 数据源探测：ping 一下 wbi 视频搜索，透传上游状态给前端
    if (url.pathname === '/bili/status') {
      let probe = null
      try {
        const signed = await wbiSign(env, {
          search_type: 'video',
          keyword: '周杰伦',
          page: 1,
          page_size: 3,
          order: 'totalrank',
        })
        const headers = await biliHeaders(env)
        const res = await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${signed}`, { headers })
        const text = await res.text()
        let data = null
        try { data = JSON.parse(text) } catch {}
        probe = {
          httpStatus: res.status,
          upstreamCode: data?.code,
          upstreamMsg: data?.message || data?.msg,
          resultCount: (data?.data?.result || []).length,
          rawSnippet: text.slice(0, 300),
        }
      } catch (e) {
        probe = { error: `${e.name}: ${e.message}` }
      }
      return Response.json({
        ok: true,
        source: 'Bilibili 视频区',
        probe,
      }, { headers: CORS })
    }

    return Response.json({ error: 'unknown bili route' }, { status: 404, headers: CORS })
  } catch (e) {
    return Response.json({ error: `${e.name}: ${e.message}` }, { status: 500, headers: CORS })
  }
}

// 音频流反代：客户端 <audio> 直接命中，透传 Range，加 Referer 骗过 B 站 CDN
async function handleBiliStream(request, q) {
  const target = q.get('u') || ''
  let host = ''
  try { host = new URL(target).hostname } catch { return new Response('bad url', { status: 400 }) }
  if (!STREAM_HOST_ALLOW.test(host)) {
    return new Response('host not allowed', { status: 403 })
  }
  const headers = { ...BILI_HEADERS }
  const range = request.headers.get('Range')
  if (range) headers.Range = range
  const upstream = await fetch(target, { headers })
  const respHeaders = new Headers()
  respHeaders.set('Access-Control-Allow-Origin', '*')
  respHeaders.set('Accept-Ranges', 'bytes')
  const passthru = ['Content-Type', 'Content-Length', 'Content-Range', 'Cache-Control']
  for (const h of passthru) {
    const v = upstream.headers.get(h)
    if (v) respHeaders.set(h, v)
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  })
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

const VAPID_PUBLIC_KEY = 'BPKvBZCXuZkfYM2ecirl3U-2bbyeembT9Xzt8Z6LtO7_gAzAPLFhkBMfT0_bw3L_FczUdbzlF-Sst-a5fdpxI_w'

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
  return res.status
}

// 给该用户的所有订阅设备推送；404/410 的失效订阅顺手清掉
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
      const status = await sendWebPush(env, sub, payloadStr)
      results.push({ endpoint: sub.endpoint.slice(0, 60), status })
      if (status === 404 || status === 410) continue
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

  // 10. Web Push：把主动消息推到已订阅的设备（未配置 VAPID 或未订阅时静默跳过）
  if (env.VAPID_PRIVATE_KEY) {
    try {
      const aiName = session.aiName || settings.aiName || '小满'
      debug.push = await sendPushToUser(env, password, {
        title: `${aiName} 🌸`,
        body: result.text.slice(0, 120),
        url: '/',
        tag: `eunoia-${session.id}`,
      })
    } catch (e) {
      debug.push = { ok: false, error: `${e.name}: ${e.message}` }
    }
  }

  return debug
}
