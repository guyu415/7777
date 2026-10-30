import assert from 'node:assert/strict'
import worker, { GomokuGame } from '../src/index.js'
import { newGame, place, parsePos, analyze, undo } from '../src/engine.js'

// ---- 引擎 ----
{
  assert.deepEqual(parsePos('h8'), { r: 7, c: 7 })
  assert.deepEqual(parsePos('A1'), { r: 0, c: 0 })
  assert.deepEqual(parsePos('O15'), { r: 14, c: 14 })
  assert.equal(parsePos('P1'), null)
  assert.equal(parsePos('A16'), null)
  assert.equal(parsePos('A0'), null)
  assert.equal(parsePos('xx'), null)

  const g = newGame('black')
  assert.equal(place(g, 7, 7, 2).ok, false) // 没轮到白
  assert.equal(place(g, 7, 7, 1).ok, true)
  assert.equal(place(g, 7, 7, 2).ok, false) // 已有子

  // 黑横五连：H8..L8 ，白在第 9 行乱放
  const g2 = newGame('black')
  for (let i = 0; i < 4; i++) {
    assert.equal(place(g2, 7, 3 + i, 1).ok, true)
    assert.equal(place(g2, 8, 3 + i, 2).ok, true)
  }
  const a = analyze(g2, 1)
  assert.deepEqual(a.win.sort(), ['C8', 'H8']) // D8..G8 已四连，两端 C8/H8 都能赢
  assert.ok(analyze(g2, 1).win.includes('H8'))
  assert.ok(analyze(g2, 1).win.includes('C8'))
  assert.equal(place(g2, 7, 7, 1).ok, true)
  assert.equal(g2.winner, 1)
  assert.equal(g2.winLine.length, 5)
  assert.equal(place(g2, 0, 0, 2).ok, false) // 结束后不能再下

  // 斜线五连
  const g3 = newGame('black')
  for (let i = 0; i < 5; i++) {
    place(g3, i, i, 1)
    if (i < 4) place(g3, 0, 14 - i, 2)
  }
  assert.equal(g3.winner, 1)

  // 六连也算赢（自由规则）：先摆 5 子中间留空，再补中间
  const g4 = newGame('black')
  const row = [0, 1, 2, 4, 5, 6] // 中间空 col 3
  let wi = 0
  for (const c of row) {
    place(g4, 5, c, 1)
    if (c !== 6) place(g4, 10, 2 * wi++, 2)
  }
  assert.equal(g4.winner, 0)
  place(g4, 12, 0, 2)
  place(g4, 5, 3, 1)
  assert.equal(g4.winner, 1)
  assert.equal(g4.winLine.length, 7)

  // 活三 / 活四 事实
  const g5 = newGame('black')
  place(g5, 7, 6, 1); place(g5, 0, 0, 2)
  place(g5, 7, 7, 1); place(g5, 0, 2, 2)
  const t = analyze(g5, 1)
  assert.ok(t.openThree.includes('I8') && t.openThree.includes('F8'), JSON.stringify(t))

  // 悔棋
  const g6 = newGame('black')
  place(g6, 7, 7, 1); place(g6, 7, 8, 2); place(g6, 6, 6, 1); place(g6, 6, 7, 2)
  assert.equal(undo(g6).ok, true)
  assert.equal(g6.moves.length, 2)
  assert.equal(g6.turn, 1)
  assert.equal(g6.board[6][6], 0)
  place(g6, 3, 3, 1)
  assert.equal(undo(g6).ok, true) // 白还没回应，只撤黑这一手
  assert.equal(g6.moves.length, 2)
  assert.equal(g6.turn, 1)
  assert.equal(undo(newGame()).ok, false)

  // 人类执白：AI 先手，悔棋要能撤掉人类那一手
  const g7 = newGame('white')
  place(g7, 7, 7, 1); place(g7, 7, 8, 2); place(g7, 6, 6, 1)
  assert.equal(undo(g7).ok, true)
  assert.equal(g7.moves.length, 1)
  assert.equal(g7.turn, 2)
}

// ---- Worker + MCP（用内存假 DO）----
function makeEnv(extra = {}) {
  const store = new Map()
  const obj = new GomokuGame({ storage: { get: async (k) => store.get(k), put: async (k, v) => void store.set(k, v) } })
  return {
    GAME: {
      idFromName: (n) => n,
      get: () => ({ fetch: (url, init) => obj.fetch(new Request(url, init)) }),
    },
    ...extra,
  }
}
const mcp = (env, method, params, id = 1) =>
  worker.fetch(new Request('https://x/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) }), env).then(async (r) => ({ status: r.status, body: r.status === 202 ? null : await r.json() }))
const web = (env, path, body) =>
  worker.fetch(new Request('https://x' + path, body ? { method: 'POST', body: JSON.stringify(body) } : {}), env).then((r) => r.json())

{
  const env = makeEnv()
  const init = await mcp(env, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
  assert.equal(init.body.result.protocolVersion, '2025-06-18')
  const noti = await worker.fetch(new Request('https://x/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }), env)
  assert.equal(noti.status, 202)
  const list = await mcp(env, 'tools/list')
  assert.deepEqual(list.body.result.tools.map((t) => t.name), ['gomoku_state', 'gomoku_move', 'gomoku_new'])
  const get = await worker.fetch(new Request('https://x/mcp'), env)
  assert.equal(get.status, 405)

  // AI 还没轮到不能下
  let r = await mcp(env, 'tools/call', { name: 'gomoku_move', arguments: { position: 'H8' } })
  assert.equal(r.body.result.isError, true)
  assert.match(r.body.result.content[0].text, /还没轮到/)

  // 人类（网页）下 H8，然后 AI 下 I9
  let w = await web(env, '/api/move', { pos: 'H8' })
  assert.equal(w.error, null)
  assert.equal(w.game.turn, 2)
  w = await web(env, '/api/move', { pos: 'A1' })
  assert.match(w.error, /还没轮到/)
  r = await mcp(env, 'tools/call', { name: 'gomoku_state', arguments: {} })
  assert.match(r.body.result.content[0].text, /H8\(黑\)/)
  r = await mcp(env, 'tools/call', { name: 'gomoku_move', arguments: { position: 'i9' } })
  assert.equal(r.body.result.isError, undefined)
  assert.match(r.body.result.content[0].text, /落子 I9/)
  r = await mcp(env, 'tools/call', { name: 'gomoku_move', arguments: { position: 'Z9' } })
  assert.equal(r.body.result.isError, true)

  // 网页状态
  w = await web(env, '/api/state')
  assert.equal(w.game.moveCount, 2)
  assert.equal(w.game.last.name, 'I9')

  // 新局：人类执白，AI 先手
  r = await mcp(env, 'tools/call', { name: 'gomoku_new', arguments: { human_color: 'white' } })
  assert.match(r.body.result.content[0].text, /你执黑先手/)
  r = await mcp(env, 'tools/call', { name: 'gomoku_move', arguments: { position: 'H8' } })
  assert.equal(r.body.result.isError, undefined)
  w = await web(env, '/api/move', { pos: 'H9' })
  assert.equal(w.game.moveCount, 2)
  w = await web(env, '/api/undo', {})
  assert.equal(w.game.moveCount, 1)

  // 页面
  const page = await worker.fetch(new Request('https://x/'), env)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /五子棋/)
}

// ---- 密钥 ----
{
  const env = makeEnv({ GOMOKU_KEY: 'sekret' })
  assert.equal((await worker.fetch(new Request('https://x/api/state'), env)).status, 401)
  assert.equal((await worker.fetch(new Request('https://x/api/state?key=sekret'), env)).status, 200)
  const ok = await worker.fetch(new Request('https://x/mcp', { method: 'POST', headers: { authorization: 'Bearer sekret' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }), env)
  assert.equal(ok.status, 200)
}

console.log('全部通过 ✅')
