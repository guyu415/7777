import { DEFAULT_CODEX_SESSION_ID, normalizeCodexSessionId, buildCodexMessagePayload } from '../utils/codexProtocol'
export { translateThinking } from './reasoningTranslation'

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

// The VPS only knows its own server clock — every message to CC/Codex (main
// chat and gomoku) attaches a fresh reading of the user's actual DEVICE
// clock so the model can reason about "what day/time is it right now" using
// the user's real local time, not the server's. Read live on every single
// call (never cached from page load) so it stays correct across timezone
// travel, DST, or just a long-running tab. The channel server turns this
// into a short bracketed line prepended to the model's own turn content —
// it never touches the persisted/broadcast chat text, so it can't pollute
// the user's own message bubble or get written into any memory file.
export function clientTimeContext() {
  const now = new Date()
  let formatted
  try {
    formatted = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'full', timeStyle: 'medium', hour12: false }).format(now)
  } catch {
    formatted = now.toString()
  }
  let timeZone
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    timeZone = undefined
  }
  return { formatted, timeZone, utcOffsetMinutes: -now.getTimezoneOffset() }
}

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
let selectedCodexSessionId = DEFAULT_CODEX_SESSION_ID
let lastServerActivityAt = 0
const connectionProbeWaiters = new Set()

const PRE_SEND_STALE_MS = 12000
const CONNECTION_PROBE_TIMEOUT_MS = 2500

function settleConnectionProbes(ok) {
  for (const settle of connectionProbeWaiters) settle(ok)
  connectionProbeWaiters.clear()
}

// ---------- app-level heartbeat ----------
// A browser WebSocket can report itself as 'open' for a long time after the
// underlying network path has actually died (mobile network handoffs, iOS
// backgrounding) — the OS just hasn't gotten around to firing close/error
// yet. Before this, a chat send during that window went out via a socket
// that looked fine and vanished with zero trace on either side: no server
// log (it never arrived), no client error (send() doesn't throw for this).
// The user only found out minutes later when SOME eventual reconnect
// revealed nothing had happened. Real incident, 2026-08-05 evening — see
// project memory. This ping/pong catches a dead socket in seconds instead
// of however long the OS takes to notice.
let heartbeatTimer = null
let pongTimeout = null
const HEARTBEAT_INTERVAL_MS = 20000
const PONG_TIMEOUT_MS = 8000

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (!ws || wsState !== 'open') return
    try {
      ws.send(JSON.stringify({ type: 'ping' }))
    } catch {
      return
    }
    clearTimeout(pongTimeout)
    pongTimeout = setTimeout(() => {
      // No pong in time — force-close so the existing reconnect/backoff
      // logic (scheduleReconnect via onclose) takes over immediately.
      try {
        ws?.close()
      } catch {
        // ignore
      }
    }, PONG_TIMEOUT_MS)
  }, HEARTBEAT_INTERVAL_MS)
}
function stopHeartbeat() {
  clearInterval(heartbeatTimer)
  heartbeatTimer = null
  clearTimeout(pongTimeout)
  pongTimeout = null
}

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
    lastServerActivityAt = Date.now()
    startHeartbeat()
    notify({ kind: 'open' })
    // The server sends a main-session snapshot on open for backwards
    // compatibility; immediately selecting the active Eunoia conversation
    // makes reconnects restore the right per-session Codex history.
    sendRaw({ type: 'codex_session', sessionId: selectedCodexSessionId })
  }

  socket.onmessage = ev => {
    lastServerActivityAt = Date.now()
    let m
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.type === 'pong') {
      clearTimeout(pongTimeout)
      pongTimeout = null
      settleConnectionProbes(true)
      return
    }
    if (m.type === 'inbound_ack') {
      notify({ kind: 'inbound_ack', id: m.id })
      return
    }
    if (m.type === 'history') {
      notify({ kind: 'history', openTurnId: m.openTurnId, queuedTurnIds: m.queuedTurnIds || [], items: m.items, resetAt: m.resetAt,
        resetMode: m.resetMode, resetBoundaryId: m.resetBoundaryId, resetBoundaryTs: m.resetBoundaryTs,
        codexSessionId: m.codexSessionId || 'main', codexPrompt: m.codexPrompt || '' })
      return
    }
    notify({ kind: 'wire', wire: m })
  }

  socket.onclose = async ev => {
    const openedBefore = everOpenedThisAttempt
    wsState = 'closed'
    ws = null
    stopHeartbeat()
    settleConnectionProbes(false)
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

const proactiveActivityListeners = new Set()
/** Subscribe to completed self-directed proactive activities. These are
 * durable-until-acknowledged UI hints, deliberately separate from chat history. */
export function onProactiveActivity(fn) {
  proactiveActivityListeners.add(fn)
  return () => proactiveActivityListeners.delete(fn)
}

const proactiveActivityAckListeners = new Set()
export function onProactiveActivityAcknowledged(fn) {
  proactiveActivityAckListeners.add(fn)
  return () => proactiveActivityAckListeners.delete(fn)
}

/** Durable reading-permission requests created by the resident Claude Code. */
export function onCompanionReadingRequest(fn) {
  const listener = evt => {
    if (evt.kind === 'wire' && evt.wire?.type === 'reading_request' && evt.wire.request) fn(evt.wire.request)
  }
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announceProactiveActivityAcknowledged(id) {
  for (const fn of proactiveActivityAckListeners) {
    try { fn(id) } catch { /* isolate subscribers */ }
  }
}

function announceProactiveActivity(activity) {
  for (const fn of proactiveActivityListeners) {
    try { fn(activity) } catch { /* isolate subscribers */ }
  }
}

const remoteUserMessageListeners = new Set()
/** User messages accepted outside ChatWindow (for example a scheduled
 * diary letter) still belong in the resident CC conversation on every
 * device. Live wire events and reconnect history snapshots share this path. */
export function onRemoteUserMessage(fn) {
  remoteUserMessageListeners.add(fn)
  return () => remoteUserMessageListeners.delete(fn)
}

function maybeAnnounceRemoteUserMessage(message) {
  if (message?.type !== 'msg' || message.from !== 'user' || !message.id || !message.text) return
  for (const fn of remoteUserMessageListeners) {
    try { fn({ id: message.id, text: message.text, ts: message.ts }) } catch { /* isolate subscribers */ }
  }
}

// Reconnect history is a snapshot, never a sequence of live pushes. Expose
// it once as a batch so the inbox can anchor, dedupe, persist and render it in
// one deterministic transaction. Keep the latest snapshot for the brief race
// where the socket opens before React installs its subscriber.
const ccHistorySnapshotListeners = new Set()
let lastCcHistorySnapshot = null

export function onCcHistorySnapshot(fn) {
  ccHistorySnapshotListeners.add(fn)
  if (lastCcHistorySnapshot) {
    queueMicrotask(() => {
      if (ccHistorySnapshotListeners.has(fn)) fn(lastCcHistorySnapshot)
    })
  }
  return () => ccHistorySnapshotListeners.delete(fn)
}

function announceCcHistorySnapshot(items) {
  const snapshot = (Array.isArray(items) ? items : []).filter(item => item?.type === 'msg' && item.id)
  // Let an in-flight stream generator claim its own recovered wires first.
  setTimeout(() => {
    const unclaimed = snapshot.filter(item => !alreadyDelivered(item.id))
    lastCcHistorySnapshot = unclaimed
    for (const fn of ccHistorySnapshotListeners) {
      try { fn(unclaimed) } catch { /* isolate subscribers */ }
    }
  }, 0)
}

const ccMessageDeletedListeners = new Set()
/** A delete is display-history state, shared across tabs/devices. The server
 * sends stable wire ids; callers map those back to local aggregate bubbles. */
export function onCcMessageDeleted(fn) {
  ccMessageDeletedListeners.add(fn)
  return () => ccMessageDeletedListeners.delete(fn)
}

function announceCcMessageDeleted(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return
  for (const fn of ccMessageDeletedListeners) {
    try { fn(ids) } catch { /* isolate subscribers */ }
  }
}

// Takes the whole wire message (not just id/text/ts) so a proactive reply
// carries the same kind/voice/style/thinking a normal streamChatViaCompanion()
// -delivered one does — previously this dropped everything but text, silently
// downgrading any voice or thinking content CC sent outside of a
// directly-awaited turn. Gomoku chat never reaches this path at all — it's
// routed server-side into the game's own `messages` log (see onGomokuUpdate),
// never broadcast as a main-chat wire `msg` in the first place.
function maybeAnnounceProactive(wireMsg) {
  const { id, text, ts, kind, voice, style, thinking, musicAction } = wireMsg
  // Deferred to the next tick: lets any active generator's listener (which
  // runs synchronously within the same notify() call) markDelivered() first.
  // Only messages still unclaimed after that are genuinely spontaneous.
  setTimeout(() => {
    if (alreadyDelivered(id)) return
    markDelivered(id)
    for (const fn of proactiveListeners) {
      try {
        fn({ id, text, ts, kind, voice, style, thinking, musicAction })
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

function maybeAnnounceReset(input) {
  const marker = typeof input === 'number'
    ? { resetAt: input, mode: 'all', boundaryId: null, boundaryTs: null }
    : {
        resetAt: Number(input?.resetAt) || 0,
        mode: input?.mode === 'after_summary' ? 'after_summary' : 'all',
        boundaryId: typeof input?.boundaryId === 'string' ? input.boundaryId : null,
        boundaryTs: input?.boundaryTs != null && Number.isFinite(Number(input.boundaryTs)) ? Number(input.boundaryTs) : null,
      }
  if (!marker.resetAt || marker.resetAt <= lastKnownResetAt) return
  lastKnownResetAt = marker.resetAt
  try {
    localStorage.setItem(RESET_MARKER_KEY, String(marker.resetAt))
  } catch {
    // best-effort persistence — an in-memory-only marker still protects this tab for its own lifetime
  }
  for (const fn of ccResetListeners) {
    try {
      fn(marker)
    } catch {
      // a subscriber throwing must not break delivery to the others
    }
  }
}

// ---------- gomoku (五子棋) ----------
const gomokuListeners = new Set()
/** Subscribe to live gomoku board updates (user move, AI move, new game, and
 * in-game chat — the game's `messages` log is part of the same broadcast
 * object, see channel-server.ts's appendGomokuChatMsg). fn(game, runtime) —
 * runtime is 'claude-code' or 'codex'; a subscriber must filter to its own
 * runtime itself (GomokuBoard.jsx does), since both boards share this one
 * subscription channel. Returns an unsubscribe fn. */
export function onGomokuUpdate(fn) {
  gomokuListeners.add(fn)
  return () => gomokuListeners.delete(fn)
}
function announceGomoku(game, runtime) {
  for (const fn of gomokuListeners) {
    try {
      fn(game, runtime)
    } catch {
      // a subscriber throwing must not break delivery to the others
    }
  }
}

const diceDuelListeners = new Set()
export function onDiceDuelUpdate(fn) {
  diceDuelListeners.add(fn)
  return () => diceDuelListeners.delete(fn)
}
function announceDiceDuel(state, runtime) {
  for (const fn of diceDuelListeners) {
    try { fn(state, runtime) } catch { /* isolate subscribers */ }
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

// ---------- Focus (专注) ----------
// A single GLOBAL task server-side (see channel-server.ts's own Focus
// section) — not per-runtime like gomoku/xinchao, so no runtime filtering is
// needed here; every subscriber just gets the one real state. Initial state
// comes from a real GET (getFocusState, mirrors useCodexChat.js's own
// refresh() pattern) since the WS 'history' snapshot's codexHistory/focus
// fields are a known-latent, pre-existing gap in this module's history
// notify() (only openTurnId/items/resetAt are actually forwarded) — never
// relied on for Focus; live updates after that come from focus_update/
// focus_finished pushes.
const focusListeners = new Set()
export function onFocusUpdate(fn) {
  focusListeners.add(fn)
  return () => focusListeners.delete(fn)
}
function announceFocusUpdate(state) {
  for (const fn of focusListeners) {
    try { fn(state) } catch { /* one subscriber's throw must not break the others */ }
  }
}
const focusFinishedListeners = new Set()
export function onFocusFinished(fn) {
  focusFinishedListeners.add(fn)
  return () => focusFinishedListeners.delete(fn)
}
function announceFocusFinished(payload) {
  for (const fn of focusFinishedListeners) {
    try { fn(payload) } catch { /* one subscriber's throw must not break the others */ }
  }
}

export async function getFocusState() {
  const { state } = await companionJson('/focus/state')
  return state
}
export async function startFocus({ task, minutes, manager } = {}) {
  return companionJson('/focus/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task, minutes, ...(manager ? { manager } : {}) }),
  })
}
export async function focusInteract(text) {
  return companionJson('/focus/interact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
}
export async function requestFocus(kind, reason) {
  return companionJson('/focus/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, reason }),
  })
}
export async function resumeFocusFromApproval() {
  return companionJson('/focus/resume', { method: 'POST' })
}
export async function selfPauseFocus() {
  return companionJson('/focus/self/pause', { method: 'POST' })
}
export async function selfResumeFocus() {
  return companionJson('/focus/self/resume', { method: 'POST' })
}
export async function selfEndFocus() {
  return companionJson('/focus/self/end', { method: 'POST' })
}
// Used by useChat.js after parsing a real [FOCUS_APPROVE:...]/[FOCUS_DENY:...]
// tag out of a plain API-key model's own reply — see that file.
export async function apiManagerApproveFocus(sessionId, requestId, message) {
  return companionJson('/focus/api-manager/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, requestId, message }),
  })
}
export async function apiManagerDenyFocus(sessionId, requestId, reason) {
  return companionJson('/focus/api-manager/deny', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, requestId, reason }),
  })
}
export async function apiManagerFinishFocus(sessionId) {
  return companionJson('/focus/api-manager/finish', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId }),
  })
}
export async function apiManagerExtendFocus(sessionId, minutes) {
  return companionJson('/focus/api-manager/extend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, minutes }),
  })
}

// ---------- Group chat (多AI群聊) ----------
// Each group chat is its own independent persisted session (see
// channel-server.ts's "Group chat" section) — never mixed into either
// member's single-chat history. fn(chat) receives the FULL updated chat
// object every time (same "send the whole thing, no diffing" pattern
// onGomokuUpdate/onFocusUpdate already use) — a subscriber filters to the
// group id it cares about itself.
const groupListeners = new Set()
export function onGroupUpdate(fn) {
  groupListeners.add(fn)
  return () => groupListeners.delete(fn)
}
function announceGroupUpdate(chat) {
  for (const fn of groupListeners) {
    try { fn(chat) } catch { /* one subscriber's throw must not break the others */ }
  }
}

// ---------- 固定生活关怀群 ----------
const careListeners = new Set()
export function onCareHubUpdate(fn) {
  careListeners.add(fn)
  return () => careListeners.delete(fn)
}
function announceCareHubUpdate(state) {
  for (const fn of careListeners) {
    try { fn(state) } catch { /* isolate subscribers */ }
  }
}
export async function getCareHubState() {
  const { state } = await companionJson('/care/state')
  return state
}
export async function updateCareHubConfig(patch) {
  return companionJson('/care/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
}
export async function runCareRole(role) {
  return companionJson('/care/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role }) })
}
export async function addCareLedgerEntry(entry) {
  return companionJson('/care/ledger/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(entry) })
}
export async function deleteCareLedgerEntry(id) {
  return companionJson('/care/ledger/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
}
export async function addCareStudyGoal(goal) {
  return companionJson('/care/study/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(goal) })
}
export async function toggleCareStudyGoal(id, done, date) {
  return companionJson('/care/study/toggle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, done, ...(date ? { date } : {}) }) })
}
export async function deleteCareStudyGoal(id) {
  return companionJson('/care/study/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
}
export async function sendCareHubInput(text) {
  return companionJson('/care/input', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
}

export async function listGroupChats() {
  const { chats } = await companionJson('/group/list')
  return chats
}
export async function createGroupChat(name, members) {
  return companionJson('/group/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, members }),
  })
}
export async function getGroupChatState(id) {
  const { chat } = await companionJson(`/group/state?id=${encodeURIComponent(id)}`)
  return chat
}
export async function sendGroupMessage(id, text, mentions = []) {
  return companionJson('/group/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text, mentions }),
  })
}
export async function startGroupNewTopic(id) {
  return companionJson('/group/new-topic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}
// Wipes this group's own messages/candidates/mention grants/pending client
// turns and starts a genuinely blank new topic with quotas reset — never
// touches members, avatars, background, or any member's own single-chat
// memory (see channel-server.ts's groupClearMessages).
export async function clearGroupMessages(id) {
  return companionJson('/group/clear-messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}
// Deletes THIS group chat entirely (messages/topic/members/pending tasks) —
// never a member's own single-chat window/memory/avatar/API config (see
// channel-server.ts's groupDeleteChat).
export async function deleteGroupChat(id) {
  return companionJson('/group/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })
}
export async function approveGroupCandidate(id, candidateId) {
  return companionJson('/group/candidate/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, candidateId }),
  })
}
export async function rejectGroupCandidate(id, candidateId) {
  return companionJson('/group/candidate/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, candidateId }),
  })
}
// member: { kind:'vps', runtime } | { kind:'api', sessionId, name } — see
// src/utils/groupMembers.js's memberSpecForSession, the only place this
// shape is built from a real session.
export async function inviteGroupMember(id, member) {
  return companionJson('/group/invite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, member }),
  })
}
export async function removeGroupMember(id, memberId) {
  return companionJson('/group/remove', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, memberId }),
  })
}
// Fulfills an 'api'-kind member's pending client turn (see
// src/utils/groupApiMember.js) — action is 'speak' | 'request' | 'pass',
// matching CC's group_speak/group_request_to_speak/group_pass tools. scope
// carries requestId/channelType/conversationId/groupId/topicId, exactly
// what the pending task was created with — channel-server.ts rejects the
// submit outright if any of these no longer match the current pending
// entry (see groupClientTurnSubmit), so a stale/late response can never be
// misapplied.
export async function submitGroupClientTurn(id, memberId, scope, action, extra = {}) {
  return companionJson('/group/client-turn/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, memberId, ...scope, action, ...extra }),
  })
}

// ---------- 心潮 (xinchao) ----------
// Purely reactive — no polling. The server pushes a fresh xinchao_update on
// WS open, and again whenever a turn ends (see channel-server.ts). This just
// forwards whatever it broadcasts; already-sanitized (no drive numbers,
// tokens, or session ids) by the server before it ever reaches here.
// Claude Code and Codex each have their OWN real xinchao session/tone
// overlay (see channel-server.ts's XINCHAO_CC_SESSION_ID/
// XINCHAO_CODEX_SESSION_ID) — every update carries its own `runtime` tag;
// fn(state, runtime) — a subscriber must filter to its own runtime itself
// (ChatWindow.jsx does), since both share this one subscription channel,
// exactly like onGomokuUpdate below.
const xinchaoListeners = new Set()
export function onXinchaoUpdate(fn) {
  xinchaoListeners.add(fn)
  return () => xinchaoListeners.delete(fn)
}
function announceXinchao(state, runtime) {
  for (const fn of xinchaoListeners) {
    try {
      fn(state, runtime)
    } catch {
      // a subscriber throwing must not break delivery to the others
    }
  }
}
// One-shot — for seeding initial state on mount (e.g. the WS was already
// open before this component mounted, so the "sent once on open" broadcast
// already fired and won't repeat). Not polling: call it once, then rely on
// onXinchaoUpdate for everything after. runtime defaults to 'claude-code'
// for backward compatibility with any existing caller that doesn't pass one.
export async function getXinchaoStatus(runtime = 'claude-code') {
  return companionJson(`/xinchao/status?runtime=${encodeURIComponent(runtime)}`)
}

export async function getXinchaoDashboard(runtime = 'claude-code') {
  return companionJson(`/xinchao/dashboard?runtime=${encodeURIComponent(runtime)}`)
}

export async function sendXinchaoInteraction(interactionType, eventId = crypto.randomUUID()) {
  return companionJson('/xinchao/interaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ interactionType, eventId }),
  })
}

export async function getStudySchedule(startDate, endDate = startDate) {
  return companionJson(`/study-schedule?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`)
}

export async function setStudyScheduleCourse(date, slot, course) {
  return companionJson('/study-schedule', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, slot, course }),
  })
}

// ---------- 纪念日日历 ----------
// A simple date -> events[] calendar, independent of the ledger. cc reads/
// writes the same store through get_anniversary/write_anniversary MCP tools
// (see channel-server.ts), so entries added here are visible to cc and vice
// versa.
export async function getAnniversaryRange(startDate, endDate = startDate) {
  return companionJson(`/anniversary?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`)
}
export async function addAnniversaryEvent(date, text) {
  return companionJson('/anniversary/add', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, text }) })
}
export async function deleteAnniversaryEvent(date, id) {
  return companionJson('/anniversary/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, id }) })
}

// Every call takes an explicit `runtime` ('claude-code' | 'codex') so the
// two boards/threads/turn-tracking never share state — see channel-server.ts's
// runtime-branched gomoku endpoints. Defaults to 'claude-code' so any
// existing caller that doesn't pass one keeps its original behavior.
export async function getGomokuState(runtime = 'claude-code') {
  return companionJson(`/gomoku/state?runtime=${encodeURIComponent(runtime)}`)
}
export async function getDiceDuelState(runtime = 'claude-code') {
  return companionJson(`/dice/state?runtime=${encodeURIComponent(runtime)}`)
}
export async function getSpicyVisualState() {
  return companionJson('/spicy/visual-state')
}
export async function rollDiceDuel(runtime = 'claude-code') {
  return companionJson('/dice/roll', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtime }),
  })
}
export async function newGomokuGame(runtime = 'claude-code') {
  return companionJson('/gomoku/new', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtime }),
  })
}
export async function makeGomokuMove(row, col, runtime = 'claude-code') {
  return companionJson('/gomoku/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ row, col, runtime, clientTime: clientTimeContext() }),
  })
}
// mode:'immediate' (AI hadn't moved yet, retracted right away) or
// mode:'pending' (AI already moved — genuinely asked for real, over the MCP
// channel for Claude Code or a real [UNDO:yes/no]-tagged turn for Codex; the
// actual outcome arrives later as a gomoku_update broadcast, including
// anything the opponent says about it in the game's own `messages` log).
export async function requestGomokuUndo(runtime = 'claude-code') {
  return companionJson('/gomoku/undo-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtime, clientTime: clientTimeContext() }),
  })
}
export async function resignGomokuGame(runtime = 'claude-code') {
  return companionJson('/gomoku/resign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtime, clientTime: clientTimeContext() }),
  })
}
// In-game chat — text typed on the gomoku screen, or a voice press-and-hold's
// transcript (voice:true, transcribed client-side, never a new server-side
// STT path). The opponent's reply arrives via onGomokuUpdate (game.messages),
// not via streamChatViaCompanion/onCodexEvent — this call returns as soon as
// the message is queued, not once the opponent has replied.
export async function postGomokuChat(gameId, text, voice = false, runtime = 'claude-code') {
  return companionJson('/gomoku/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, text, voice, runtime, clientTime: clientTimeContext() }),
  })
}

// ---------- Codex (codex-vps) ----------
// A fully separate runtime from Claude Code. Reuses this SAME WebSocket
// connection (per the isolation design), but every wire message has its own
// `codex_*` type — never Claude Code's plain `msg`/`turn_start`/`turn_end` —
// so the two can never be confused with each other. sendCodexMessage tags
// its own outgoing send with runtime:'codex' so channel-server.ts routes it
// to Codex's entirely separate turn-state/history, never Claude Code's.
const codexListeners = new Set()
/** Subscribe to every codex_* wire event (codex_msg/codex_status/
 * codex_turn_end/codex_turn_busy/codex_reset_busy/codex_reset), plus a
 * synthetic 'codex_history_snapshot' fired once per (re)connect from the
 * WS 'history' message's own codex fields. Returns an unsubscribe fn. */
export function onCodexEvent(fn) {
  codexListeners.add(fn)
  return () => codexListeners.delete(fn)
}
function announceCodex(evt) {
  for (const fn of codexListeners) {
    try {
      fn(evt)
    } catch {
      // a subscriber throwing must not break delivery to the others
    }
  }
}

export function selectCodexSession(sessionId) {
  selectedCodexSessionId = normalizeCodexSessionId(sessionId)
  const sent = sendRaw({ type: 'codex_session', sessionId: selectedCodexSessionId })
  if (!sent) ensureConnected()
  return sent
}

export async function getCodexState(sessionId = selectedCodexSessionId) {
  const id = normalizeCodexSessionId(sessionId)
  return companionJson(`/codex/state?sessionId=${encodeURIComponent(id)}`)
}
// Lightweight, poll-friendly status for the header's model/usage widget —
// real current model + real usage + real model catalog (via Codex's own
// model/list RPC), never Claude Code's MODEL_IDS or crystal-orb usage data.
// Deliberately separate from getCodexState() so a timer-driven poll never
// has to also pull the (potentially long) chat history on every tick.
export async function getCodexModelStatus() {
  return companionJson(`/codex/model-status?_=${Date.now()}`, { cache: 'no-store' })
}
export async function switchCodexModel(modelId) {
  return companionJson('/codex/model/switch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelId }),
  })
}
export async function getCodexAuthStatus() {
  return companionJson('/codex/auth-status')
}
export async function saveCodexPrompt(sessionId, prompt) {
  return companionJson('/codex/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: normalizeCodexSessionId(sessionId), prompt: typeof prompt === 'string' ? prompt : '' }),
  })
}
export async function deleteCodexMessage(sessionId, messageId) {
  return companionJson('/codex/message/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: normalizeCodexSessionId(sessionId), messageId }),
  })
}
export async function editCodexMessage(sessionId, messageId, text) {
  return companionJson('/codex/message/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: normalizeCodexSessionId(sessionId), messageId, text }),
  })
}
export async function stopCodex(sessionId = selectedCodexSessionId) {
  return companionJson('/codex/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: normalizeCodexSessionId(sessionId) }),
  })
}
export async function resetCodex(sessionId = selectedCodexSessionId) {
  return companionJson('/codex/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: normalizeCodexSessionId(sessionId) }),
  })
}
let codexSeq = 0
export function sendCodexMessage(text, imageUrl, options = {}) {
  const sessionId = normalizeCodexSessionId(options?.sessionId || selectedCodexSessionId)
  const prompt = typeof options?.prompt === 'string' ? options.prompt : ''
  const id = `codex-eunoia-${Date.now()}-${++codexSeq}`
  return sendRaw(buildCodexMessagePayload({ id, text, segments: options?.segments, imageUrl, imageSeparate: options?.imageSeparate, file: options?.file, sessionId, prompt, clientTime: clientTimeContext(), voiceEmotion: options?.voiceEmotion, voiceAcoustics: options?.voiceAcoustics }))
}

/**
 * Voice-call adapter for the persistent Codex runtime.
 *
 * This deliberately mirrors streamChatViaCompanion's { text } async-
 * generator contract so callers can route a transcribed turn through the
 * SAME Codex thread used by typed chat. codex_msg streaming updates contain
 * the whole answer-so-far, not deltas, so this adapter converts them back to
 * deltas and ignores the final bubble-splitting replay.
 */
export async function* streamChatViaCodex({ text, sessionId, prompt = '', signal, voiceEmotion, voiceAcoustics }) {
  if (signal?.aborted) return

  const wantedSessionId = normalizeCodexSessionId(sessionId)
  const queue = []
  let wake = null
  let finishError = null
  let sawStreamingReply = false
  const streamedTextById = new Map()
  const deliveredVoiceIds = new Set()

  const push = (item) => {
    if (wake) {
      const resolve = wake
      wake = null
      resolve(item)
    } else {
      queue.push(item)
    }
  }
  const next = () => queue.length
    ? Promise.resolve(queue.shift())
    : new Promise(resolve => { wake = resolve })

  const unsubscribe = onCodexEvent((evt) => {
    if (normalizeCodexSessionId(evt.sessionId) !== wantedSessionId) return

    if (evt.type === 'codex_turn_busy' || evt.type === 'codex_reset_busy') {
      finishError = new Error(evt.type === 'codex_turn_busy'
        ? 'Codex 正在处理上一轮，请稍候再说'
        : 'Codex 正在清空对话，请稍候再说')
      push({ done: true })
      return
    }
    if (evt.type === 'codex_notice' && evt.kind === 'error') {
      finishError = new Error(evt.message || 'Codex 回复失败')
      push({ done: true })
      return
    }
    if (evt.type === 'codex_turn_end') {
      push({ done: true })
      return
    }
    if (evt.type !== 'codex_msg' || evt.msg?.from !== 'codex') return

    const msg = evt.msg
    const value = msg.text || ''
    if (msg.kind === 'voice') {
      if (value && !deliveredVoiceIds.has(msg.id)) {
        deliveredVoiceIds.add(msg.id)
        push({ text: value })
      }
      return
    }
    if (msg.streaming) {
      sawStreamingReply = true
      const previous = streamedTextById.get(msg.id) || ''
      const delta = value.startsWith(previous) ? value.slice(previous.length) : value
      streamedTextById.set(msg.id, value)
      if (delta) push({ text: delta })
      return
    }
    // turn completion re-broadcasts the streamed answer as one or more
    // finalized bubbles. It is history/UI normalization, not new speech.
    if (!sawStreamingReply && value) push({ text: value })
  })

  let aborted = false
  const onAbort = () => {
    aborted = true
    push({ done: true })
    stopCodex(wantedSessionId).catch(() => {})
  }
  signal?.addEventListener('abort', onAbort)

  try {
    selectCodexSession(wantedSessionId)
    const sent = sendCodexMessage(text, undefined, { sessionId: wantedSessionId, prompt, voiceEmotion, voiceAcoustics })
    if (!sent) throw new Error('companion 未连接')
    while (true) {
      const item = await next()
      if (item.done) break
      yield item
    }
    if (!aborted && finishError) throw finishError
  } finally {
    signal?.removeEventListener('abort', onAbort)
    unsubscribe()
  }
}

listeners.add(evt => {
  if (evt.kind === 'wire') {
    const m = evt.wire
    if (m.type === 'reset') {
      maybeAnnounceReset({ resetAt: m.ts, mode: m.mode, boundaryId: m.boundaryId, boundaryTs: m.boundaryTs })
      return
    }
    if (m.type === 'proactive_activity') {
      announceProactiveActivity({ id: m.id, text: m.text, ts: m.ts })
      return
    }
    if (m.type === 'proactive_activity_ack') {
      announceProactiveActivityAcknowledged(m.id)
      return
    }
    if (m.type === 'gomoku_update') {
      announceGomoku(m.game, m.runtime || 'claude-code')
      return
    }
    if (m.type === 'dice_duel_update') {
      announceDiceDuel(m.state, m.runtime || 'claude-code')
      return
    }
    // Codex gomoku has no tmux/MCP turnId space to reuse the way Claude
    // Code's gomoku piggybacks on turn_end/turn_error for — this is its own
    // explicit completion signal, routed into the SAME onTurnEnd() channel
    // GomokuBoard.jsx already generically consumes (it just compares ids).
    if (m.type === 'gomoku_turn_end') {
      announceTurnEnd(m.interactionId)
      return
    }
    if (m.type === 'xinchao_update') {
      announceXinchao(m.state, m.runtime || 'claude-code')
      return
    }
    if (m.type === 'focus_update') {
      announceFocusUpdate(m.state)
      return
    }
    if (m.type === 'focus_finished') {
      announceFocusFinished({ reason: m.reason, manager: m.manager, actualMs: m.actualMs })
      return
    }
    if (m.type === 'group_update') {
      announceGroupUpdate(m.chat)
      return
    }
    if (m.type === 'care_update') {
      announceCareHubUpdate(m.state)
      return
    }
    if (m.type === 'codex_msg' || m.type === 'codex_msg_deleted' || m.type === 'codex_status' || m.type === 'codex_notice' || m.type === 'codex_turn_end'
      || m.type === 'codex_turn_busy' || m.type === 'codex_reset_busy' || m.type === 'codex_reset'
      || m.type === 'codex_history_snapshot') {
      announceCodex(m)
      return
    }
    if (m.type === 'turn_end' || m.type === 'turn_error') {
      announceTurnEnd(m.turnId)
      // fall through — turn_end/turn_error also matter to any in-flight
      // streamChatViaCompanion() generator, handled further down via `listeners`
    }
    if (m.type === 'msg_deleted') {
      announceCcMessageDeleted(m.ids)
      return
    }
    if (m.type === 'msg' && m.from === 'user') maybeAnnounceRemoteUserMessage(m)
    if (m.type === 'msg' && m.from === 'cc') maybeAnnounceProactive(m)
    return
  }
  if (evt.kind === 'history') {
    maybeAnnounceReset({
      resetAt: evt.resetAt,
      mode: evt.resetMode,
      boundaryId: evt.resetBoundaryId,
      boundaryTs: evt.resetBoundaryTs,
    })
    announceCcHistorySnapshot(evt.items)
    announceCodex({
      type: 'codex_history_snapshot',
      sessionId: evt.codexSessionId || 'main',
      codexHistory: evt.codexHistory || [],
      codexOpenTurnId: evt.codexOpenTurnId ?? null,
      codexStatus: evt.codexStatus || 'idle',
      codexPrompt: evt.codexPrompt || '',
    })
  }
})

/** Idempotent: opens the shared connection if it isn't already open/connecting. */
export function ensureConnected() {
  clearTimeout(reconnectTimer)
  authFailed = false
  reconnectAttempt = 0
  if (wsState === 'idle' || wsState === 'closed') connect()
}

/**
 * Rebuild the shared socket after the page has returned from an iOS/system
 * interruption. Mobile Safari can keep a dead WebSocket in OPEN state after
 * Guided Access, the app switcher, or a network hand-off, so ensureConnected
 * alone intentionally cannot repair it. This is only called on an actual
 * foreground transition, never for routine renders.
 */
export function reconnectCompanion() {
  clearTimeout(reconnectTimer)
  authFailed = false
  reconnectAttempt = 0
  stopHeartbeat()

  const staleSocket = ws
  // This manual replacement deliberately detaches the old socket's onclose
  // handler below, so an in-flight chat generator would otherwise never
  // learn that it must recover its turn from the new connection's history
  // snapshot. Announce the transport break before detaching it.
  if (staleSocket && (wsState === 'open' || wsState === 'connecting')) {
    settleConnectionProbes(false)
    notify({ kind: 'close', wasClean: false, code: 0, forced: true })
  }
  ws = null
  wsState = 'closed'
  if (staleSocket) {
    // Detach first: the stale socket's delayed close event must not schedule a
    // second reconnect or overwrite the fresh singleton's state.
    staleSocket.onopen = null
    staleSocket.onmessage = null
    staleSocket.onerror = null
    staleSocket.onclose = null
    try { staleSocket.close() } catch { /* already gone */ }
  }
  connect()
}

export function sendDiaryLetterNow({ id, text }) {
  return companionJson('/diary-letter/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text, clientTime: clientTimeContext() }),
  })
}

export function scheduleDiaryLetter({ id, text, deliverAt }) {
  return companionJson('/diary-letter/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text, deliverAt, clientTime: clientTimeContext() }),
  })
}

export async function getScheduledDiaryLetters() {
  const { items } = await companionJson('/diary-letter/schedule')
  return Array.isArray(items) ? items : []
}

export function cancelScheduledDiaryLetter(id) {
  return companionJson(`/diary-letter/schedule?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
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

/** Remove a server-persisted activity note only after the user confirms it. */
export async function acknowledgeProactiveActivity(id) {
  if (!id) return false
  ensureConnected()
  await waitUntilOpenOrFail()
  if (!sendRaw({ type: 'proactive_activity_ack', id })) throw new Error('companion 未连接')
  return true
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

// After a quiet/background period, do not trust WebSocket.OPEN by itself:
// browsers can retain that state for a dead mobile connection. Probe only
// when we have not heard from the server recently, so normal back-and-forth
// turns pay no extra round trip. A failed probe replaces the socket before
// the user message is sent, avoiding the old 20s heartbeat wait and a send
// that vanished into a half-dead connection.
async function ensureFreshConnectionBeforeSend() {
  await waitUntilOpenOrFail()
  if (Date.now() - lastServerActivityAt <= PRE_SEND_STALE_MS) return

  const probedSocket = ws
  const alive = await new Promise(resolve => {
    let settled = false
    const finish = ok => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connectionProbeWaiters.delete(finish)
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), CONNECTION_PROBE_TIMEOUT_MS)
    connectionProbeWaiters.add(finish)
    if (!sendRaw({ type: 'ping' })) finish(false)
  })
  if (alive && ws === probedSocket && wsState === 'open') return
  reconnectCompanion()
  await waitUntilOpenOrFail()
}

let seq = 0
function genId() {
  return `eunoia-${Date.now()}-${++seq}`
}

// Best-effort notice for the resident VPS session when the user deletes a
// message locally: the deletion never touches CC's own persistent memory
// (there's no such primitive), so without this it can later reference or
// repeat content the user thought was gone. Fire-and-forget on purpose — a
// dropped notice (offline, or CC mid-turn on something else, see
// notifyCcOfDeletedMessage's own currentTurn check server-side) just means
// this one deletion doesn't get flagged, not a broken feature.
export function sendDeleteNotice(text, messageIds = []) {
  if (!text && messageIds.length === 0) return
  sendRaw({ type: 'delete_notice', text, messageIds, clientTime: clientTimeContext() })
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
 * The server's turn/message timestamps are forwarded with those chunks so
 * the UI reports the real elapsed turn time instead of guessing from paint
 * timing (which iOS may suspend in the app switcher).
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
export async function* streamChatViaCompanion({ text, imagePath, file, signal, messageId, voiceEmotion, voiceAcoustics, callMode = false }) {
  if (signal?.aborted) return

  await ensureFreshConnectionBeforeSend()

  // Reuse the local user bubble id when this turn originated in ChatWindow.
  // The server broadcasts the accepted user message back to every connected
  // client (including the sender); App.jsx can then identify that echo as the
  // bubble already persisted locally instead of appending it a second time.
  // Callers without a local bubble (voice call, background integrations) keep
  // the generated wire id they have always used.
  const id = messageId || genId()
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
  // Set only by a real inbound_ack from the server for THIS message id — see
  // the heartbeat/ack comment above sendRaw's definition. Tells the two
  // "no reply found on reconnect" cases apart: the send never actually
  // reached the server (socket looked open but wasn't — the common case,
  // silent and previously indistinguishable from a genuine server-side turn
  // loss) versus it truly did arrive and something rarer happened server-side.
  let ackReceived = false

  const onEvent = evt => {
    if (evt.kind === 'auth_required') {
      finishError = Object.assign(new Error('未登录 companion，请先登录'), { code: 'auth_required', turnId })
      push({ done: true })
      return
    }

    if (evt.kind === 'inbound_ack') {
      if (evt.id === id) ackReceived = true
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
      if (evt.openTurnId === turnId || evt.queuedTurnIds?.includes(turnId)) return // still open/queued server-side, keep waiting
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
          if (r.thinking) push({ reasoningReplace: r.thinking, reasoningCompletedAt: r.ts })
          if (r.kind === 'voice') push({ voice: { id: r.id, text: r.text, voice: r.voice, style: r.style } })
          else push({ text: r.text, wireId: r.id, ...(r.musicAction ? { musicAction: r.musicAction } : {}) })
        }
        push({ done: true })
      } else if (!ackReceived) {
        // The server never even confirmed receiving this message — almost
        // certainly it never arrived (dead-looking-alive socket), not a
        // server-side turn failure. Actionable: just resend.
        finishError = Object.assign(
          new Error('消息可能没有发送成功，请重新发送'),
          { code: 'send_failed', turnId },
        )
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
        new Error('他还在忙上一轮，请稍候再发送'),
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
    if (m.type === 'turn_start') {
      if (m.ts) push({ reasoningStartedAt: m.ts })
      return
    }
    if (m.type === 'thinking') {
      if (m.delta) push({ reasoning: m.delta })
      return
    }
    // What CC is actually doing this turn (reading a file, running a command).
    // Pushed by the server's PreToolUse hook, live only — nothing replays
    // these after a reconnect, so a turn recovered from history simply shows
    // no activity rather than a partial, misleading list.
    if (m.type === 'tool_use') {
      if (m.tool) push({ toolUse: { tool: m.tool, detail: m.detail || '', ts: m.ts } })
      return
    }
    if (m.type === 'msg' && m.from === 'cc') {
      if (alreadyDelivered(m.id)) return // e.g. already delivered via an earlier history recovery
      markDelivered(m.id)
      thisTurnDeliveredIds.push(m.id)
      const timing = m.thinking && m.ts ? { reasoningCompletedAt: m.ts } : {}
      if (m.kind === 'voice') push({ voice: { id: m.id, text: m.text, voice: m.voice, style: m.style }, ...timing })
      else push({ text: m.text, wireId: m.id, ...(m.musicAction ? { musicAction: m.musicAction } : {}), ...timing })
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
    // Previously "stop" only made THIS TAB stop listening — the resident
    // Claude Code session on the VPS never learned about it and kept right
    // on working (reading files, running commands) to a reply nobody would
    // ever see. This tells the server to type a real Escape into the live
    // tmux pane, the same interrupt a human would send from the terminal.
    // Fire-and-forget: this generator is already tearing down regardless of
    // whether the server actually manages to stop the remote turn in time.
    sendRaw({ type: 'stop_turn', turnId })
  }
  signal?.addEventListener('abort', onAbort)

  try {
    const sent = sendRaw({
      id, text, ...(callMode ? { callMode: true } : {}), ...(imagePath ? { imagePath } : {}),
      ...(file?.path ? { filePath: file.path, fileName: file.name, fileSize: file.size, fileType: file.mimeType } : {}),
      ...(voiceEmotion ? { voiceEmotion } : {}),
      ...(voiceAcoustics ? { voiceAcoustics } : {}),
      clientTime: clientTimeContext(),
    })
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
      if (item.reasoningReplace !== undefined) {
        yield {
          reasoningReplace: item.reasoningReplace,
          ...(item.reasoningCompletedAt ? { reasoningCompletedAt: item.reasoningCompletedAt } : {}),
        }
      } else if (item.reasoning) yield { reasoning: item.reasoning }
      else if (item.reasoningStartedAt) yield { reasoningStartedAt: item.reasoningStartedAt }
      // The onEvent handler above already builds this into a proper
      // { toolUse: {...} } queue item — this branch just has to actually let
      // it out. Without it, a toolUse item fell through to the final `else`
      // below and got yielded as { text: undefined, wireId: undefined }
      // instead, so useChat.js's `chunk.toolUse` check never once saw it.
      else if (item.toolUse) yield { toolUse: item.toolUse }
      // wireId rides along with each text chunk so the caller can persist
      // which server-side message ids this turn already displayed — the
      // history-snapshot dedup in App.jsx matches against them (voice chunks
      // already carry their wire id inside `voice.id`).
      else yield item.voice
        ? { voice: item.voice, ...(item.reasoningCompletedAt ? { reasoningCompletedAt: item.reasoningCompletedAt } : {}) }
        : {
            text: item.text,
            wireId: item.wireId,
            ...(item.musicAction ? { musicAction: item.musicAction } : {}),
            ...(item.reasoningCompletedAt ? { reasoningCompletedAt: item.reasoningCompletedAt } : {}),
          }
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

// ---------- durable AI reading (resident Claude Code) ----------

export function syncReadingBookToCompanion(book) {
  return companionJson('/reading/books/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ book }),
  })
}

export function listCompanionReadingBooks() {
  return companionJson('/reading/books')
}

export function getCompanionReadingBook(bookId) {
  return companionJson(`/reading/book?bookId=${encodeURIComponent(bookId)}`)
}

export function deleteCompanionReadingBook(bookId) {
  return companionJson(`/reading/books?bookId=${encodeURIComponent(bookId)}`, { method: 'DELETE' })
}

export function getCompanionReadingState(bookId) {
  return companionJson(`/reading/state?bookId=${encodeURIComponent(bookId)}`, { cache: 'no-store' })
}

export function getCompanionReadingRequests(status = 'pending') {
  return companionJson(`/reading/requests?status=${encodeURIComponent(status)}`, { cache: 'no-store' })
}

export function approveCompanionReadingRequest(requestId, approvedPages) {
  return companionJson('/reading/request/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, approvedPages }),
  })
}

export function rejectCompanionReadingRequest(requestId) {
  return companionJson('/reading/request/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId }),
  })
}

export function startCompanionReadingSession({ bookId, approvedPages, sessionId }) {
  return companionJson('/reading/session/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId, approvedPages, ...(sessionId ? { sessionId } : {}) }),
  })
}

export function getCompanionReadingAnnotations(bookId, pageStart, pageEnd) {
  const params = new URLSearchParams({ bookId })
  if (Number.isFinite(pageStart)) params.set('pageStart', String(pageStart))
  if (Number.isFinite(pageEnd)) params.set('pageEnd', String(pageEnd))
  return companionJson(`/reading/annotations?${params}`)
}

export function likeCompanionReadingAnnotation(id, liked) {
  return companionJson('/reading/annotation/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, liked }),
  })
}

export function replyToCompanionReadingAnnotation(id, text) {
  return companionJson('/reading/annotation/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, text }),
  })
}

export function getCompanionReadingSessions(bookId, limit = 20) {
  return companionJson(`/reading/sessions?bookId=${encodeURIComponent(bookId)}&limit=${encodeURIComponent(limit)}`)
}

/**
 * Runs exactly one server-sized batch (at most three pages / bounded chars)
 * on the same resident Claude Code session used by the ordinary companion
 * chat. The turn is silent: the only useful payload is the Reading Store
 * commit broadcast. The caller schedules the next batch after this resolves.
 */
export async function runResidentReadingBatch({ sessionId, signal, onPhase }) {
  if (!sessionId) throw new Error('缺少阅读 session')
  if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' })
  await ensureFreshConnectionBeforeSend()

  const turnId = genId()
  return new Promise((resolve, reject) => {
    let result = null
    let settled = false
    let timeout = null

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      listeners.delete(onEvent)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(value)
    }

    const onAbort = () => {
      sendRaw({ type: 'stop_turn', turnId })
      finish(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    }

    const onEvent = evt => {
      if (evt.kind === 'auth_required') {
        finish(Object.assign(new Error('未登录 companion，请先登录'), { code: 'auth_required' }))
        return
      }
      if (evt.kind === 'close') {
        // The resident task belongs to the server, not to this particular
        // socket. Keep the listener alive across the service's automatic
        // reconnect so a tab/background transition cannot turn a successful
        // commit into a local failure.
        return
      }
      if (evt.kind !== 'wire') return
      const message = evt.wire
      if (message.type === 'turn_busy') {
        finish(Object.assign(new Error('常驻 Claude Code 正在处理另一件事，请稍后继续。'), { code: 'turn_busy' }))
        return
      }
      if (message.turnId !== turnId) return
      if (message.type === 'reading_phase') {
        onPhase?.(message)
        return
      }
      if (message.type === 'reading_update') {
        result = message.result
        return
      }
      if (message.type === 'reading_error' || message.type === 'turn_error') {
        finish(Object.assign(new Error(message.error || '阅读批次失败'), { code: 'reading_error' }))
        return
      }
      if (message.type === 'turn_end') {
        if (result) finish(null, result)
        else finish(Object.assign(new Error('常驻 Claude Code 没有提交这一批阅读结果。'), { code: 'reading_not_committed' }))
      }
    }

    listeners.add(onEvent)
    signal?.addEventListener('abort', onAbort, { once: true })
    timeout = setTimeout(() => {
      sendRaw({ type: 'stop_turn', turnId })
      finish(Object.assign(new Error('这一批阅读超时了，书签仍停在上一次成功位置。'), { code: 'reading_timeout' }))
    }, 8 * 60_000)

    if (!sendRaw({ type: 'reading_task', id: turnId, readingSessionId: sessionId, clientTime: clientTimeContext() })) {
      finish(Object.assign(new Error('companion 未连接'), { code: 'not_connected' }))
    }
  })
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
    err.code = body?.error || null
    err.currentRevision = body?.currentRevision
    throw err
  }
  return body
}

export async function sendVpsDesktopPetAction({ runtime, sessionId, action }) {
  return companionJson('/pet/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runtime, sessionId, action }),
  })
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

// Uploads an image to the VPS as a real file and returns its on-disk path,
// so the resident CC session can look at it with its own Read tool instead
// of the image being piped through as a base64 blob in the message text.
// dataUrl must be a `data:image/(jpeg|png|webp|gif);base64,...` string.
export async function uploadImageToCompanion(dataUrl) {
  const data = await companionJson('/upload/image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataUrl }),
  })
  return data.path
}

export async function uploadFileToCompanion(file) {
  if (!file) throw new Error('没有选择文件')
  if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10MB')
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
  return companionJson('/upload/file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, dataUrl }),
  })
}

export async function deleteUploadedFile(path) {
  if (!path) return
  return companionJson('/upload/file/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

// Removes an image previously uploaded via uploadImageToCompanion — called
// when the message that referenced it gets deleted, so a deleted message
// doesn't leave its file behind forever on the VPS.
export async function deleteUploadedImage(path) {
  if (!path) return
  return companionJson('/upload/image/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function deleteMemoryFile(name) {
  return companionJson('/memory/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

// ---------- CC fixed-window tidal memory ----------
// These endpoints address only the authoritative rolling summary owned by
// the resident CC session. They never read the retired compression-review
// drafts, Codex memory, or ordinary API conversation state.

export async function getTidalMemoryStatus() {
  return companionJson(`/tidal-memory/status?_=${Date.now()}`, { cache: 'no-store' })
}

export async function saveTidalMemorySummary({ sessionId, expectedRevision, summaryText }) {
  return companionJson('/tidal-memory/summary', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, expectedRevision, summaryText }),
  })
}

// Codex memory is intentionally separate from the Claude Code Auto Memory
// endpoints above. Every request carries the active Eunoia session id, so a
// file edited in one Codex conversation cannot appear in another.
export async function listCodexMemoryFiles(sessionId = selectedCodexSessionId) {
  const id = normalizeCodexSessionId(sessionId)
  const data = await companionJson(`/codex/memory/list?sessionId=${encodeURIComponent(id)}`)
  return data.files
}

export async function getCodexMemoryFile(sessionId, name) {
  const id = normalizeCodexSessionId(sessionId)
  return companionJson(`/codex/memory/get?sessionId=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`)
}

export async function putCodexMemoryFile(sessionId, name, content) {
  return companionJson('/codex/memory/put', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: normalizeCodexSessionId(sessionId), name, content }),
  })
}

export async function deleteCodexMemoryFile(sessionId, name) {
  return companionJson('/codex/memory/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: normalizeCodexSessionId(sessionId), name }),
  })
}

// ---------- statusLine-fed usage/model status ----------

export async function getCompanionStatus() {
  return companionJson(`/status?_=${Date.now()}`, { cache: 'no-store' })
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
export async function resetCcConversation(mode = 'all') {
  return companionJson('/cc/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: mode === 'after_summary' ? 'after_summary' : 'all' }),
  })
}

// ---------- Mystery game (剧本杀) — isolated CC/Codex character turns ----------
// Every call is scoped by (gameId, charId) — the VPS spins up (and keeps
// alive for the life of that game) a genuinely separate CC tmux session /
// Codex thread per character, never touching either runtime's own single-
// chat or group-chat conversation. See channel-server.ts's own "Mystery
// game" section for the full design. This module never sees a character's
// OTHER secrets or the script's truth — MysteryGameRoom only ever builds and
// sends the ONE character's own system prompt + turn instruction.

// Fixed Claude Code model allowlist for this game (mirrors the VPS's own
// MODEL_IDS) — fetched rather than hardcoded here so the two never drift.
export async function getMysteryCcModels() {
  const data = await companionJson('/mystery/cc-models')
  return data.models
}

// Runs exactly one real turn on that character's own isolated thread and
// returns its reply text. Throws (never fabricates a reply) on any failure
// — missing config, timeout, model error — same "never fake success"
// contract every other real-model call in this app already follows.
// signal (optional AbortController.signal): lets the caller genuinely cancel
// a still-pending request — used by MysteryGameRoom's "跳过" button so
// skipping a slow CC/Codex turn doesn't just tell the UI to move on while
// the network request (and the underlying VPS-side wait) keeps running in
// the background, which is what used to let a stale reply for an abandoned
// turn silently reappear later.
export async function runMysteryTurn(gameId, charId, runtime, model, systemPrompt, instruction, signal, imageUrl = '', imagePath = '') {
  const data = await companionJson('/mystery/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, charId, runtime, model, systemPrompt, instruction, imageUrl, imagePath }),
    signal,
  })
  return data.text
}

// Tears down every real CC tmux session / Codex thread this game ever
// created for the given character ids — called when the user ends or
// deletes the game's local archive. Idempotent (safe even for characters
// that were NPCs or never actually got a turn).
export async function cleanupMysteryGame(gameId, charIds) {
  return companionJson('/mystery/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, charIds }),
  })
}
