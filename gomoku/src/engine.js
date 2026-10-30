// 五子棋引擎：只负责记棋盘、判胜负、陈述棋面事实，不替任何一方决定下哪。
// 15x15，自由规则：黑白交替，横竖斜任意方向连成 5 子或以上即胜。

export const SIZE = 15
const COLS = 'ABCDEFGHIJKLMNO'
const DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]]

export function newGame(humanColor = 'black') {
  const human = humanColor === 'white' ? 2 : 1
  return {
    size: SIZE,
    board: emptyBoard(),
    moves: [], // [{r, c, p}]  p: 1=黑 2=白
    turn: 1,
    winner: 0,
    winLine: null, // [[r,c], ...]
    draw: false,
    human,
    ai: 3 - human,
    version: 1,
    updatedAt: Date.now(),
  }
}

function emptyBoard() {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(0))
}

export function parsePos(input) {
  const m = /^\s*([A-Oa-o])\s*(\d{1,2})\s*$/.exec(String(input ?? ''))
  if (!m) return null
  const c = COLS.indexOf(m[1].toUpperCase())
  const r = parseInt(m[2], 10) - 1
  if (c < 0 || r < 0 || r >= SIZE) return null
  return { r, c }
}

export function posName(r, c) {
  return COLS[c] + (r + 1)
}

export function colorName(p) {
  return p === 1 ? '黑' : '白'
}

function inside(r, c) {
  return r >= 0 && r < SIZE && c >= 0 && c < SIZE
}

// 从 (r,c) 出发，沿一条线数出连续同色子（含自身），返回 {cells, open}
function runThrough(board, r, c, p, dr, dc) {
  const cells = [[r, c]]
  let open = 0
  for (const sign of [1, -1]) {
    let rr = r + dr * sign
    let cc = c + dc * sign
    while (inside(rr, cc) && board[rr][cc] === p) {
      cells.push([rr, cc])
      rr += dr * sign
      cc += dc * sign
    }
    if (inside(rr, cc) && board[rr][cc] === 0) open++
  }
  return { cells, open }
}

function checkWin(board, r, c, p) {
  for (const [dr, dc] of DIRS) {
    const { cells } = runThrough(board, r, c, p, dr, dc)
    if (cells.length >= 5) return cells
  }
  return null
}

/** 落子。p 必须是当前轮到的一方。返回 {ok:true} 或 {ok:false, error}。 */
export function place(g, r, c, p) {
  if (g.winner) return { ok: false, error: `这局已经结束，${colorName(g.winner)}棋获胜。请先开新局。` }
  if (g.draw) return { ok: false, error: '棋盘已满，这局和棋。请先开新局。' }
  if (!inside(r, c)) return { ok: false, error: '落点超出棋盘（列 A-O，行 1-15）。' }
  if (p !== g.turn) return { ok: false, error: `现在轮到${colorName(g.turn)}棋，还没轮到你。` }
  if (g.board[r][c] !== 0) return { ok: false, error: `${posName(r, c)} 已经有子了。` }
  g.board[r][c] = p
  g.moves.push({ r, c, p })
  const line = checkWin(g.board, r, c, p)
  if (line) {
    g.winner = p
    g.winLine = line
  } else if (g.moves.length >= SIZE * SIZE) {
    g.draw = true
  } else {
    g.turn = 3 - p
  }
  g.version++
  g.updatedAt = Date.now()
  return { ok: true }
}

/** 悔棋：退回到人类刚落子之前（连带撤掉 AI 在这之后的那一手）。 */
export function undo(g) {
  if (g.moves.length === 0) return { ok: false, error: '还没有落子，没法悔棋。' }
  let removedHuman = false
  while (g.moves.length > 0 && !removedHuman) {
    const m = g.moves.pop()
    if (m.p === g.human) removedHuman = true
  }
  g.board = emptyBoard()
  for (const m of g.moves) g.board[m.r][m.c] = m.p
  g.winner = 0
  g.winLine = null
  g.draw = false
  g.turn = g.moves.length % 2 === 0 ? 1 : 2
  g.version++
  g.updatedAt = Date.now()
  return { ok: true }
}

// ---------- 棋面事实（不含跳三/跳四，只数连续子） ----------

/** 假设 p 下在空位 (r,c)，各方向的形状。 */
function shapeAt(board, r, c, p) {
  let five = false
  let openFour = 0
  let four = 0
  let openThree = 0
  board[r][c] = p
  for (const [dr, dc] of DIRS) {
    const { cells, open } = runThrough(board, r, c, p, dr, dc)
    const n = cells.length
    if (n >= 5) five = true
    else if (n === 4 && open === 2) openFour++
    else if (n === 4 && open === 1) four++
    else if (n === 3 && open === 2) openThree++
  }
  board[r][c] = 0
  return { five, openFour, four, openThree }
}

export function analyze(g, p) {
  const out = { win: [], openFour: [], fork: [], four: [], openThree: [] }
  if (g.winner || g.draw) return out
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (g.board[r][c] !== 0) continue
      const s = shapeAt(g.board, r, c, p)
      const name = posName(r, c)
      if (s.five) out.win.push(name)
      else if (s.openFour) out.openFour.push(name)
      else if (s.four + s.openThree >= 2) out.fork.push(name)
      else if (s.four) out.four.push(name)
      else if (s.openThree) out.openThree.push(name)
    }
  }
  return out
}

// ---------- 文字输出 ----------

export function renderBoard(g) {
  const last = g.moves[g.moves.length - 1]
  const header = '   ' + COLS.split('').join(' ')
  const rows = []
  for (let r = 0; r < SIZE; r++) {
    const cells = []
    for (let c = 0; c < SIZE; c++) {
      const v = g.board[r][c]
      const isLast = last && last.r === r && last.c === c
      cells.push(v === 0 ? '·' : isLast ? (v === 1 ? '◆' : '◇') : v === 1 ? '●' : '○')
    }
    rows.push(String(r + 1).padStart(2, ' ') + ' ' + cells.join(' '))
  }
  return [header, ...rows].join('\n')
}

function listCap(arr, cap = 12) {
  if (arr.length === 0) return ''
  return arr.length > cap ? arr.slice(0, cap).join(' ') + ` …共${arr.length}处` : arr.join(' ')
}

export function moveLog(g) {
  if (g.moves.length === 0) return '（还没有落子）'
  return g.moves.map((m, i) => `${i + 1}.${posName(m.r, m.c)}(${colorName(m.p)})`).join(' ')
}

function statusLine(g) {
  if (g.winner) return `【已结束】${colorName(g.winner)}棋获胜（${g.winner === g.human ? '人类' : 'AI'}赢）。`
  if (g.draw) return '【已结束】棋盘已满，和棋。'
  return `轮到：${colorName(g.turn)}棋（${g.turn === g.human ? '人类' : 'AI'}）。`
}

/** 给 AI 看的完整文字：棋盘 + 记录 + 棋面事实。 */
export function describeForAi(g) {
  const lines = []
  lines.push(`你执${colorName(g.ai)}棋（${g.ai === 1 ? '●' : '○'}，${g.ai === 1 ? '先手' : '后手'}），人类执${colorName(g.human)}棋（${g.human === 1 ? '●' : '○'}）。`)
  lines.push(statusLine(g))
  lines.push('')
  lines.push(renderBoard(g))
  lines.push('（◆/◇ 是最后一手；列 A-O 从左到右，行 1-15 从上到下）')
  lines.push('')
  lines.push('落子记录：' + moveLog(g))
  if (!g.winner && !g.draw) {
    const mine = analyze(g, g.ai)
    const theirs = analyze(g, g.human)
    const facts = []
    if (mine.win.length) facts.push(`你现在下这些点就直接五连获胜：${listCap(mine.win)}`)
    if (theirs.win.length) facts.push(`对方下这些点就直接五连（不堵就输）：${listCap(theirs.win)}`)
    if (theirs.openFour.length) facts.push(`对方下这些点会成活四：${listCap(theirs.openFour)}`)
    if (theirs.fork.length) facts.push(`对方下这些点会同时形成多重威胁：${listCap(theirs.fork)}`)
    if (mine.openFour.length) facts.push(`你下这些点会成活四：${listCap(mine.openFour)}`)
    if (mine.fork.length) facts.push(`你下这些点会同时形成多重威胁：${listCap(mine.fork)}`)
    if (theirs.openThree.length) facts.push(`对方下这些点会成活三：${listCap(theirs.openThree)}`)
    if (mine.openThree.length) facts.push(`你下这些点会成活三：${listCap(mine.openThree)}`)
    lines.push('')
    lines.push('棋面事实（只数连续子，不含跳三跳四；怎么下由你自己决定）：')
    lines.push(facts.length ? facts.map((f) => '- ' + f).join('\n') : '- 暂时没有需要特别注意的威胁。')
  }
  return lines.join('\n')
}

/** 给网页用的公开视图。 */
export function publicView(g) {
  const last = g.moves[g.moves.length - 1] || null
  return {
    size: g.size,
    board: g.board,
    turn: g.turn,
    winner: g.winner,
    winLine: g.winLine,
    draw: g.draw,
    human: g.human,
    ai: g.ai,
    version: g.version,
    moveCount: g.moves.length,
    last: last ? { r: last.r, c: last.c, p: last.p, name: posName(last.r, last.c) } : null,
  }
}
