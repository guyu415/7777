const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED_ORIGINS = new Set(['https://eunoia.xiaoman.xyz', 'https://pink-chat-blt.pages.dev', 'https://chat.xiaoman.xyz'])
const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('')
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('')
const tags = value => [...new Set(String(value || '').split(/[,，、\s]+/).filter(Boolean))].slice(0, 20).join(' ').slice(0, 400)
const metaKey = (owner, id) => `memes:${owner}:meta:${id}`
const imageKey = (owner, id) => `memes:${owner}:image:${id}`
function mime(bytes) {
  const str = (s, e) => String.fromCharCode(...bytes.slice(s, e))
  if (bytes[0] === 137 && str(1, 4) === 'PNG' && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if (['GIF87a', 'GIF89a'].includes(str(0, 6))) return 'image/gif'
  if (str(0, 4) === 'RIFF' && str(8, 12) === 'WEBP') return 'image/webp'
  return null
}
async function userOwner(request, env) {
  const password = request.headers.get('X-Eunoia-Password')
  if (!password || password.length > 1024) return null
  if (password !== env.USER_PASSWORD && !(await env.CHAT_KV.get(`user:${password}:settings`))) return null
  return hash(password)
}
async function bridgeOwner(request, env) {
  const auth = request.headers.get('Authorization') || ''
  if (!auth.startsWith('Bearer ') || auth.length > 200) return null
  const owner = await env.CHAT_KV.get(`memes:token:${await hash(auth.slice(7))}`)
  if (!owner) return null
  const active = await env.CHAT_KV.get(`memes:${owner}:bridge`)
  return active === await hash(auth.slice(7)) ? owner : null
}
async function list(env, owner, query = '', limit = 100) {
  const keys = []; let cursor
  do {
    const page = await env.CHAT_KV.list({ prefix: `memes:${owner}:meta:`, limit: 1000, ...(cursor ? { cursor } : {}) })
    keys.push(...page.keys); cursor = page.list_complete ? null : page.cursor
  } while (cursor && keys.length < 1000)
  const rows = (await Promise.all(keys.map(k => env.CHAT_KV.get(k.name, 'json')))).filter(Boolean)
  const terms = query.toLowerCase().trim().split(/[,，、\s]+/).filter(Boolean).slice(0, 8)
  return rows.filter(m => !terms.length || terms.some(t => (m.name + ' ' + m.tags).toLowerCase().includes(t))).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}
async function getImage(env, owner, id) {
  const meta = await env.CHAT_KV.get(metaKey(owner, id), 'json')
  if (!meta) return null
  const bytes = await env.CHAT_KV.get(imageKey(owner, id), 'arrayBuffer')
  return bytes ? { meta, bytes } : null
}
export async function handleMemeRequest(request, env) {
  const url = new URL(request.url), path = url.pathname
  if (!path.startsWith('/memes/')) return null
  const origin = request.headers.get('Origin'), cors = origin && ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Eunoia-Password', 'Vary': 'Origin' } : {}
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ error: '不允许此页面访问。' }, 403)
  try {
    if (!env.CHAT_KV) return json({ error: '表情包库暂时不可用。' }, 503, cors)
    if (path === '/memes/bridge/claim' && request.method === 'POST') {
      const { code } = await request.json()
      if (typeof code !== 'string' || !/^[a-f0-9]{48}$/.test(code)) return json({ error: '连接码不正确。' }, 400)
      const pair = await env.CHAT_KV.get(`memes:pair:${await hash(code)}`, 'json')
      if (!pair || pair.expiresAt < Date.now()) return json({ error: '连接码已过期，请重新生成。' }, 410)
      await env.CHAT_KV.delete(`memes:pair:${await hash(code)}`)
      return json({ token: pair.token, libraryUrl: 'https://eunoia.xiaoman.xyz/?view=memes', scope: 'memes:read' })
    }
    const isBridge = path.startsWith('/memes/bridge/')
    const owner = isBridge ? await bridgeOwner(request, env) : await userOwner(request, env)
    if (!owner) return json({ error: '请先登录小手机，或重新连接表情包库。' }, 401, cors)
    if ((path === '/memes/api' || path === '/memes/bridge/search') && request.method === 'GET') {
      return json({ memes: await list(env, owner, (url.searchParams.get('q') || '').slice(0,200), isBridge ? 12 : 100) }, 200, cors)
    }
    const imageMatch = path.match(/^\/memes\/(image|bridge\/image)\/([a-f0-9-]{36})$/)
    if (imageMatch && request.method === 'GET') {
      const found = await getImage(env, owner, imageMatch[2]); if (!found) return json({ error: '没有找到这张表情包。' }, 404, cors)
      if (isBridge) {
        const bytes = new Uint8Array(found.bytes); let str = ''
        for (let i=0;i<bytes.length;i+=8192) str += String.fromCharCode(...bytes.subarray(i,i+8192))
        return json({ meme: found.meta, dataUri: `data:${found.meta.mime};base64,${btoa(str)}` })
      }
      return new Response(found.bytes, { headers: { ...cors, 'Content-Type': found.meta.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
    }
    if (isBridge) return json({ error: '连接只允许读取表情包。' }, 405)
    if (path === '/memes/api' && request.method === 'POST') {
      if (Number(request.headers.get('Content-Length') || 0) > MAX_BYTES+65536) return json({ error: '单张图片最多 5 MB。' }, 413, cors)
      const form = await request.formData(), file = form.get('file')
      if (!(file instanceof File) || !file.size || file.size > MAX_BYTES) return json({ error: '请选择 5 MB 以内的图片或 GIF。' }, 400, cors)
      const bytes = new Uint8Array(await file.arrayBuffer()), type = mime(bytes)
      if (!type) return json({ error: '支持 PNG、JPEG、WebP 和 GIF。' }, 400, cors)
      const name = String(form.get('name') || file.name).trim().slice(0,80)
      if (!name) return json({ error: '名字不能为空。' }, 400, cors)
      const meme = { id: crypto.randomUUID(), name, tags: tags(form.get('tags')), mime: type, size: file.size, createdAt: new Date().toISOString() }
      await env.CHAT_KV.put(imageKey(owner,meme.id), bytes)
      try { await env.CHAT_KV.put(metaKey(owner,meme.id), JSON.stringify(meme)) } catch(e) { await env.CHAT_KV.delete(imageKey(owner,meme.id)); throw e }
      return json({ meme }, 201, cors)
    }
    const item = path.match(/^\/memes\/api\/([a-f0-9-]{36})$/)
    if (item && ['PATCH','DELETE'].includes(request.method)) {
      const key = metaKey(owner,item[1]), m = await env.CHAT_KV.get(key,'json'); if(!m) return json({ error: '没有找到这张表情包。' },404,cors)
      if(request.method==='DELETE'){await env.CHAT_KV.delete(key);await env.CHAT_KV.delete(imageKey(owner,item[1]));return json({ok:true},200,cors)}
      const d = await request.json(), name = typeof d.name==='string'?d.name.trim().slice(0,80):''
      if(!name)return json({error:'名字不能为空。'},400,cors)
      const updated={...m,name,tags:tags(d.tags)};await env.CHAT_KV.put(key,JSON.stringify(updated));return json({meme:updated},200,cors)
    }
    if(path==='/memes/pair' && request.method==='POST'){
      const code=random(),token=random(),tokenHash=await hash(token),old=await env.CHAT_KV.get(`memes:${owner}:bridge`)
      if(old)await env.CHAT_KV.delete(`memes:token:${old}`)
      await env.CHAT_KV.put(`memes:token:${tokenHash}`,owner)
      await env.CHAT_KV.put(`memes:${owner}:bridge`,tokenHash)
      const expiresAt=Date.now()+10*60*1000
      await env.CHAT_KV.put(`memes:pair:${await hash(code)}`,JSON.stringify({token,expiresAt}),{expirationTtl:600})
      return json({code,expiresAt},200,cors)
    }
    if(path==='/memes/pair' && request.method==='DELETE'){
      const old=await env.CHAT_KV.get(`memes:${owner}:bridge`);if(old)await env.CHAT_KV.delete(`memes:token:${old}`)
      await env.CHAT_KV.delete(`memes:${owner}:bridge`);return json({ok:true},200,cors)
    }
    return json({error:'没有这个入口。'},404,cors)
  } catch(e) { console.error('[memes]',e);return json({error:'操作失败，请稍后重试。'},503,cors) }
}
