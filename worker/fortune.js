const FORTUNE_PREFIX = 'fortune:session:'
const SIX_PALACES = ['大安', '留连', '速喜', '赤口', '小吉', '空亡']

const TRIGRAMS = {
  '111': '乾', '110': '兑', '101': '离', '100': '震',
  '011': '巽', '010': '坎', '001': '艮', '000': '坤',
}

const HEXAGRAM_MATRIX = {
  乾: { 乾: [1, '乾'], 兑: [10, '履'], 离: [13, '同人'], 震: [25, '无妄'], 巽: [44, '姤'], 坎: [6, '讼'], 艮: [33, '遁'], 坤: [12, '否'] },
  兑: { 乾: [43, '夬'], 兑: [58, '兑'], 离: [49, '革'], 震: [17, '随'], 巽: [28, '大过'], 坎: [47, '困'], 艮: [31, '咸'], 坤: [45, '萃'] },
  离: { 乾: [14, '大有'], 兑: [38, '睽'], 离: [30, '离'], 震: [21, '噬嗑'], 巽: [50, '鼎'], 坎: [64, '未济'], 艮: [56, '旅'], 坤: [35, '晋'] },
  震: { 乾: [34, '大壮'], 兑: [54, '归妹'], 离: [55, '丰'], 震: [51, '震'], 巽: [32, '恒'], 坎: [40, '解'], 艮: [62, '小过'], 坤: [16, '豫'] },
  巽: { 乾: [9, '小畜'], 兑: [61, '中孚'], 离: [37, '家人'], 震: [42, '益'], 巽: [57, '巽'], 坎: [59, '涣'], 艮: [53, '渐'], 坤: [20, '观'] },
  坎: { 乾: [5, '需'], 兑: [60, '节'], 离: [63, '既济'], 震: [3, '屯'], 巽: [48, '井'], 坎: [29, '坎'], 艮: [39, '蹇'], 坤: [8, '比'] },
  艮: { 乾: [26, '大畜'], 兑: [41, '损'], 离: [22, '贲'], 震: [27, '颐'], 巽: [18, '蛊'], 坎: [4, '蒙'], 艮: [52, '艮'], 坤: [23, '剥'] },
  坤: { 乾: [11, '泰'], 兑: [19, '临'], 离: [36, '明夷'], 震: [24, '复'], 巽: [46, '升'], 坎: [7, '师'], 艮: [15, '谦'], 坤: [2, '坤'] },
}

const MAJOR = [
  ['major00','愚者','RWS_Tarot_00_Fool.jpg'],
  ['major01','魔术师','RWS_Tarot_01_Magician.jpg'],
  ['major02','女祭司','RWS_Tarot_02_High_Priestess.jpg'],
  ['major03','皇后','RWS_Tarot_03_Empress.jpg'],
  ['major04','皇帝','RWS_Tarot_04_Emperor.jpg'],
  ['major05','教皇','RWS_Tarot_05_Hierophant.jpg'],
  ['major06','恋人','RWS_Tarot_06_Lovers.jpg'],
  ['major07','战车','RWS_Tarot_07_Chariot.jpg'],
  ['major08','力量','RWS_Tarot_08_Strength.jpg'],
  ['major09','隐士','RWS_Tarot_09_Hermit.jpg'],
  ['major10','命运之轮','RWS_Tarot_10_Wheel_of_Fortune.jpg'],
  ['major11','正义','RWS_Tarot_11_Justice.jpg'],
  ['major12','倒吊人','RWS_Tarot_12_Hanged_Man.jpg'],
  ['major13','死神','RWS_Tarot_13_Death.jpg'],
  ['major14','节制','RWS_Tarot_14_Temperance.jpg'],
  ['major15','恶魔','RWS_Tarot_15_Devil.jpg'],
  ['major16','高塔','RWS_Tarot_16_Tower.jpg'],
  ['major17','星星','RWS_Tarot_17_Star.jpg'],
  ['major18','月亮','RWS_Tarot_18_Moon.jpg'],
  ['major19','太阳','RWS_Tarot_19_Sun.jpg'],
  ['major20','审判','RWS_Tarot_20_Judgement.jpg'],
  ['major21','世界','RWS_Tarot_21_World.jpg'],
]
const SUITS = [
  ['wands','权杖','Wands'],
  ['cups','圣杯','Cups'],
  ['swords','宝剑','Swords'],
  ['pentacles','星币','Pents'],
]
const RANKS = ['王牌','二','三','四','五','六','七','八','九','十','侍从','骑士','王后','国王']
const TAROT = [
  ...MAJOR.map(([id, name, wiki]) => ({ id, name, wiki })),
  ...SUITS.flatMap(([suitId, suitName, wikiSuit]) => RANKS.map((rank, index) => ({
    id: `${suitId}${String(index + 1).padStart(2, '0')}`,
    name: `${suitName}${rank}`,
    wiki: `${wikiSuit}${String(index + 1).padStart(2, '0')}.jpg`,
  }))),
]
const TAROT_BY_ID = Object.fromEntries(TAROT.map(card => [card.id, card]))

function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new Error('invalid random range')
  const limit = Math.floor(0x100000000 / max) * max
  const values = new Uint32Array(1)
  do crypto.getRandomValues(values)
  while (values[0] >= limit)
  return values[0] % max
}

function pickUnique(items, count) {
  const pool = [...items]
  const out = []
  while (out.length < count && pool.length) out.push(pool.splice(randomInt(pool.length), 1)[0])
  return out
}

function palaceChain(values) {
  let cursor = 0
  return values.map((value, index) => {
    cursor = index === 0 ? (value - 1) % 6 : (cursor + value - 1) % 6
    return SIX_PALACES[cursor]
  })
}

export function resolveHexagram(yaos) {
  if (!Array.isArray(yaos) || yaos.length !== 6 || yaos.some(v => ![6,7,8,9].includes(Number(v)))) {
    throw new Error('六爻必须是六个 6/7/8/9，顺序自下而上')
  }
  const bits = yaos.map(v => Number(v) === 7 || Number(v) === 9 ? '1' : '0')
  const lower = TRIGRAMS[bits.slice(0, 3).join('')]
  const upper = TRIGRAMS[bits.slice(3, 6).join('')]
  const [number, name] = HEXAGRAM_MATRIX[upper][lower]

  const changedBits = yaos.map((v, i) => {
    const n = Number(v)
    return n === 6 || n === 9 ? (bits[i] === '1' ? '0' : '1') : bits[i]
  })
  const changedLower = TRIGRAMS[changedBits.slice(0, 3).join('')]
  const changedUpper = TRIGRAMS[changedBits.slice(3, 6).join('')]
  const [changedNumber, changedName] = HEXAGRAM_MATRIX[changedUpper][changedLower]
  const moving = yaos.map((v, i) => [6,9].includes(Number(v)) ? i + 1 : null).filter(Boolean)
  return { number, name, upper, lower, changedNumber, changedName, changedUpper, changedLower, moving }
}

function formatYao(value) {
  return ({ 6: '老阴 ⚋ ×', 7: '少阳 ⚊', 8: '少阴 ⚋', 9: '老阳 ⚊ ○' })[Number(value)]
}

function xiaoliurenFromNumbers(values) {
  if (!Array.isArray(values) || values.length !== 3 || values.some(v => !Number.isInteger(Number(v)) || Number(v) < 1)) {
    throw new Error('小六壬需要三个正整数')
  }
  const nums = values.map(Number)
  const palaces = palaceChain(nums)
  return {
    values: nums,
    palaces,
    face: `报数：${nums.join(' · ')}\n三宫：${palaces.join(' → ')}\n落宫：${palaces[2]}`,
  }
}

function liuyaoFromYaos(yaos) {
  const normalized = yaos.map(Number)
  const gua = resolveHexagram(normalized)
  const lines = normalized.map((value, i) => `${i + 1}爻（自下而上）：${formatYao(value)}`).join('\n')
  const change = gua.moving.length
    ? `动爻：${gua.moving.join('、')}爻\n之卦：第 ${gua.changedNumber} 卦 · ${gua.changedUpper}${gua.changedLower}${gua.changedName}`
    : '无动爻'
  return {
    yaos: normalized,
    ...gua,
    face: `${lines}\n本卦：第 ${gua.number} 卦 · ${gua.upper}${gua.lower}${gua.name}\n${change}`,
  }
}

function tarotDraw(count) {
  const n = Math.max(1, Math.min(10, Number(count) || 3))
  const positions = n === 1 ? ['当下'] : n === 3 ? ['起因 / 过去', '核心 / 现在', '走向 / 未来']
    : ['现状','阻力','根基','过去','可能','近期','自我','环境','希望与恐惧','结果']
  const cards = pickUnique(TAROT, n).map((card, index) => ({
    id: card.id,
    name: card.name,
    reversed: randomInt(3) === 0,
    position: positions[index] || `位置 ${index + 1}`,
  }))
  return {
    cards,
    face: cards.map((card, i) => `${i + 1}. ${card.position}：${card.name}（${card.reversed ? '逆位' : '正位'}）`).join('\n'),
  }
}

function shanghaiStamp(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).formatToParts(date)
    const get = type => parts.find(p => p.type === type)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')} · Asia/Shanghai`
  } catch {
    return date.toISOString()
  }
}

async function authorized(request, env) {
  const password = request.headers.get('X-Eunoia-Password') || ''
  if (!password || !env?.CHAT_KV) return false
  if (env.USER_PASSWORD && password === env.USER_PASSWORD) return true
  return !!(await env.CHAT_KV.get(`user:${password}:settings`))
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Eunoia-Password',
    'Cache-Control': 'no-store',
  } })
}

async function tarotCardImage(pathname) {
  const id = decodeURIComponent(pathname.slice('/api/fortune/tarot-card/'.length)).trim()
  const card = TAROT_BY_ID[id]
  if (!card) return new Response('not found', { status: 404 })
  const source = `https://commons.wikimedia.org/wiki/Special:Redirect/file/${encodeURIComponent(card.wiki)}`
  const upstream = await fetch(source, {
    redirect: 'follow',
    cf: { cacheEverything: true, cacheTtl: 604800 },
  })
  if (!upstream.ok || !upstream.body) return new Response('image unavailable', { status: 502 })
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/jpeg',
      'Cache-Control': 'public, max-age=604800, immutable',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

async function saveSession(env, session) {
  await env.CHAT_KV.put(`${FORTUNE_PREFIX}${session.id}`, JSON.stringify(session))
}

async function createSession(env, { question, method, mode, face, payload }) {
  const now = Date.now()
  const session = {
    id: `${now.toString(36)}-${crypto.randomUUID().slice(0, 8)}`,
    createdAt: now,
    question: String(question || '').trim().slice(0, 200),
    method,
    mode,
    face,
    payload,
    seal: shanghaiStamp(new Date(now)),
    verdict: '',
  }
  await saveSession(env, session)
  return session
}

function publicSession(session, includeFace = true) {
  return {
    id: session.id, createdAt: session.createdAt, question: session.question,
    method: session.method, mode: session.mode, seal: session.seal,
    verdict: session.verdict || '',
    ...(includeFace ? { face: session.face, payload: session.payload } : {}),
  }
}

function formatStampedFace(session) {
  return `🎐 卦局 ${session.id} 已落印 · ${session.seal}\n问：${session.question}\n────────────────\n${session.face}\n────────────────\n卦面由服务端生成并落账，只断不改。`
}

async function roll(request, env) {
  const body = await request.json()
  const question = String(body?.question || '').trim()
  const method = String(body?.method || body?.kind || '').trim()
  if (!question) return json({ error: '无事不占：先写下所问何事' }, 400)

  let result
  let mode
  if (method === 'xiaoliuren' || method === 'dice') {
    const values = [randomInt(6) + 1, randomInt(6) + 1, randomInt(6) + 1]
    result = xiaoliurenFromNumbers(values)
    mode = 'dice'
  } else if (method === 'liuyao' || method === 'coin') {
    const tosses = []
    const yaos = []
    for (let line = 0; line < 6; line += 1) {
      let backs = 0
      for (let coin = 0; coin < 3; coin += 1) backs += randomInt(2)
      tosses.push(backs)
      yaos.push(({ 3: 9, 2: 8, 1: 7, 0: 6 })[backs])
    }
    result = { tosses, ...liuyaoFromYaos(yaos) }
    mode = 'coin'
  } else if (method === 'tarot') {
    const count = body?.count === 10 ? 10 : body?.count === 1 ? 1 : 3
    result = tarotDraw(count)
    mode = count === 10 ? 'celtic' : count === 1 ? 'one' : 'three'
  } else {
    return json({ error: '正式起卦只支持 xiaoliuren / liuyao / tarot' }, 400)
  }

  const session = await createSession(env, { question, method: method === 'dice' ? 'xiaoliuren' : method === 'coin' ? 'liuyao' : method, mode, face: result.face, payload: result })
  return json({ ...publicSession(session), text: formatStampedFace(session) })
}

async function cast(request, env) {
  const body = await request.json()
  const question = String(body?.question || '').trim()
  const method = String(body?.method || '').trim()
  if (!question) return json({ error: '无事不占：先写下所问何事' }, 400)

  let result
  let mode = String(body?.mode || 'numbers')
  if (method === 'xiaoliuren') {
    result = xiaoliurenFromNumbers([body.a, body.b, body.c].map(Number))
    mode = 'numbers'
  } else if (method === 'liuyao') {
    const yaos = Array.isArray(body.yaos) ? body.yaos : String(body.yaos || '').trim().split(/\s+/).filter(Boolean)
    result = liuyaoFromYaos(yaos)
    mode = 'yao'
  } else if (method === 'tarot') {
    result = tarotDraw(body.count)
    mode = Number(body.count) === 10 ? 'celtic' : Number(body.count) === 1 ? 'one' : 'three'
  } else {
    return json({ error: 'method 只支持 xiaoliuren / liuyao / tarot' }, 400)
  }
  const session = await createSession(env, { question, method, mode, face: result.face, payload: result })
  return json({ ...publicSession(session), text: formatStampedFace(session) })
}

async function recent(url, env) {
  const limit = Math.max(1, Math.min(30, Number(url.searchParams.get('n')) || 8))
  const listed = await env.CHAT_KV.list({ prefix: FORTUNE_PREFIX, limit: 100 })
  const sessions = (await Promise.all(listed.keys.map(k => env.CHAT_KV.get(k.name, 'json'))))
    .filter(Boolean)
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .slice(0, limit)
    .map(s => publicSession(s, false))
  return json(sessions)
}

async function getOne(pathname, env) {
  const id = decodeURIComponent(pathname.slice('/api/fortune/session/'.length))
  const session = await env.CHAT_KV.get(`${FORTUNE_PREFIX}${id}`, 'json')
  return session ? json(publicSession(session)) : json({ error: 'no such session' }, 404)
}

async function verdict(request, env) {
  const body = await request.json()
  const id = String(body?.id || '').trim()
  const session = id ? await env.CHAT_KV.get(`${FORTUNE_PREFIX}${id}`, 'json') : null
  if (!session) return json({ error: 'no such session' }, 404)
  session.verdict = String(body?.verdict || '').trim().slice(0, 4000)
  await saveSession(env, session)
  return json({ ok: true, id })
}

export async function handleFortuneRequest(request, env) {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/api/fortune/')) return null
  if (request.method === 'OPTIONS') return json({ ok: true })
  if (url.pathname.startsWith('/api/fortune/tarot-card/') && request.method === 'GET') return await tarotCardImage(url.pathname)
  if (!(await authorized(request, env))) return json({ error: 'unauthorized' }, 401)
  try {
    if (url.pathname === '/api/fortune/roll' && request.method === 'POST') return await roll(request, env)
    if (url.pathname === '/api/fortune/cast' && request.method === 'POST') return await cast(request, env)
    if (url.pathname === '/api/fortune/recent' && request.method === 'GET') return await recent(url, env)
    if (url.pathname.startsWith('/api/fortune/session/') && request.method === 'GET') return await getOne(url.pathname, env)
    if (url.pathname === '/api/fortune/verdict' && request.method === 'POST') return await verdict(request, env)
    return json({ error: 'not found' }, 404)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : '起卦失败' }, 400)
  }
}

export const __fortuneTest = { palaceChain, xiaoliurenFromNumbers, liuyaoFromYaos, tarotDraw, tarotCardById: id => TAROT_BY_ID[id] || null }
