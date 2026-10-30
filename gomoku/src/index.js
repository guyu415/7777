import { PAGE_HTML } from './page.js'
import { newGame, place, undo, parsePos, posName, colorName, describeForAi, publicView } from './engine.js'

// ============ Durable Object：存棋局，串行处理所有读写 ============
export class GomokuGame {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}
    const op = new URL(request.url).pathname.slice(1)
    let g = (await this.state.storage.get('game')) || newGame('black')
    let error = null

    if (op === 'new') {
      g = newGame(body.human_color === 'white' ? 'white' : 'black')
    } else if (op === 'move') {
      const who = body.who === 'ai' ? g.ai : g.human
      const pos = parsePos(body.pos)
      if (!pos) error = `看不懂落点“${body.pos ?? ''}”。格式是列字母 A-O 加行号 1-15，比如 H8。`
      else {
        const res = place(g, pos.r, pos.c, who)
        if (!res.ok) error = res.error
      }
    } else if (op === 'undo') {
      const res = undo(g)
      if (!res.ok) error = res.error
    } else if (op !== 'state') {
      return json({ error: 'unknown op' }, 404)
    }

    await this.state.storage.put('game', g)
    return json({ error, game: g })
  }
}

// ============ 工具函数 ============
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type, authorization, mcp-session-id, mcp-protocol-version, x-key',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extra },
  })
}

function authorized(request, env) {
  if (!env.GOMOKU_KEY) return true // 没设密钥就是公开的
  const url = new URL(request.url)
  const auth = request.headers.get('authorization') || ''
  const given = url.searchParams.get('key') || request.headers.get('x-key') || auth.replace(/^Bearer\s+/i, '')
  return given === env.GOMOKU_KEY
}

async function callGame(env, op, body) {
  const stub = env.GAME.get(env.GAME.idFromName('main'))
  const res = await stub.fetch(`https://game/${op}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  return res.json()
}

// ============ MCP（Streamable HTTP，无状态，直接返回 JSON） ============
const TOOLS = [
  {
    name: 'gomoku_state',
    description:
      '查看当前五子棋棋盘：文字棋盘、完整落子记录、轮到谁，以及“棋面事实”（谁下哪里会五连/活四/活三）。' +
      '人类在网页上点击落子，所以每次轮到你之前，先调用这个看对方刚下了哪里。棋局存在服务器上，不依赖对话记忆。',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'gomoku_move',
    description:
      '作为 AI 落一子。position 是列字母 A-O 加行号 1-15，如 "H8"（行 1 在最上面）。只有轮到你时才能下，落子后返回新棋盘。' +
      '怎么下完全由你自己判断；服务器只负责记录和判胜负。',
    inputSchema: {
      type: 'object',
      properties: { position: { type: 'string', description: '落点，如 H8' } },
      required: ['position'],
    },
  },
  {
    name: 'gomoku_new',
    description:
      '开一局新棋，会清空当前棋盘。human_color 是人类执哪色：black（人类先手，默认）或 white（你先手）。只在用户明确想重开时调用。',
    inputSchema: {
      type: 'object',
      properties: { human_color: { type: 'string', enum: ['black', 'white'], description: '人类执的颜色' } },
    },
  },
]

function textResult(text, isError = false) {
  return { content: [{ type: 'text', text }], ...(isError ? { isError: true } : {}) }
}

async function runTool(env, name, args) {
  args = args || {}
  if (name === 'gomoku_state') {
    const res = await callGame(env, 'state')
    return textResult(describeForAi(res.game))
  }
  if (name === 'gomoku_move') {
    const res = await callGame(env, 'move', { who: 'ai', pos: args.position })
    if (res.error) return textResult(`${res.error}\n\n` + describeForAi(res.game), true)
    const g = res.game
    const m = g.moves[g.moves.length - 1]
    const head = `你（${colorName(g.ai)}）落子 ${posName(m.r, m.c)}。` +
      (g.winner ? '你赢了！' : g.draw ? '和棋。' : '现在轮到人类（在网页上点击落子，让用户告诉你下好了）。')
    // 对局还在继续时只回简短结果 + 棋面事实，省 token；下一轮用 gomoku_state 看完整棋盘。
    if (g.winner || g.draw) return textResult(head + '\n\n' + describeForAi(g))
    const full = describeForAi(g)
    const at = full.indexOf('棋面事实')
    return textResult(head + (at >= 0 ? '\n\n' + full.slice(at) : ''))
  }
  if (name === 'gomoku_new') {
    const res = await callGame(env, 'new', { human_color: args.human_color })
    const g = res.game
    const head = g.ai === 1
      ? '新局已开，你执黑先手：请先用 gomoku_move 落第一子（通常下天元 H8）。'
      : '新局已开，人类执黑先手：等对方在网页上落子后，再用 gomoku_state 查看。'
    return textResult(head + '\n\n' + describeForAi(g))
  }
  return textResult(`未知工具：${name}`, true)
}

async function handleRpc(env, msg) {
  const id = msg.id
  const reply = (result) => ({ jsonrpc: '2.0', id, result })
  const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: msg.params?.protocolVersion || '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'gomoku', version: '1.0.0' },
        instructions: '五子棋：人类在网页点棋盘落子，你用 gomoku_state 看棋、gomoku_move 落子。棋局存在服务器上。',
      })
    case 'ping':
      return reply({})
    case 'tools/list':
      return reply({ tools: TOOLS })
    case 'tools/call':
      try {
        return reply(await runTool(env, msg.params?.name, msg.params?.arguments))
      } catch (e) {
        return reply(textResult(`工具执行出错：${e?.message || e}`, true))
      }
    default:
      return id === undefined ? null : fail(-32601, `Method not found: ${msg.method}`)
  }
}

async function handleMcp(request, env) {
  if (request.method === 'GET' || request.method === 'DELETE') {
    return new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST', ...CORS } })
  }
  let body
  try {
    body = await request.json()
  } catch {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400)
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleRpc(env, m)))).filter(Boolean)
    return out.length ? json(out) : new Response(null, { status: 202, headers: CORS })
  }
  const out = await handleRpc(env, body)
  return out ? json(out) : new Response(null, { status: 202, headers: CORS })
}

// ============ 入口 ============
export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

    if (!authorized(request, env)) {
      return url.pathname === '/' || url.pathname === ''
        ? new Response('需要访问密钥：在网址后加 ?key=你的密钥', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } })
        : json({ error: 'unauthorized' }, 401)
    }

    if (url.pathname === '/mcp') return handleMcp(request, env)

    if (url.pathname === '/api/state') {
      const res = await callGame(env, 'state')
      return json({ game: publicView(res.game) })
    }
    if (url.pathname === '/api/move' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const res = await callGame(env, 'move', { who: 'human', pos: body.pos })
      return json({ error: res.error, game: publicView(res.game) })
    }
    if (url.pathname === '/api/undo' && request.method === 'POST') {
      const res = await callGame(env, 'undo')
      return json({ error: res.error, game: publicView(res.game) })
    }
    if (url.pathname === '/api/new' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}))
      const res = await callGame(env, 'new', { human_color: body.human_color })
      return json({ game: publicView(res.game) })
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(PAGE_HTML, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    }
    return new Response('Not found', { status: 404 })
  },
}
