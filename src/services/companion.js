// Claude Code (VPS) transport — talks to the companion channel server over a
// single persistent WebSocket, cookie-authenticated. This module never reads,
// receives, or stores the raw companion token: authentication happens entirely
// via the browser's HttpOnly cookie for companion.xiaoman.xyz, set by visiting
// https://companion.xiaoman.xyz/login (see SessionSettings.jsx).
//
// Protocol reference (verified against the live companion.xiaoman.xyz server,
// not guessed): server broadcasts { type:'turn_start'|'msg'|'turn_end'|
// 'turn_error'|'turn_busy', turnId, ... } and, once per WS connection, a
// { type:'history', items, openTurnId } snapshot. See channel-server.ts on the
// VPS for the authoritative implementation.

const WS_URL = 'wss://companion.xiaoman.xyz/ws'
const STATUS_URL = 'https://companion.xiaoman.xyz/auth/status'
const LOGOUT_URL = 'https://companion.xiaoman.xyz/auth/logout'
const COMPANION_BASE = 'https://companion.xiaoman.xyz'

// ---------- connection singleton (one WS per browser tab, reused across turns) ----------

let ws = null
let wsState = 'idle' // idle | connecting | open | closed
let everOpenedThisAttempt = false
let reconnectAttempt = 0
let reconnectTimer = null
let authFailed = false // definitive: stop auto-reconnecting until explicit ensureConnected() after re-login
const listeners = new Set() // Set<(evt) => void>

// ---------- delivered Wire.id dedup (connection-manager scope) ----------
// Shared by BOTH the live wire path and history-recovery-after-reconnect path
// for this page's whole lifetime — a message id, once delivered to some
// generator, is never delivered again, from either source. Bounded two ways:
// (1) each streamChatViaCompanion() call forgets its own ids once its turn
// closes (success, error, or abort), since a closed turn's ids can never be
// meaningfully redelivered to a future different turnId; (2) a hard cap as a
// belt-and-suspenders backstop in case a turn's cleanup is ever skipped.
const deliveredIds = new Set()
const DELIVERED_IDS_CAP = 500

function alreadyDelivered(id) {
  return deliveredIds.has(id)
}
function markDelivered(id) {
  deliveredIds.add(id)
  if (deliveredIds.size > DELIVERED_IDS_CAP) {
    const oldest = deliveredIds.values().next().value
    deliveredIds.delete(oldest)
  }
}
function forgetDelivered(ids) {
  for (const id of ids) deliveredIds.delete(id)
}

function notify(evt) {
  for (const fn of listeners) {
    try {
      fn(evt)
    } catch {
      // a listener throwing must not break delivery to the others
    }
  }
}

// The browser WebSocket API does not expose the HTTP status of a failed
// upgrade (e.g. 401) to JS — a rejected handshake just fires onclose/onerror
// with no reusable status code, by spec, for security reasons. So instead of
// guessing from the close event, we ask the one endpoint that actually knows:
// /auth/status. This is the real, verified way to distinguish "cookie invalid,
// stop retrying" from "transient network hiccup, keep retrying".
async function checkLoggedIn() {
  try {
    const r = await fetch(STATUS_URL, { credentials: 'include' })
    if (!r.ok) return null
    const j = await r.json()
    return typeof j.loggedIn === 'boolean' ? j.loggedIn : null
  } catch {
    return null // network error — unknown, not "definitely logged out"
  }
}

function scheduleReconnect() {
  if (authFailed) return
  const delay = Math.min(1000 * 2 ** reconnectAttempt, 15000)
  reconnectAttempt += 1
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(connect, delay)
}

function connect() {
  if (wsState === 'connecting' || wsState === 'open') return
  wsState = 'connecting'
  everOpenedThisAttempt = false

  let socket
  try {
    socket = new WebSocket(WS_URL)
  } catch (err) {
    wsState = 'closed'
    scheduleReconnect()
    return
  }
  ws = socket

  socket.onopen = () => {
    wsState = 'open'
    everOpenedThisAttempt = true
    reconnectAttempt = 0
    authFailed = false
    notify({ kind: 'open' })
  }

  socket.onmessage = ev => {
    let m
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.type === 'history') {
      notify({ kind: 'history', openTurnId: m.openTurnId, items: m.items, resetAt: m.resetAt })
      return
    }
    notify({ kind: 'wire', wire: m })
  }

  socket.onclose = async ev => {
    const openedBefore = everOpenedThisAttempt
    wsState = 'closed'
    ws = null
    notify({ kind: 'close', wasClean: ev.wasClean, code: ev.code })

    if (!openedBefore) {
      // Never successfully opened — could be a rejected (unauthenticated)
      // upgrade or a transient network/server problem. Ask /auth/status to
      // tell the two apart instead of assuming.
      const loggedIn = await checkLoggedIn()
      if (loggedIn === false) {
        authFailed = true
        notify({ kind: 'auth_required' })
        return
      }
    }
    scheduleReconnect()
  }

  socket.onerror = () => {
    // onclose follows onerror for WebSocket; all handling lives there.
  }
}

// ---------- spontaneous (proactive) cc messages ----------
// A from:'cc' wire message normally arrives while some streamChatViaCompanion()
// generator is actively awaiting a reply, and that generator's own temporary
// listener (added to `listeners` above) claims it via markDelivered(). A
// proactive message the VPS injects on its own initiative arrives with NO
// generator waiting — nothing would ever claim it, so it would otherwise be
// silently dropped. This permanent, module-scope listener is the backstop:
// it only acts on messages still unclaimed once every synchronous listener
// (including any active generator's) has had its turn.
const proactiveListeners = new Set()
/** Subscribe to spontaneous cc messages (proactive, not a reply to a user send). Returns an unsubscribe fn. */
export function onProactiveMessage(fn) {
  proactiveListeners.add(fn)
  return () => proactiveListeners.delete(fn)
}

// Takes the whole wire message (not just id/text/ts) so a proactive reply
// carries the same kind/voice/style/thinking a normal streamChatViaCompanion()
// -delivered one does — previously this dropped everything but text, silently
// downgrading any voice or thinking content CC sent outside of a
// directly-awaited turn. Gomoku chat never reaches this path at all — it's
// routed server-side into the game's own `messages` log (see onGomokuUpdate),
// never broadcast as a main-chat wire `msg` in the first place.
function maybeAnnounceProactive(wireMsg) {
  const { id, text, ts, kind, voice, style, thinking } = wireMsg
  // Deferred to the next tick: lets any active generator's listener (which
  // runs synchronously within the same notify() call) markDelivered() first.
  // Only messages still unclaimed after that are genuinely spontaneous.
  setTimeout(() => {
    if (alreadyDelivered(id)) return
    markDelivered(id)
    for (const fn of proactiveListeners) {
      try {
        fn({ id, text, ts, kind, voice, style, thinking })
      } catch {
        // a subscriber throwing must not break delivery to the others
      }
    }
  }, 0)
}

// ---------- CC context reset (real /clear, not a UI-only wipe) ----------
// The server broadcasts a live `reset` wire event the instant a reset
// succeeds. But a tab that's closed, backgrounded, or simply not connected
// at that moment would never see it — so the server also stamps every
// `history` snapshot (sent on every connect/reconnect) with the same
// `resetAt` timestamp. Comparing that against the last one *this browser*
// has seen — persisted in localStorage, so it survives page reloads and is
// shared across tabs of the same origin — lets a late/reconnecting tab
// detect a reset it missed just as reliably as a tab that was live for it.
const RESET_MARKER_KEY = 'companion.cc.lastResetAt'
let lastKnownResetAt = Number(localStorage.getItem(RESET_MARKER_KEY) || 0) || 0

const ccResetListeners = new Set()
/** Subscribe to CC context resets (live broadcast or detected on reconnect). Returns an unsubscribe fn. */
export function onCcReset(fn) {
  ccResetListeners.add(fn)
  return () => ccResetListeners.delete(fn)
}

function maybeAnnounceReset(resetAt) {
  if (!resetAt || resetAt <= lastKnownResetAt) return
  lastKnownResetAt = resetAt
  try {
    localStorage.setItem(RESET_MARKER_KEY, String(resetAt))
  } catch {
    // best-effort persistence — an in-memory-only marker still protects this tab for its own lifetime
  }
  for (const fn of ccResetListeners) {
    try {
      fn({ resetAt })
    } catch {
      // a subscriber throwing must not break delivery to the others
    }
  }
}

// ---------- gomoku (五子棋) ----------
const gomokuListeners = new Set()
/** Subscribe to live gomoku board updates (user move, AI move, new game, and
 * in-game chat — the game's `messages` log is part of the same broadcast
 * object, see channel-server.ts's appendGomokuChatMsg). Returns an unsubscribe fn. */
export function onGomokuUpdate(fn) {
  gomokuListeners.add(fn)
  return () => gomokuListeners.delete(fn)
}
function announceGomoku(game) {
  for (const fn of gomokuListeners) {
    try {
      fn(game)
    } catch {
      // a subscriber throwing must not break delivery to the others
    }
  }
}

// Fires on every turn_end/turn_error, tagged only with the turnId — lets the
// gomoku screen notice when the specific interactionId it's waiting on (from
// postGomokuChat) has finished, without needing its own generator/claiming
// machinery the way streamChatViaCompanion has. Deliberately generic (not
// gomoku-specific server-side) since it's just "a turn ended," filtered by
// the caller.
const turnEndListeners = new Set()
export function onTurnEnd(fn) {
  turnEndListeners.add(fn)
  return () => turnEndListeners.delete(fn)
}
function announceTurnEnd(turnId) {
  for (const fn of turnEndListeners) {
    try {
      fn(turnId)
    } catch {
      // a subscriber throwing must not break delivery to the others
    }
  }
}

export async function getGomokuState() {
  return companionJson('/gomoku/state')
}
export async function newGomokuGame() {
  return companionJson('/gomoku/new', { method: 'POST' })
}
export async function makeGomokuMove(row, col) {
  return companionJson('/gomoku/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row, col }),
  })
}
// mode:'immediate' (AI hadn't moved yet, retracted right away) or
// mode:'pending' (AI already moved — genuinely asked over the MCP channel;
// the actual outcome arrives later as a gomoku_update broadcast, including
// anything CC says about it in the game's own `messages` log).
export async function requestGomokuUndo() {
  return companionJson('/gomoku/undo-request', { method: 'POST' })
}
export async function resignGomokuGame() {
  return companionJson('/gomoku/resign', { method: 'POST' })
}
// In-game chat — text typed on the gomoku screen, or a voice press-and-hold's
// transcript (voice:true, transcribed client-side, never a new server-side
// STT path). CC's reply arrives via onGomokuUpdate (game.messages), not via
// streamChatViaCompanion — this call returns as soon as the message is
// queued, not once CC has replied.
export async function postGomokuChat(gameId, text, voice = false) {
  return companionJson('/gomoku/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, text, voice }),
  })
}

listeners.add(evt => {
  if (evt.kind === 'wire') {
    const m = evt.wire
    if (m.type === 'reset') {
      maybeAnnounceReset(m.ts)
      return
    }
    if (m.type === 'gomoku_update') {
      announceGomoku(m.game)
      return
    }
    if (m.type === 'turn_end' || m.type === 'turn_error') {
      announceTurnEnd(m.turnId)
      // fall through — turn_end/turn_error also matter to any in-flight
      // streamChatViaCompanion() generator, handled further down via `listeners`
    }
    if (m.type === 'msg' && m.from === 'cc') maybeAnnounceProactive(m)
    return
  }
  if (evt.kind === 'history') {
    maybeAnnounceReset(evt.resetAt)
    for (const item of evt.items) {
      if (item.from === 'cc') maybeAnnounceProactive(item)
    }
  }
})

/** Idempotent: opens the shared connection if it isn't already open/connecting. */
export function ensureConnected() {
  clearTimeout(reconnectTimer)
  authFailed = false
  reconnectAttempt = 0
  if (wsState === 'idle' || wsState === 'closed') connect()
}

/** Explicit teardown — used on logout / unbinding the VPS session. */
export function disconnect() {
  clearTimeout(reconnectTimer)
  authFailed = true // don't auto-reconnect until ensureConnected() is called again
  if (ws) {
    try {
      ws.close()
    } catch {
      // ignore
    }
  }
  ws = null
  wsState = 'idle'
}

function sendRaw(obj) {
  if (ws && wsState === 'open') {
    ws.send(JSON.stringify(obj))
    return true
  }
  return false
}

function waitUntilOpenOrFail(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    if (wsState === 'open') return resolve()
    if (authFailed) {
      return reject(Object.assign(new Error('未登录 companion，请先登录'), { code: 'auth_required' }))
    }
    let done = false
    const onEvt = evt => {
      if (done) return
      if (evt.kind === 'open') {
        done = true
        cleanup()
        resolve()
      } else if (evt.kind === 'auth_required') {
        done = true
        cleanup()
        reject(Object.assign(new Error('未登录 companion，请先登录'), { code: 'auth_required' }))
      }
    }
    const to = setTimeout(() => {
      if (done) return
      done = true
      cleanup()
      reject(Object.assign(new Error('连接 companion 超时'), { code: 'connect_timeout' }))
    }, timeoutMs)
    function cleanup() {
      clearTimeout(to)
      listeners.delete(onEvt)
    }
    listeners.add(onEvt)
    ensureConnected()
  })
}

let seq = 0
function genId() {
  return `eunoia-${Date.now()}-${++seq}`
}

/**
 * Async generator matching services/claude.js's streamChat yield contract:
 * yields { text } chunks and, when Claude Code's own engine publicly
 * exposed thinking/reasoning content for the in-progress turn, { reasoning }
 * deltas too — sourced from the server's live 'thinking' wire events, which
 * only ever forward a non-empty `thinking` block it actually found in the
 * transcript. Never fabricated here or on the server; absent/empty
 * reasoning is the expected case for models/turns that don't expose one,
 * not a bug. A recovered-from-history reasoning value (after a disconnect
 * mid-turn) arrives as { reasoningReplace } instead of { reasoning } — a
 * full authoritative value to assign, not a delta to append, since we can't
 * know how much of it a live delta already delivered before the disconnect.
 *
 * One call = one turn. Multiple `reply` calls from the same Claude turn are
 * delivered as multiple { text } yields before the generator returns (on
 * turn_end) — callers should accumulate them, matching how useChat.js already
 * accumulates streamChat's text deltas.
 *
 * Every delivered message is deduped by its Wire.id (never by text) against
 * the module-level `deliveredIds` set, so a reconnect-triggered history
 * replay can never re-yield something already seen live, or vice versa.
 */
export async function* streamChatViaCompanion({ text, signal }) {
  if (signal?.aborted) return

  await waitUntilOpenOrFail()

  const id = genId()
  const turnId = id

  const queue = []
  let queueWake = null
  function push(item) {
    if (queueWake) {
      const w = queueWake
      queueWake = null
      w(item)
    } else {
      queue.push(item)
    }
  }
  function next() {
    if (queue.length) return Promise.resolve(queue.shift())
    return new Promise(resolve => {
      queueWake = resolve
    })
  }

  let finishError = null
  let recoveredFromHistory = false
  const thisTurnDeliveredIds = [] // for forgetDelivered() when this turn closes
  // Every WS connection — including the very first one this generator opens —
  // gets a `history` snapshot immediately on open, before our own turn_start
  // could possibly have been broadcast back to us. That snapshot is NOT a
  // recovery signal; it only becomes one if we actually observed a disconnect
  // while this turn was in flight. Without this flag, the normal on-connect
  // snapshot (openTurnId: null, empty items) was being misread as "turn
  // resolved while disconnected" on every single call — a real bug, caught by
  // the isolated single-reply Playwright test, not a test-harness artifact.
  let sawDisconnect = false

  const onEvent = evt => {
    if (evt.kind === 'auth_required') {
      finishError = Object.assign(new Error('未登录 companion，请先登录'), { code: 'auth_required', turnId })
      push({ done: true })
      return
    }

    if (evt.kind === 'close') {
      // Don't finish the turn on a mere disconnect — reconnection + history
      // replay (below) is how we find out what actually happened. If the
      // process never manages to reconnect, waitUntilOpenOrFail's caller-side
      // timeout on the *next* turn is what surfaces that, not this one.
      sawDisconnect = true
      return
    }

    if (evt.kind === 'history') {
      if (recoveredFromHistory) return
      if (!sawDisconnect) return // just the normal on-connect snapshot, not a recovery signal
      // Reconnected mid-turn. If the server no longer considers our turn
      // open, we missed the live turn_end/turn_error while disconnected —
      // recover from the replayed message history instead of hanging.
      if (evt.openTurnId === turnId) return // still open server-side, keep waiting
      const isOurs = it => it.turnId === turnId
      const ccReplies = evt.items.filter(it => isOurs(it) && it.from === 'cc')
      recoveredFromHistory = true
      if (ccReplies.length > 0) {
        // Dedup by Wire.id, never by text — a reply that happens to repeat
        // the same words as an earlier one must still come through.
        for (const r of ccReplies) {
          if (alreadyDelivered(r.id)) continue // already yielded live before the disconnect
          markDelivered(r.id)
          thisTurnDeliveredIds.push(r.id)
          // Full authoritative replace, not a delta — we can't know how much
          // of this message's thinking a live 'thinking' wire event already
          // delivered before the disconnect, so appending would duplicate it.
          if (r.thinking) push({ reasoningReplace: r.thinking })
          if (r.kind === 'voice') push({ voice: { id: r.id, text: r.text, voice: r.voice, style: r.style } })
          else push({ text: r.text })
        }
        push({ done: true })
      } else {
        finishError = Object.assign(
          new Error('连接断开期间该轮次已结束，但没有恢复到回复内容'),
          { code: 'turn_error', turnId },
        )
        push({ done: true })
      }
      return
    }

    // evt.kind === 'wire'
    const m = evt.wire
    if (m.type === 'turn_busy') {
      finishError = Object.assign(
        new Error('companion 正在处理上一轮，请稍候再发送'),
        { code: 'turn_busy', turnId: m.turnId },
      )
      push({ done: true })
      return
    }
    if (m.type === 'reset_busy') {
      // Sent only to a client that tried to send while a context reset was
      // in flight — this turn never actually started server-side.
      finishError = Object.assign(
        new Error('正在清空对话，请稍候再试'),
        { code: 'reset_in_progress', turnId },
      )
      push({ done: true })
      return
    }
    if (m.turnId !== turnId) return
    if (m.type === 'thinking') {
      if (m.delta) push({ reasoning: m.delta })
      return
    }
    if (m.type === 'msg' && m.from === 'cc') {
      if (alreadyDelivered(m.id)) return // e.g. already delivered via an earlier history recovery
      markDelivered(m.id)
      thisTurnDeliveredIds.push(m.id)
      if (m.kind === 'voice') push({ voice: { id: m.id, text: m.text, voice: m.voice, style: m.style } })
      else push({ text: m.text })
    } else if (m.type === 'turn_end') {
      push({ done: true })
    } else if (m.type === 'turn_error') {
      finishError = Object.assign(new Error(m.error || 'companion 轮次失败'), { code: 'turn_error', turnId })
      push({ done: true })
    }
  }

  listeners.add(onEvent)

  let aborted = false
  const onAbort = () => {
    aborted = true
    push({ done: true })
  }
  signal?.addEventListener('abort', onAbort)

  try {
    const sent = sendRaw({ id, text })
    if (!sent) {
      throw Object.assign(new Error('companion 未连接'), { code: 'not_connected', turnId })
    }
    while (true) {
      const item = await next()
      if (aborted) {
        // Stop consuming for this turn. We do NOT know whether — or when —
        // the remote Claude session actually finishes; there is no cancel
        // signal in this protocol. Throwing the same AbortError shape fetch()
        // uses lets useChat.js's existing AbortError branch handle cleanup —
        // it's on the caller to render the honest "we stopped listening, the
        // server may still be finishing" message, not on this module to
        // pretend the remote turn was actually cancelled.
        throw Object.assign(new Error('aborted'), { name: 'AbortError', code: 'aborted_local_only' })
      }
      if (item.done) {
        if (finishError) throw finishError
        return
      }
      if (item.reasoningReplace !== undefined) yield { reasoningReplace: item.reasoningReplace }
      else if (item.reasoning) yield { reasoning: item.reasoning }
      else yield item.voice ? { voice: item.voice } : { text: item.text }
    }
  } finally {
    listeners.delete(onEvent)
    signal?.removeEventListener('abort', onAbort)
    // This turn is closed (success, error, or local abort) — its ids can
    // never be meaningfully redelivered to a different, future turnId, so
    // stop tracking them. Keeps deliveredIds bounded by "ids from turns
    // currently in flight" rather than growing for the whole page lifetime.
    // Deferred one macrotask so it can never race ahead of a same-batch
    // maybeAnnounceProactive() dedup check (also a deferred setTimeout(0),
    // scheduled earlier since the 'msg' wire event always precedes the
    // 'turn_end' that triggers this cleanup) — otherwise a message already
    // claimed by this generator could be wrongly re-announced as proactive.
    setTimeout(() => forgetDelivered(thisTurnDeliveredIds), 0)
  }
}

// ---------- auth status (for SessionSettings.jsx) ----------

export async function getAuthStatus() {
  const loggedIn = await checkLoggedIn()
  return { loggedIn: loggedIn === true }
}

export async function logout() {
  disconnect()
  try {
    await fetch(LOGOUT_URL, { method: 'POST', credentials: 'include' })
  } catch {
    // best-effort — the cookie may already be gone/expired
  }
}

export const COMPANION_LOGIN_URL = 'https://companion.xiaoman.xyz/login'
export const COMPANION_RETURN_URL = 'https://eunoia.xiaoman.xyz'

// ---------- Auto Memory management (real files on the VPS, no local copy) ----------
// Every call is cookie-authenticated (credentials: 'include'); this module
// never handles the raw companion token.

async function companionJson(path, init) {
  const res = await fetch(`${COMPANION_BASE}${path}`, { credentials: 'include', ...init })
  let body = null
  try {
    body = await res.json()
  } catch {
    // no/invalid JSON body
  }
  if (!res.ok) {
    const err = new Error(body?.error || `companion request failed (${res.status})`)
    err.status = res.status
    throw err
  }
  return body
}

export async function listMemoryFiles() {
  const data = await companionJson('/memory/list')
  return data.files
}

export async function getMemoryFile(name) {
  return companionJson(`/memory/get?name=${encodeURIComponent(name)}`)
}

export async function putMemoryFile(name, content) {
  return companionJson('/memory/put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, content }),
  })
}

export async function deleteMemoryFile(name) {
  return companionJson('/memory/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

// ---------- statusLine-fed usage/model status ----------

export async function getCompanionStatus() {
  return companionJson('/status')
}

// ---------- model switch ----------
// A fixed allowlist of exact model IDs only; rejected (409) server-side if a
// turn is in flight. Resolves with the statusLine-confirmed actual model —
// never trust the requested id alone as proof of success.
export async function switchCompanionModel(modelId) {
  return companionJson('/model/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId }),
  })
}

// ---------- proactive-message master switch ----------
// State lives on the VPS (config/proactive.json), not just browser
// localStorage — the systemd timer needs the real current state even when
// no phone/browser is open at all.

export async function getProactiveSettings() {
  return companionJson('/proactive/settings')
}

export async function setProactiveSettings(enabled) {
  return companionJson('/proactive/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
}

// ---------- CC context reset ----------
// Genuinely resets the VPS Claude Code session's own conversation context
// (not just this page's view of it) and clears the server's shared message
// history. On success, every connected tab — including this one — receives
// the resulting `reset` broadcast (see onCcReset above) and clears its own
// local copy; this call does not touch the frontend's store/IndexedDB
// itself. Rejected (409) if a turn is in flight or already in progress on
// the server; safe to call again (idempotent — a reset already running is
// joined, not restarted).
export async function resetCcConversation() {
  return companionJson('/cc/reset', { method: 'POST' })
}
