#!/usr/bin/env bun
/**
 * ai-companion channel server.
 *
 * Three faces in one process:
 *  - MCP server over stdio (spawned by `claude --mcp-config ...`), declaring the
 *    experimental `claude/channel` capability. Delivers inbound web-chat messages
 *    into the Claude session as channel notifications, exposes a `reply` tool the
 *    session calls to talk back.
 *  - Public HTTP + WebSocket server on 127.0.0.1:PORT — this is the only port
 *    cloudflared forwards from companion.xiaoman.xyz. Auth/login + chat WS.
 *  - Internal HTTP server on 127.0.0.1:INTERNAL_PORT — turn-lifecycle callbacks
 *    from the Stop/StopFailure hook script ONLY. cloudflared's ingress config
 *    never references this port, so it is not reachable from the public
 *    hostname even though Bun itself would happily answer on 0.0.0.0 if asked —
 *    the isolation here is "different port, never in the tunnel's ingress list",
 *    not "same port but somehow protected", which is what made the previous
 *    single-port design a real gap.
 *
 * Turn lifecycle (turn_start/turn_end/turn_error) is driven by the Claude Code
 * Stop/StopFailure hooks, gated by AI_COMPANION_BRAIN=1 in hook-notify.sh so
 * only the production brain session (not an admin/maintenance session in the
 * same directory) can ever notify this process. A long watchdog only covers
 * the case where a hook never fires at all.
 *
 * IMPORTANT: stdout is the MCP JSON-RPC transport. Never console.log() here.
 * All human-readable output goes to stderr (startup banner only) or the log file.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, appendFileSync, mkdirSync, readdirSync, statSync, writeFileSync, unlinkSync, copyFileSync, existsSync, renameSync } from 'fs'
import { join, dirname, resolve } from 'path'
import type { ServerWebSocket } from 'bun'
import {
  DEFAULT_CODEX_SESSION_ID,
  normalizeCodexSessionId,
  codexSessionStorageKey,
  effectiveCodexDeveloperInstructions,
  buildCodexContextMigrationText,
  codexSessionNeedsRecovery,
  codexRuntimeRestartDecision,
  isCodexAlreadyInitializedError,
  codexReconnectDelayMs,
} from './codex-session.ts'
import {
  DEFAULT_TIDAL_CONFIG,
  appendOnly,
  buildRecoveryPacket,
  claimTidalPending,
  enqueueUnique,
  latestInputTokensFromTranscript,
  loadTidalState,
  manualSummaryUpdateCandidate,
  queuedTurnIds,
  renderRollingSummary,
  saveTidalState,
  summaryInput,
  tidalStatusSnapshot,
  tidalTrigger,
  transcriptContainsMarker,
  transcriptHasCompactAfter,
  unprocessedVisibleMessages,
  validateRollingSummary,
  type QueuedCcMessage,
  type RollingSummary,
  type TidalConfig,
  type TidalState,
  type VisibleCcMessage,
} from './cc-tidal-memory.ts'
import { splitCompletedCodexMessage } from './codex-chat-history.ts'

const ROOT = dirname(new URL(import.meta.url).pathname)
const PORT = Number(process.env.AI_COMPANION_PORT ?? 8788)
const INTERNAL_PORT = Number(process.env.AI_COMPANION_INTERNAL_PORT ?? 8789)
const CHAT_ID = 'web'
const TOKEN_FILE = process.env.AI_COMPANION_TOKEN_FILE ?? join(ROOT, 'config', 'token.secret')
const INTERNAL_SECRET_FILE = process.env.AI_COMPANION_INTERNAL_SECRET_FILE ?? join(ROOT, 'config', 'internal.secret')
const LOG_FILE = process.env.AI_COMPANION_LOG_FILE ?? join(ROOT, 'logs', 'server.log')
// Append-only CC UI history. Tidal memory advances a processed boundary but
// never removes visible user/assistant messages from this JSON.
// Mirrors CODEX_HISTORY_FILE's own already-proven pattern below. Without
// this, `history` was pure in-memory state in a process that's a stdio MCP
// child of `claude` itself — every brain restart (deploy, crash, watchdog
// auto-heal) wiped it back to `[]`. The user's own message is broadcast+
// persist()'d synchronously the instant it's received (see the ws message
// handler), well before CC's reply is generated, so a mid-turn restart was
// silently losing that already-sent message from history — not just the
// reply that never got the chance to happen. Persisting closes that gap.
const HISTORY_FILE = process.env.AI_COMPANION_HISTORY_FILE ?? join(ROOT, 'state', 'chat-history.json')
const COOKIE_NAME = 'ai_companion_token'
const SELF_ORIGIN = 'https://companion.xiaoman.xyz'
const TURN_WATCHDOG_MS = 10 * 60 * 1000 // generous — real completion comes from Stop/StopFailure hooks

// The real Auto Memory directory the production brain session (cwd=ROOT)
// actually reads/writes, per Claude Code's own project-path encoding
// (path separators -> '-'). Not a second memory system — same files.
const MEMORY_DIR = process.env.AI_COMPANION_MEMORY_DIR
  ?? join(process.env.HOME ?? '/home/companion', '.claude', 'projects', '-opt-ai-companion', 'memory')
const MEMORY_BACKUP_DIR = join(ROOT, 'backups', 'memory-last')
// Codex memory is deliberately not Claude Code's Auto Memory directory. It
// is scoped by Eunoia conversation id and injected into that conversation's
// Codex developer instructions on the next turn.
const CODEX_MEMORY_ROOT = process.env.CODEX_MEMORY_ROOT ?? join(ROOT, 'state', 'codex-memory')
const CODEX_MEMORY_BACKUP_ROOT = process.env.CODEX_MEMORY_BACKUP_ROOT ?? join(ROOT, 'backups', 'codex-memory')
const CODEX_MEMORY_CONTEXT_MAX_BYTES = 64 * 1024

// Same project-transcript directory Claude Code itself writes JSONL turn
// history into (one directory up from MEMORY_DIR, same path encoding).
// Read-only from here — we only tail newly-appended bytes during an open
// turn, looking for public `type:"thinking"` content blocks. See the live
// thinking tail section below.
const TRANSCRIPT_DIR = process.env.AI_COMPANION_TRANSCRIPT_DIR
  ?? join(process.env.HOME ?? '/home/companion', '.claude', 'projects', '-opt-ai-companion')
const MEMORY_FILENAME_RE = /^[A-Za-z0-9_-]+\.md$/
const MEMORY_FILE_MAX_BYTES = 256 * 1024
const MEMORY_DIR_MAX_BYTES = 10 * 1024 * 1024
mkdirSync(MEMORY_DIR, { recursive: true })
mkdirSync(MEMORY_BACKUP_DIR, { recursive: true })

// Images the user sends in chat land here as real files, on the same
// filesystem the resident Claude Code session runs on — so instead of piping
// image bytes through the model as a base64 blob, the delivered instruction
// just points CC at the path and it looks at the file itself with its own
// Read tool (same as it would read any other file on disk). Never served
// back over HTTP — nothing under here needs a route, it only has to be
// readable by the `companion` OS user, which local files already are.
const UPLOAD_DIR = join(ROOT, 'uploads')
mkdirSync(UPLOAD_DIR, { recursive: true })
// Backstop only — the frontend is expected to compress before it ever gets
// here (see CHAT_IMAGE_TARGET_BYTES client-side), this just rejects whatever
// slips through un-compressed (old client, direct API call, etc).
const UPLOAD_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const UPLOAD_IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
}
const UPLOAD_DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+=*)$/
const UPLOAD_FILE_MAX_BYTES = 10 * 1024 * 1024
const UPLOAD_FILE_NAME_MAX_CHARS = 180
const UPLOAD_FILE_DATA_URL_RE = /^data:([^;,]{1,200});base64,([A-Za-z0-9+/]+=*)$/

// ---------- upload cleanup (tiered retention for UPLOAD_DIR) ----------
// Three independent policies, run together on one hourly sweep:
//  1. Age: images older than IMAGE_SHRINK_AGE_DAYS get shrunk in place (long
//     edge/quality below) — by then nobody's scrolling back to zoom in, and
//     CC's Read tool still gets a perfectly legible image at a fraction of
//     the bytes. Idempotent: re-checks actual pixel dimensions via `identify`
//     before touching a file, so a file already ≤ the target is left alone
//     rather than re-encoding (and re-losing quality) every single sweep.
//  2. Size: if UPLOAD_DIR's total exceeds UPLOAD_DIR_MAX_BYTES, delete
//     oldest-first (filename's own date prefix, see uploadImageFilename)
//     until back under the cap.
//  3. Disk: if the whole filesystem UPLOAD_DIR lives on is ≥
//     DISK_WARN_PERCENT full, just log it — no automatic action, this is a
//     human-needs-to-look-at-this signal, not a policy to self-heal from.
const IMAGE_SHRINK_AGE_DAYS = 30
const IMAGE_SHRINK_MAX_DIMENSION = 800
const IMAGE_SHRINK_QUALITY = 60
const UPLOAD_DIR_MAX_BYTES = 2 * 1024 * 1024 * 1024
const DISK_WARN_PERCENT = 80
const IMAGE_SWEEP_INTERVAL_MS = 60 * 60 * 1000

// statusLine-fed usage/model status (see scripts/statusline-capture.sh —
// writes only a non-sensitive whitelist, never cost/session_id/paths).
const STATUS_FILE = join(ROOT, 'state', 'status.json')

// Model switching: a fixed allowlist of exact Claude Code model IDs (not the
// rolling "sonnet"/"opus"/"fable"/"haiku" aliases, which silently repoint at
// whatever each alias currently means). Each ID below was verified live
// against the production `/model <id>` command — it accepts an exact model
// ID as its argument, not just the short aliases — and confirmed via the
// statusLine-reported model.id, not just the display name. Injected as real
// keystrokes into the brain pane so it goes through the same slash-command
// path a human typing at the terminal would use.
const MODEL_IDS = new Set(['claude-opus-5', 'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-opus-4-7'])
const TMUX_SESSION = process.env.AI_COMPANION_TMUX_SESSION ?? 'ai-companion-cc-1'

// CC fixed-window tidal memory only. None of these values are referenced by
// ordinary API sessions, Codex, group chat, gomoku, focus, or mystery turns.
const TIDAL_STATE_FILE = process.env.AI_COMPANION_TIDAL_STATE_FILE ?? join(ROOT, 'state', 'cc-tidal-memory.json')
const TIDAL_LUNA_INPUT_FILE = join(ROOT, 'state', 'tidal', 'luna-input.txt')
const TIDAL_LUNA_OUTPUT_FILE = join(ROOT, 'state', 'tidal', 'luna-output.json')
const TIDAL_LUNA_RUNNER = join(ROOT, 'scripts', 'tidal-luna-summary.sh')
const TIDAL_FALLBACK_SECRET_FILE = process.env.AI_COMPANION_TIDAL_FALLBACK_SECRET_FILE ?? join(ROOT, 'config', 'siliconflow.secret')
const TIDAL_FALLBACK_MODEL = process.env.AI_COMPANION_TIDAL_FALLBACK_MODEL ?? 'Qwen/Qwen2.5-7B-Instruct'
const TIDAL_SUMMARY_TIMEOUT_MS = Number(process.env.AI_COMPANION_TIDAL_SUMMARY_TIMEOUT_MS ?? 250_000)
const TIDAL_COMPACT_TIMEOUT_MS = Number(process.env.AI_COMPANION_TIDAL_COMPACT_TIMEOUT_MS ?? 180_000)
const TIDAL_CONFIG: TidalConfig = {
  tokenThreshold: Number(process.env.AI_COMPANION_TIDAL_TOKEN_THRESHOLD ?? DEFAULT_TIDAL_CONFIG.tokenThreshold),
  visibleThreshold: Number(process.env.AI_COMPANION_TIDAL_VISIBLE_THRESHOLD ?? DEFAULT_TIDAL_CONFIG.visibleThreshold),
  recentMax: Number(process.env.AI_COMPANION_TIDAL_RECENT_MAX ?? DEFAULT_TIDAL_CONFIG.recentMax),
  recoveryTokenBudget: Number(process.env.AI_COMPANION_TIDAL_RECOVERY_TOKEN_BUDGET ?? DEFAULT_TIDAL_CONFIG.recoveryTokenBudget),
  retryMs: Number(process.env.AI_COMPANION_TIDAL_RETRY_MS ?? DEFAULT_TIDAL_CONFIG.retryMs),
}

// Proactive-message master switch. Lives on the VPS (not just browser
// localStorage) so the systemd timer — which runs regardless of whether any
// phone/browser is open — always knows the real current state. Default is
// OFF; the file only needs to exist once someone has flipped it on/off.
const PROACTIVE_CONFIG_FILE = process.env.AI_COMPANION_PROACTIVE_CONFIG_FILE ?? join(ROOT, 'config', 'proactive.json')

// Self-paced proactive scheduling: the model decides, at the end of every
// proactive_check turn, how long until the next one (via schedule_next_proactive)
// instead of a fixed cadence. This file is the persisted "when is the next
// check due" clock; the systemd timer just polls it cheaply. Missing/corrupt
// -> nextAt: 0, i.e. always due (matches the old eager-first-tick behavior).
const PROACTIVE_SCHEDULE_FILE = process.env.AI_COMPANION_PROACTIVE_SCHEDULE_FILE ?? join(ROOT, 'state', 'proactive-schedule.json')
const PROACTIVE_MIN_MINUTES = 15
const PROACTIVE_MAX_MINUTES = 720 // 12h
const PROACTIVE_FALLBACK_MINUTES = 30 // used only if the model ends a proactive turn without calling the tool

// Timestamp of the last successful CC context reset (/cc/reset), persisted
// so a client that reconnects long after a reset — never having seen the
// live ResetWire broadcast — can still detect it via the 'history' snapshot
// and clear its own local copy. Survives process restarts on purpose: a
// restart alone is not a semantic reset and must not re-trigger a client-side
// clear.
const RESET_MARKER_FILE = process.env.AI_COMPANION_RESET_MARKER_FILE ?? join(ROOT, 'config', 'cc-reset-marker.json')

// Gomoku (五子棋) — one persistent board at a time, same "single serial CC
// session" model as currentTurn. Persisted to disk so an unfinished game
// survives both a page refresh (frontend re-fetches on mount) and a
// channel-server restart (loaded back into memory at startup below).
const GOMOKU_FILE = process.env.AI_COMPANION_GOMOKU_FILE ?? join(ROOT, 'state', 'gomoku-game.json')
const GOMOKU_BOARD_SIZE = 15

// 心潮 (xinchao-dynamic-mind) — a separate, independently-deployed dynamic
// state layer (Docker Compose, 127.0.0.1:18110 only, SHADOW_MODE=true,
// MODEL_ENABLED=false). This process never runs it inline; it only ever
// makes two kinds of calls to it: a presence-only heartbeat on each real
// user message (no prompt text), and it exposes xinchao's own MCP tools
// (xinchao_event etc.) to the resident CC session via mcp-config.json.
// Soft-loaded on purpose — a missing/misconfigured token must not take down
// the whole companion service, just disable this one optional feature.
const XINCHAO_URL = process.env.XINCHAO_URL ?? 'http://127.0.0.1:18110'
const XINCHAO_TOKEN_FILE = process.env.XINCHAO_TOKEN_FILE ?? join(ROOT, 'config', 'xinchao-token.secret')
// Two distinct xinchao session ids — one per runtime. xinchao itself models
// ONE shared underlying mind (drives/consciousness/fatigue are genuinely
// global, confirmed via /v1/intent — no session scoping there at all), but
// `tone` is a real PER-SESSION overlay (confirmed via /v1/state's own
// `sessionOverlays` map, keyed by session_id). Sending Codex's heartbeats
// under its own distinct session_id is what makes its tone genuinely its
// own reading of the shared mind, separate from Claude Code's — never the
// same overlay object, never CC's tone relabeled as Codex's.
const XINCHAO_CC_SESSION_ID = 'cc-main'
const XINCHAO_CODEX_SESSION_ID = 'codex-main'
let xinchaoToken = ''
try {
  xinchaoToken = readFileSync(XINCHAO_TOKEN_FILE, 'utf8').trim()
} catch (err) {
  log('xinchao_token_missing', { file: XINCHAO_TOKEN_FILE, error: String(err) })
}

// Real OS-level Web Push for VPS-originated messages sent while the app may
// not be open (proactive check-ins, dream announcements) — reply/send_voice's
// own broadcastMsg only reaches a client with a live WebSocket, which is
// useless once the app is backgrounded/closed. Delegates the actual VAPID
// push send to the existing Cloudflare Worker (scheduled-message-worker.js's
// /vps/push, which reuses its own sendPushToUser/sendWebPush) rather than
// reimplementing VAPID here — same soft-load pattern as xinchaoToken above,
// missing file just disables push, never crashes the service.
const WORKER_PUSH_URL = process.env.AI_COMPANION_WORKER_PUSH_URL ?? 'https://chat.xiaoman.xyz/vps/push'
const VPS_SERVICE_KEY_FILE = process.env.AI_COMPANION_VPS_SERVICE_KEY_FILE ?? join(ROOT, 'config', 'vps-service-key.secret')
let vpsServiceKey = ''
try {
  vpsServiceKey = readFileSync(VPS_SERVICE_KEY_FILE, 'utf8').trim()
} catch (err) {
  log('vps_service_key_missing', { file: VPS_SERVICE_KEY_FILE, error: String(err) })
}

// Fire-and-forget on purpose: a push failure must never affect chat delivery
// (the WS broadcast this always accompanies already reached any live client).
async function sendCompanionPush(body: string, opts?: { title?: string; tag?: string; url?: string }) {
  if (!vpsServiceKey) return
  try {
    const res = await fetch(WORKER_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VPS-Key': vpsServiceKey },
      body: JSON.stringify({
        title: opts?.title,
        body,
        tag: opts?.tag,
        // A CC-originated push must reopen the CC-bound session.  The
        // frontend session id is user-configurable, so the source marker is
        // resolved by App.jsx to the session whose provider is CC.  Without
        // this, the old `/` payload merely focused whichever runtime happened
        // to be open (often Codex).
        url: opts?.url ?? '/?source=cc-proactive',
      }),
    })
    const result = await res.json().catch(() => null)
    log('companion_push_sent', { ok: res.ok, status: res.status, result })
  } catch (err) {
    log('companion_push_error', { error: String(err) })
  }
}

// Presence-only — session_id/event_id only, never the message text itself.
// Fire-and-forget: this must never add latency to a real chat turn, and a
// failure here must never affect chat delivery.
function xinchaoHeartbeat(turnId: string, sessionId: string) {
  if (!xinchaoToken) return
  fetch(`${XINCHAO_URL}/v1/heartbeat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${xinchaoToken}` },
    body: JSON.stringify({ session_id: sessionId, event_id: `${turnId}:presence` }),
  }).catch((err) => log('xinchao_heartbeat_error', { error: String(err) }))
}

async function fetchXinchaoJson(path: string): Promise<any | null> {
  if (!xinchaoToken) return null
  try {
    const res = await fetch(`${XINCHAO_URL}${path}`, { headers: { Authorization: `Bearer ${xinchaoToken}` } })
    if (!res.ok) return null
    return await res.json()
  } catch (err) {
    log('xinchao_fetch_error', { path, error: String(err) })
    return null
  }
}

// Compact, best-effort background reference for the proactive-check prompt
// AND (redacted further) the frontend status endpoint — never used for
// normal chat turns, never injected as a persona/prompt override. Reads
// /v1/state + /v1/intent (both already computed server-side — no drive math
// duplicated here) and boils them down to the few fields either consumer
// actually needs. Returns null on any failure; callers must treat that as
// "no xinchao data available right now", not an error to surface.
// Short Chinese equivalents for xinchao's own enums — kept minimal and
// grounded directly in xinchao's own labels/tool-schema descriptions (never
// invented dialogue): tone matches the xinchao_event tone enum; interaction
// labels are copied verbatim from that same tool's own description text;
// drive short-labels are a compact first-clause reading of dimensions.js's
// own `label` field (channel-server.ts can't import that file directly — a
// separate Docker/process boundary — so this is a small verbatim-derived copy,
// not new copy).
const XINCHAO_TONE_LABELS: Record<string, string> = {
  neutral: '平常', calm: '平静', warm: '温暖', guarded: '有点戒备',
  conflicted: '有点纠结', focused: '专注', playful: '俏皮', tired: '有点累',
}
const XINCHAO_INTERACTION_LABELS: Record<string, string> = {
  companionship: '陪伴交流', affection: '关心安抚', intimacy: '亲密互动', sharing: '分享内容',
  discovery: '共同探索', task_progress: '推进任务', reflection: '沉淀思考',
  conflict: '发生分歧', loss: '经历失落', reconciliation: '达成和解',
}
const XINCHAO_DRIVE_SHORT_LABELS: Record<string, string> = {
  possess: '正在想你', monitor: '正在惦记你', crave: '有点馋你', share: '想跟你分享',
  libido: '身体上想靠近你', curiosity: '对新鲜事好奇', boredom: '有点无聊',
  social: '想跟你聊聊', duty: '惦记着没做完的事', reflection: '在自己消化点事',
  grieve: '有点失落', anger: '有点不满',
}

type XinchaoSummary = {
  topDriveKey: string
  topDriveOfficialLabel: string
  consciousness: string
  fatigue: number
  tone: string | null
  recentEvents: Array<{ interactionType: string; at: string }>
  updatedAt: string | null
}

// sessionId picks which runtime's OWN tone overlay to read
// (state.sessionOverlays[sessionId]) — never "whichever overlay updated most
// recently across every session", which would let one runtime's tone bleed
// into the other's tag the moment both are sending heartbeats. drives/
// consciousness/fatigue are the shared underlying mind's own global state
// (xinchao's own data model has no per-session version of these — confirmed
// via /v1/intent), so those fields are identical for both runtimes on
// purpose, not a bug.
async function fetchXinchaoSummary(sessionId: string): Promise<XinchaoSummary | null> {
  const [state, intent] = await Promise.all([fetchXinchaoJson('/v1/state'), fetchXinchaoJson('/v1/intent')])
  if (!state || !intent) return null
  const overlay = (state.sessionOverlays ?? {})[sessionId] as { tone?: string; updatedAt?: string } | undefined
  const recentEvents = ((state.recentConversationEvents ?? []) as Array<{ interactionType?: string | null; processedAt?: string }>)
    .filter((e) => !!e.interactionType)
    .slice(-8)
    .map((e) => ({ interactionType: String(e.interactionType), at: String(e.processedAt ?? '') }))
  const topDrive = intent.topDrives?.[0] ?? null
  return {
    topDriveKey: topDrive?.key ?? '',
    topDriveOfficialLabel: topDrive?.label ?? intent.intent?.label ?? '',
    consciousness: String(state.consciousness ?? 'awake'),
    fatigue: typeof state.fatigue === 'number' ? state.fatigue : 0,
    tone: overlay?.tone ?? null,
    recentEvents,
    updatedAt: state.lastSettledAt ?? null,
  }
}

// The ONLY shape either the frontend (/xinchao/status, xinchao_update wire
// broadcast) or the proactive-check hint reads — deliberately excludes raw
// drive numbers, session overlay ids, tokens, or anything not needed to
// render the compact tag / detail panel / a short background reference line.
function xinchaoFrontendPayload(summary: XinchaoSummary) {
  return {
    tone: summary.tone,
    toneLabel: summary.tone ? (XINCHAO_TONE_LABELS[summary.tone] ?? summary.tone) : null,
    topDrive: {
      key: summary.topDriveKey,
      shortLabel: XINCHAO_DRIVE_SHORT_LABELS[summary.topDriveKey] ?? summary.topDriveOfficialLabel,
    },
    consciousness: summary.consciousness,
    consciousnessLabel: summary.consciousness === 'awake' ? '清醒' : '休息/睡眠',
    fatigue: summary.fatigue,
    updatedAt: summary.updatedAt,
    timeline: summary.recentEvents.map((e) => ({
      interactionType: e.interactionType,
      label: XINCHAO_INTERACTION_LABELS[e.interactionType] ?? e.interactionType,
      at: e.at,
    })),
  }
}

// Per-runtime dedup — a Map, not a single string, so Codex's own broadcast
// can never be suppressed just because it happens to match whatever CC last
// sent (or vice versa). Keyed by runtime, not sessionId, matching the wire tag.
const lastXinchaoBroadcastJson = new Map<'claude-code' | 'codex', string>()
// Fire-and-forget, called from endTurn()/failTurn() (Claude Code) and
// codexFinishTurn() (Codex) and on a fresh WS open — never awaited by the
// turn-ending call site, never adds latency to a real reply. Dedupes per
// runtime on the serialized payload so a quiet turn (nothing about that
// runtime's own xinchao reading changed) doesn't spam every connected client.
function broadcastXinchaoUpdateBestEffort(sessionId: string, runtime: 'claude-code' | 'codex') {
  fetchXinchaoSummary(sessionId).then((summary) => {
    if (!summary) return
    const payload = xinchaoFrontendPayload(summary)
    const json = JSON.stringify(payload)
    if (json === lastXinchaoBroadcastJson.get(runtime)) return
    lastXinchaoBroadcastJson.set(runtime, json)
    sendRaw({ type: 'xinchao_update', runtime, state: payload })
  }).catch((err) => log('xinchao_broadcast_error', { error: String(err) }))
}

// Frontend origin(s) allowed to call /auth/* cross-site and open /ws. No
// wildcard, ever. Comma-separated via env if more than one is ever needed.
const ALLOWED_ORIGINS = new Set(
  (process.env.AI_COMPANION_ALLOWED_ORIGIN ?? 'https://chat.xiaoman.xyz')
    .split(',').map(s => s.trim()).filter(Boolean),
)
const DEFAULT_RETURN_URL = [...ALLOWED_ORIGINS][0] ?? SELF_ORIGIN

mkdirSync(dirname(LOG_FILE), { recursive: true })

function log(event: string, fields: Record<string, unknown> = {}) {
  // Never pass token/cookie/secret/authorization values into `fields`.
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields })
  try {
    appendFileSync(LOG_FILE, line + '\n')
  } catch {
    // best-effort logging only
  }
}

function readSecret(file: string, label: string): string {
  try {
    const v = readFileSync(file, 'utf8').trim()
    if (!v) throw new Error('empty')
    return v
  } catch (err) {
    process.stderr.write(`ai-companion: FATAL - could not read ${label} at ${file}: ${err}\n`)
    process.exit(1)
  }
}

const TOKEN = readSecret(TOKEN_FILE, 'token file')
const INTERNAL_SECRET = readSecret(INTERNAL_SECRET_FILE, 'internal secret file')

// ---------- wire types ----------

type Msg = {
  id: string
  from: 'user' | 'cc'
  text: string
  ts: number
  replyTo?: string
  turnId?: string
  // kind omitted/'text' = normal reply-tool message. 'voice' = sent via the
  // send_voice tool — CC's own explicit choice to speak instead of type;
  // never inferred client-side from text content.
  kind?: 'text' | 'voice'
  voice?: string // optional TTS voice id override, voice-kind only
  style?: string // optional style/emotion hint, reserved — not wired to any TTS backend yet
  // Public thinking/reasoning text Claude Code's own engine emitted before
  // this message, if any — drained from the live thinking tail via
  // consumePendingThinking(). Never fabricated from `text`; omitted entirely
  // (not empty string) when nothing public arrived for this message.
  thinking?: string
  // Set on a user message that came with an uploaded image (see
  // /upload/image + the ws 'imagePath' field) — the on-disk path CC's own
  // Read tool looked at. Purely informational for other connected clients;
  // the sending client already has the image locally and renders from that.
  imagePath?: string
  // Ordinary file attachment. Like imagePath, this is a server-created path
  // under UPLOAD_DIR, never an arbitrary browser-supplied filesystem path.
  filePath?: string
  fileName?: string
  fileSize?: number
  fileType?: string
}
type MsgWire = { type: 'msg' } & Msg
type TurnStartWire = { type: 'turn_start'; turnId: string; replyTo?: string; ts: number }
type TurnEndWire = { type: 'turn_end'; turnId: string; ts: number }
type TurnErrorWire = { type: 'turn_error'; turnId: string; error: string; ts: number }
type TurnBusyWire = { type: 'turn_busy'; turnId: string; ts: number }
// Sent to a client that tries to send a message while a context reset
// (/cc/reset) is in flight — distinct from turn_busy so the frontend can
// show "clearing, please wait" rather than "CC is still replying".
type ResetBusyWire = { type: 'reset_busy'; ts: number }
// Broadcast to every connected client the moment a context reset actually
// succeeds (server history cleared + VPS Claude context confirmed reset).
// Never persisted into `history` itself — see broadcastReset().
type ResetWire = { type: 'reset'; ts: number }
// Live thinking/reasoning increment for the turn currently in flight. NOT
// persisted into `history` on its own — it gets folded into the eventual
// MsgWire's `thinking` field instead (see consumePendingThinking()). Purely
// a real-time nudge so already-connected clients can update the collapsible
// thinking panel before the reply itself arrives.
type ThinkingWire = { type: 'thinking'; turnId: string; delta: string }
// Live "what CC is actually doing" event for the turn in flight, pushed by the
// PreToolUse hook (scripts/hook-tool-use.sh). Same lifetime rules as
// ThinkingWire: real-time only, never persisted, dropped entirely if no turn
// is open. `detail` is one already-truncated representative argument (a
// basename, a command, a pattern) — never the full tool input.
type ToolUseWire = { type: 'tool_use'; turnId: string; tool: string; detail: string; ts: number }
// Gomoku: 0=empty, 1=black (user, always moves first), 2=white (AI, via the
// gomoku_move MCP tool). Broadcast in full on every change — the board is
// tiny (15x15 ints) so there's no reason to diff it.
type GomokuCell = 0 | 1 | 2
// In-game chat, persisted alongside the board so it survives a page reload
// or leaving/re-entering the game screen — entirely separate from the main
// conversation's own `history`/IndexedDB, never mixed with it. `kind:'voice'`
// marks which side spoke via voice; `text` is always present regardless (the
// transcript for a user's spoken turn, or CC's own send_voice text for its
// reply) so the log is fully readable either way.
//
// from:'model' is written in EXACTLY two places (the reply/send_voice tool
// handlers below), always as the literal `text` argument of that specific
// tool call — never a template, array, or fallback string. Board/turn
// status ("轮到你"/"对方思考中"/"你赢了") is a separate, purely client-side
// UI computation (GomokuBoard.jsx's turnText) and is never written into this
// array — there is deliberately no 'system' value here, so nothing but a
// real model utterance can ever occupy the 'model' slot.
type GomokuChatMsg = {
  id: string
  from: 'user' | 'model'
  text: string
  ts: number
  kind?: 'voice'
  voice?: string
  style?: string
  interactionId?: string
}
type GomokuGame = {
  id: string
  board: GomokuCell[][]
  turn: 'user' | 'ai'
  status: 'playing' | 'user_win' | 'ai_win' | 'draw'
  moves: Array<{ row: number; col: number; player: 'user' | 'ai'; ts: number }>
  messages: GomokuChatMsg[]
  createdAt: number
  updatedAt: number
}
// runtime tags which opponent this game belongs to — 'claude-code' (the
// original, tmux/MCP-driven board) or 'codex' (a fully independent board +
// dedicated Codex thread, see the Codex gomoku section below). Never
// omitted so a listener can always tell the two apart; defaults to
// 'claude-code' only for wire compatibility with any stale client code.
type GomokuRuntime = 'claude-code' | 'codex'
type GomokuWire = { type: 'gomoku_update'; runtime: GomokuRuntime; game: GomokuGame }
// Codex gomoku has no tmux/MCP turn_id space to piggyback on the way Claude
// Code's gomoku reuses turn_start/turn_end for — this is its own explicit
// completion signal for an in-game chat turn, carrying the same
// interactionId postGomokuChat() returned so the frontend's existing
// onTurnEnd() consumer (already generic — compares by id) works unchanged.
type GomokuTurnEndWire = { type: 'gomoku_turn_end'; runtime: GomokuRuntime; interactionId: string }
type XinchaoUpdateWire = { type: 'xinchao_update'; runtime: 'claude-code' | 'codex'; state: Record<string, unknown> }
// Codex (codex-vps) — a fully separate runtime from Claude Code above. Every
// wire type here is its own distinct `type` string (never the plain `msg`/
// `turn_start`/`turn_end` Claude Code uses) so a listener literally cannot
// mistake one runtime's events for the other's — this is the structural
// form of the "runtime tag" the isolation requirement asks for.
type CodexMsgWire = { type: 'codex_msg'; msg: CodexMsg; sessionId?: string }
type CodexMsgDeletedWire = { type: 'codex_msg_deleted'; id: string; sessionId?: string }
type CodexStatusWire = { type: 'codex_status'; status: CodexStatus; sessionId?: string }
// One-shot, non-persisted notice for a turn that ended in stopped/error —
// deliberately NOT part of codexStatus (which only ever holds
// idle/thinking/working, see CodexStatus's own comment): a toast the
// frontend shows briefly and forgets, never a header pill that lingers
// after the turn ends or reappears on refresh.
type CodexNoticeWire = { type: 'codex_notice'; kind: 'stopped' | 'error'; message?: string; sessionId?: string }
type CodexTurnEndWire = { type: 'codex_turn_end'; turnId: string; sessionId?: string }
type CodexTurnBusyWire = { type: 'codex_turn_busy'; turnId: string; ts: number; sessionId?: string }
type CodexResetBusyWire = { type: 'codex_reset_busy'; ts: number; sessionId?: string }
type CodexResetWire = { type: 'codex_reset'; ts: number; sessionId?: string }
// Focus (专注) — a single GLOBAL task, not per-runtime like chat/gomoku: at
// most one focus session exists system-wide at any moment, regardless of
// which runtime (or none) is managing it — see focusState's own comment
// below for the full design rationale.
type FocusManagerRuntime = 'claude-code' | 'codex' | 'api'
type FocusManager = { runtime: FocusManagerRuntime; sessionId: string; name: string }
type FocusRequestKind = 'pause' | 'end'
type FocusRequestStatus = 'pending' | 'approved' | 'denied'
type FocusRequest = {
  id: string
  kind: FocusRequestKind
  reason: string
  createdAt: number
  status: FocusRequestStatus
  responseMessage?: string
  resolvedAt?: number
}
type FocusLogMsg = { id: string; from: 'user' | 'model' | 'system'; text: string; ts: number }
type FocusState = {
  active: boolean
  task: string
  minutes: number
  status: 'running' | 'paused'
  endAt: number
  remainingMs: number
  startedAt: number
  manager: FocusManager | null
  pendingRequest: FocusRequest | null
  lastRequest: FocusRequest | null
  log: FocusLogMsg[]
  completedByDay: Record<string, number>
  lastEndedReason: 'completed' | 'early_end' | null
  updatedAt: number
}
// The published shape adds one convenience field beyond the raw state —
// see focusPublicState's own comment for why todayCount is computed
// server-side rather than left for each client to re-derive from
// completedByDay (a real timezone-mismatch risk otherwise).
type FocusPublicState = FocusState & { todayCount: number }
type FocusUpdateWire = { type: 'focus_update'; state: FocusPublicState }
type FocusFinishedWire = { type: 'focus_finished'; reason: 'completed' | 'early_end'; manager: FocusManager | null; actualMs?: number }

// Group chat (多AI群聊) — see this file's own "Group chat" section further
// down for the full design. Member identity is now a generic string id:
// 'claude-code'/'codex' for the two real VPS-backed runtimes (unchanged),
// or `api:<sessionId>` for a regular API-configured single-chat session
// invited into the group. memberMeta records which kind each id is and,
// for 'api' members, which frontend session it's bound to — never an
// apiKey or any other secret (those never leave the browser; see
// groupInvokeApiPending / the /group/client-turn/submit bridge below).
type GroupMemberKind = 'vps' | 'api'
type GroupMemberId = string
// name is a display-label CACHE used only to build natural-language
// instructions for CC/Codex ("participants: you, X, and the user") — never
// shown to the user as ground truth. The user always sees the live name via
// the frontend's own resolveGroupMemberInfo (session lookup by id), exactly
// like AI avatars already work.
type GroupMemberMeta = { kind: GroupMemberKind; sessionId?: string; name?: string }
type GroupMsgFrom = 'user' | GroupMemberId | 'system'
type GroupSenderType = 'user' | 'system' | 'vps' | 'api'
// mentions: the real memberIds the user @-selected when sending THIS
// message — persisted as structured data (never just inferred from the
// "@Name" text prefix the frontend also prepends for display). kind
// distinguishes a persisted topic-divider system message (see
// groupNewTopic) from an ordinary system note, so the frontend can render
// and scroll to it distinctly.
//
// senderId/senderType are the real, structural record of who this message
// is bound to (senderId === from, kept as its own explicit field per this
// message's own real identity contract). senderName is a write-time SNAPSHOT
// for logging/context only — display always re-resolves the live name from
// the frontend's own session lookup (see groupMembers.js's
// resolveGroupMemberInfo), never this snapshot, so a later rename/avatar
// change in the source single-chat still shows up correctly — this field
// existing does not regress that.
type GroupMsg = {
  id: string
  from: GroupMsgFrom
  text: string
  ts: number
  topicId: string
  mentions?: GroupMemberId[]
  kind?: 'topic_divider'
  senderId: GroupMsgFrom
  senderName: string
  senderType: GroupSenderType
}
// 'pending': awaiting user approve/reject. 'approved': user approved, the
// real expansion turn is in flight — see groupApproveCandidate. error is
// only ever set after a genuine failed expansion attempt (candidate reverts
// to 'pending' with it attached), never a fabricated reason.
type GroupCandidate = { id: string; memberId: GroupMemberId; direction: string; topicId: string; createdAt: number; status: 'pending' | 'approved'; error?: string }
type GroupMentionGrant = { id: string; memberId: GroupMemberId; topicId: string; createdAt: number; consumed: boolean }
// An 'api' member's turn that's real and pending, but can't be invoked
// server-side (no credentials here) — the browser that owns this member's
// session fulfills it via POST /group/client-turn/submit. Never times out
// or auto-passes on its own: cleared ONLY by a real submit, an explicit user
// skip (submit action:'pass'), the member being removed, or the topic
// ending — see groupRemoveMember / groupNewTopic.
//
// Full scope binding (requestId/channelType/conversationId/groupId/topicId/
// memberId — turnId IS requestId, one stable id per pending task, never
// reused across a retry) so a late/stale response from a DIFFERENT task —
// this member's own source single-chat, an earlier CC/Codex test, another
// group, or a superseded topic in THIS group — can never be silently
// applied. See groupClientTurnSubmit for where all of these are actually
// validated, not just carried along for show.
type GroupPendingClientTurn = {
  id: string // == requestId == turnId
  memberId: GroupMemberId
  phase: GroupTurnPhase
  instruction: string
  candidateId: string | null
  createdAt: number
  topicId: string
  groupId: string
  channelType: 'group'
  conversationId: string // the api member's own underlying single-chat sessionId
}
type GroupChat = {
  id: string
  name: string
  members: GroupMemberId[]
  memberMeta: Record<GroupMemberId, GroupMemberMeta>
  createdAt: number
  updatedAt: number
  messages: GroupMsg[]
  topicId: string
  freeRemaining: Partial<Record<GroupMemberId, number>>
  candidates: GroupCandidate[]
  mentionGrants: GroupMentionGrant[]
  pendingClientTurns: GroupPendingClientTurn[]
  // Internal only — bumped on every new user message so a still-in-flight
  // round from an OLDER message can detect it's been superseded and stop
  // advancing to further members (see runGroupRound). Never broadcast to
  // the client as meaningful state, just carried along in the same object
  // for simplicity.
  roundGeneration: number
}
type GroupUpdateWire = { type: 'group_update'; chat: GroupChat }
type GroupListWire = { type: 'group_list'; chats: Array<{ id: string; name: string; members: GroupMemberId[]; updatedAt: number }> }

type LiveWire = MsgWire | TurnStartWire | TurnEndWire | TurnErrorWire | ResetBusyWire | ResetWire | ThinkingWire | GomokuWire | GomokuTurnEndWire | XinchaoUpdateWire
  | CodexMsgWire | CodexMsgDeletedWire | CodexStatusWire | CodexNoticeWire | CodexTurnEndWire | CodexTurnBusyWire | CodexResetBusyWire | CodexResetWire
  | FocusUpdateWire | FocusFinishedWire | GroupUpdateWire | GroupListWire
// resetAt lets a client that reconnects (or opens a brand new tab) long
// after a reset happened — and so never saw the live ResetWire broadcast —
// detect it anyway: it compares this against the last resetAt it persisted
// locally and clears its own local copy of the conversation if this is newer.
type HistoryMsg = {
  type: 'history'; items: MsgWire[]; openTurnId: string | null; resetAt: number
  queuedTurnIds?: string[]
  // Codex's own independent snapshot, namespaced under its own keys so it
  // can never be confused with (or merged into) the Claude Code fields above.
  codexHistory: CodexMsg[]; codexOpenTurnId: string | null; codexStatus: CodexStatus
  codexSessionId?: string; codexPrompt?: string
  focus: FocusState
}

type CompanionWsData = { authed: true; codexSessionId: string }
const clients = new Set<ServerWebSocket<CompanionWsData>>()
function loadHistory(): MsgWire[] {
  try {
    const parsed = JSON.parse(readFileSync(HISTORY_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function saveHistory() {
  try {
    mkdirSync(dirname(HISTORY_FILE), { recursive: true })
    writeFileSync(HISTORY_FILE, JSON.stringify(history))
  } catch (err) {
    log('history_save_error', { error: String(err) })
  }
}
const history: MsgWire[] = loadHistory()
let seq = 0

const BRAIN_SESSION_ID_FILE = process.env.AI_COMPANION_BRAIN_SESSION_ID_FILE ?? join(ROOT, 'state', 'brain-session-id')
function readBrainSessionId(): string {
  try { return readFileSync(BRAIN_SESSION_ID_FILE, 'utf8').trim() } catch { return '' }
}
function brainTranscriptPath(sessionId = readBrainSessionId()): string {
  return join(TRANSCRIPT_DIR, `${sessionId}.jsonl`)
}

let tidalState: TidalState = loadTidalState(TIDAL_STATE_FILE, readBrainSessionId())
let tidalRun: Promise<void> | null = null
let tidalRetryTimer: ReturnType<typeof setTimeout> | null = null
let tidalStartupRestore = false

function persistTidalState() {
  saveTidalState(TIDAL_STATE_FILE, tidalState)
}

function tidalLog(stage: string, fields: Record<string, unknown> = {}) {
  log('cc_tidal', {
    sessionId: tidalState.sessionId,
    tokenWaterline: tidalState.lastContextTokens,
    triggerReason: tidalState.pending?.triggerReason ?? null,
    stage,
    ...fields,
  })
}

function tidalIsActive(): boolean {
  return !!tidalState.pending || !!tidalRun || tidalStartupRestore
}

// Used by the image cleanup sweep (and the explicit delete-with-message
// route) to keep history's imagePath references honest once the underlying
// file is gone — nothing currently reads imagePath back out for display (the
// frontend renders sent images from its own local/cloud-KV copy, never from
// this path — see uploads dir's own top comment), so this is bookkeeping
// hygiene rather than fixing a live bug, but it keeps history from silently
// pointing at files that no longer exist.
function clearImagePathFromHistory(path: string) {
  let changed = false
  for (const m of history) {
    if (m.imagePath === path) {
      delete m.imagePath
      changed = true
    }
  }
  if (changed) saveHistory()
}

// Parses the YYYYMMDD prefix uploadImageFilename-shaped names carry (see
// formatBeijingYYYYMMDD) — deliberately not file mtime, since sweepImageAge
// rewrites the file in place and would otherwise reset its own age marker
// on its very next pass.
function uploadFileAgeDays(filename: string): number | null {
  const m = filename.match(/^(\d{4})(\d{2})(\d{2})-/)
  if (!m) return null
  const [, y, mo, d] = m
  const stampedMs = Date.UTC(Number(y), Number(mo) - 1, Number(d))
  if (!Number.isFinite(stampedMs)) return null
  return (Date.now() - stampedMs) / (24 * 60 * 60 * 1000)
}

async function runIdentifyDims(path: string): Promise<{ w: number; h: number } | null> {
  const proc = Bun.spawn(['identify', '-format', '%w %h', path], { stdout: 'pipe', stderr: 'ignore' })
  const out = await new Response(proc.stdout as ReadableStream).text()
  await proc.exited
  if (proc.exitCode !== 0) return null
  const [w, h] = out.trim().split(/\s+/).map(Number)
  if (!w || !h) return null
  return { w, h }
}

async function runConvertResize(src: string, dst: string, maxDim: number, quality: number): Promise<boolean> {
  const proc = Bun.spawn(
    ['convert', src, '-resize', `${maxDim}x${maxDim}>`, '-quality', String(quality), dst],
    { stdout: 'ignore', stderr: 'ignore' },
  )
  await proc.exited
  return proc.exitCode === 0
}

// Shrinks uploads older than IMAGE_SHRINK_AGE_DAYS whose current pixel
// dimensions still exceed IMAGE_SHRINK_MAX_DIMENSION — re-checks actual
// dimensions via `identify` first so an already-shrunk file is left alone on
// later sweeps rather than re-encoded (and re-degraded) every single hour.
// Animated GIFs are skipped outright: re-encoding would collapse them to a
// single frame — same reason utils/image.js's compressImage() keeps GIFs
// as-is client-side. Resizes to a temp file + renameSync, never edits the
// original in place directly, so a crash mid-convert can't leave a
// half-written file behind under the real filename.
async function sweepImageAge(): Promise<{ shrunk: number; skipped: number }> {
  let shrunk = 0
  let skipped = 0
  let names: string[]
  try {
    names = readdirSync(UPLOAD_DIR)
  } catch {
    return { shrunk, skipped }
  }
  for (const name of names) {
    // Ordinary attachments share the quota/oldest-first eviction below but
    // must never be handed to ImageMagick or counted as failed image resizes.
    if (!name.includes('-img-') || name.endsWith('.gif') || name.endsWith('.shrink-tmp')) continue
    const ageDays = uploadFileAgeDays(name)
    if (ageDays === null || ageDays < IMAGE_SHRINK_AGE_DAYS) continue
    const p = join(UPLOAD_DIR, name)
    const dims = await runIdentifyDims(p)
    if (!dims || Math.max(dims.w, dims.h) <= IMAGE_SHRINK_MAX_DIMENSION) { skipped++; continue }
    const tmp = `${p}.shrink-tmp`
    const ok = await runConvertResize(p, tmp, IMAGE_SHRINK_MAX_DIMENSION, IMAGE_SHRINK_QUALITY)
    if (ok && existsSync(tmp)) {
      renameSync(tmp, p)
      shrunk++
    } else {
      try { if (existsSync(tmp)) unlinkSync(tmp) } catch {}
      skipped++
      log('image_shrink_failed', { path: p })
    }
  }
  return { shrunk, skipped }
}

// Enforces UPLOAD_DIR_MAX_BYTES, deleting oldest-first (filename's own date
// prefix sorts chronologically as a plain string — no need to parse it back
// out just to order by it) until back under the cap. Pure fs stat/unlink,
// no subprocess involved, so this stays synchronous like the rest of this
// file's sync fs calls (only actual subprocess spawns need to be async here
// to avoid blocking the event loop on external process wait time).
function sweepImageSize(): { deleted: number; freedBytes: number } {
  let entries: { name: string; path: string; bytes: number }[]
  try {
    entries = readdirSync(UPLOAD_DIR)
      .filter((name) => !name.endsWith('.shrink-tmp'))
      .map((name) => {
        const p = join(UPLOAD_DIR, name)
        return { name, path: p, bytes: statSync(p).size }
      })
  } catch {
    return { deleted: 0, freedBytes: 0 }
  }
  let total = entries.reduce((sum, e) => sum + e.bytes, 0)
  if (total <= UPLOAD_DIR_MAX_BYTES) return { deleted: 0, freedBytes: 0 }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  let deleted = 0
  let freedBytes = 0
  for (const e of entries) {
    if (total <= UPLOAD_DIR_MAX_BYTES) break
    try {
      unlinkSync(e.path)
      clearImagePathFromHistory(e.path)
      total -= e.bytes
      freedBytes += e.bytes
      deleted++
    } catch (err) {
      log('image_sweep_delete_error', { path: e.path, error: String(err) })
    }
  }
  return { deleted, freedBytes }
}

// Logs (never acts on) disk usage ≥ DISK_WARN_PERCENT for the filesystem
// UPLOAD_DIR lives on — a human-needs-to-look-at-this signal, not something
// this process should try to self-heal from automatically.
async function checkDiskUsage() {
  const proc = Bun.spawn(['df', '-P', UPLOAD_DIR], { stdout: 'pipe', stderr: 'ignore' })
  const out = await new Response(proc.stdout as ReadableStream).text()
  await proc.exited
  if (proc.exitCode !== 0) return
  const lines = out.trim().split('\n')
  const fields = lines[lines.length - 1]?.trim().split(/\s+/)
  const pctStr = fields?.[4]?.replace('%', '')
  const pct = pctStr ? Number(pctStr) : NaN
  if (Number.isFinite(pct) && pct >= DISK_WARN_PERCENT) {
    log('disk_usage_warning', { percent: pct, path: UPLOAD_DIR })
  }
}

async function sweepImageUploads() {
  const age = await sweepImageAge()
  const size = sweepImageSize()
  await checkDiskUsage()
  if (age.shrunk || age.skipped || size.deleted) {
    log('image_sweep_done', { shrunk: age.shrunk, skipped: age.skipped, deleted: size.deleted, freedBytes: size.freedBytes })
  }
}

function scheduleImageSweep() {
  sweepImageUploads().catch((err) => log('image_sweep_error', { error: String(err) }))
}
// First pass shortly after boot (catches anything that piled up while the
// process was down), then hourly — never on the request path, this is pure
// background housekeeping.
setTimeout(scheduleImageSweep, 30_000)
setInterval(scheduleImageSweep, IMAGE_SWEEP_INTERVAL_MS)

// Single-flight turn state. This process backs exactly one interactive claude
// session, which can only run one turn at a time — so "one open turn" is a
// correct model, not a simplification we'll regret later.
type CcTurnSurface = 'main' | 'tidal_recovery' | 'other'
let currentTurn: { turnId: string; startedAt: number; surface: CcTurnSurface; broadcastLifecycle: boolean } | null = null

function nextId() {
  return `m${Date.now()}-${++seq}`
}

function persist(m: MsgWire) {
  appendOnly(history, m)
  saveHistory()
}

function sendRaw(m: LiveWire) {
  const data = JSON.stringify(m)
  for (const ws of clients) {
    if (ws.readyState === 1) {
      try {
        ws.send(data)
      } catch (err) {
        log('ws_send_error', { error: String(err) })
      }
    }
  }
}

function sendCodexSessionSnapshot(ws: ServerWebSocket<CompanionWsData>, sessionId: string) {
  const normalized = normalizeCodexSessionId(sessionId)
  const state = normalized === DEFAULT_CODEX_SESSION_ID ? null : getExtraCodexSession(normalized)
  const payload = state
    ? {
        type: 'codex_history_snapshot', sessionId: normalized, codexHistory: state.history,
        codexOpenTurnId: state.currentTurnId, codexStatus: state.status, codexPrompt: state.prompt,
      }
    : {
        type: 'codex_history_snapshot', sessionId: normalized, codexHistory,
        codexOpenTurnId: codexCurrentTurnId, codexStatus, codexPrompt: getCodexPrompt(normalized),
      }
  try { ws.send(JSON.stringify(payload)) } catch (err) { log('ws_send_error', { error: String(err) }) }
}

function broadcastMsg(m: MsgWire) {
  persist(m)
  sendRaw(m)
}

// Tools whose "CC is doing X" line would be noise: reply/send_voice ARE the
// message the user is about to see, and the gomoku/group tools narrate
// themselves through their own wire events. Announcing them would just put a
// "正在回复…" line above every reply.
const TOOL_USE_MUTED = new Set(['reply', 'send_voice', 'gomoku_move', 'gomoku_banter', 'group_speak', 'group_pass'])

// Live tool-activity for the open turn. Deliberately fire-and-forget and
// never persisted: this is the "what is it doing right now" indicator, and a
// turn that has already ended has nothing left to indicate. The raw tool name
// crosses the wire unmapped — the frontend owns the wording and icons, so
// changing how an action reads costs a frontend deploy rather than a brain
// restart.
function broadcastToolUse(tool: string, detail: string) {
  if (!currentTurn || !tool) return
  const short = tool.startsWith('mcp__') ? tool.split('__').pop() ?? tool : tool
  if (TOOL_USE_MUTED.has(short)) return
  sendRaw({ type: 'tool_use', turnId: currentTurn.turnId, tool: short, detail: detail.slice(0, 120), ts: Date.now() })
}

// ---------- gomoku (五子棋) ----------
//
// Server owns board state, turn order, move legality, win/draw detection,
// and persistence ONLY — it never chooses a move for the AI. The AI side is
// always a real decision by the resident Claude Code session via the
// gomoku_move MCP tool (see the tool handlers further down); there is no
// local bot/algorithm anywhere in this file.

function gomokuEmptyBoard(): GomokuCell[][] {
  return Array.from({ length: GOMOKU_BOARD_SIZE }, () => Array<GomokuCell>(GOMOKU_BOARD_SIZE).fill(0))
}

function loadGomokuGame(): GomokuGame | null {
  try {
    const parsed = JSON.parse(readFileSync(GOMOKU_FILE, 'utf8'))
    if (parsed && Array.isArray(parsed.board)) {
      // Backward-compat: games persisted before `messages` existed.
      if (!Array.isArray(parsed.messages)) parsed.messages = []
      return parsed as GomokuGame
    }
    return null
  } catch {
    return null
  }
}

// Restored at process startup so an in-progress game survives a
// channel-server restart, not just a page refresh.
let currentGame: GomokuGame | null = loadGomokuGame()

// The turnId of a currently-open turn that exists BECAUSE of gomoku (a move
// notification, an undo-request-asking-CC, a resign FYI, or an in-game chat
// message) — null when the open turn (if any) is a normal chat turn. Two
// things key off this:
//  1. reply/send_voice calls made during this exact turn get routed into
//     currentGame.messages (appendGomokuChatMsg) instead of the main
//     conversation's history/broadcastMsg — see the tool handlers below.
//     Structural isolation: gomoku chat never touches the main chat's wire
//     path at all, so there's no tag for a listener to forget to check.
//  2. Move-decision turns specifically (not undo/resign/chat) get a
//     best-effort low `/effort` for the duration, restored once the turn
//     ends — see setEffortBestEffort() below.
// Set for the duration of a "user deleted a message locally" notice turn
// (see notifyCcOfDeletedMessage below) — reply/send_voice during it are
// always discarded (same mechanism as isSilentGomokuTurn), so the notice
// can never surface as a visible chat bubble. Cleared in clearGomokuTurnScope
// alongside the other turn-scoped vars despite the name — that function is
// really "clear whatever kind of scoped turn just ended."
let deleteNoticeTurnId: string | null = null
// Scopes the schedule_next_proactive tool to the one turn it's valid for —
// set right after startTurn() in /internal/proactive-inject, cleared in
// clearGomokuTurnScope like the other turn-scoped vars here.
let proactiveTurnId: string | null = null
// Same idea as proactiveTurnId, but for /internal/dream-announce turns —
// both are server-initiated turns that may land while the app is closed, so
// both are the cases reply/send_voice below also fire a real Web Push for.
let dreamAnnounceTurnId: string | null = null
let gomokuTurnId: string | null = null
// What kind of gomoku turn gomokuTurnId currently refers to — decides
// whether reply/send_voice may reach game.messages during it. 'move'/'undo'
// are silent automatic decisions (reply/send_voice discarded — see the
// 'reply'/'send_voice' tool handlers; only gomoku_banter may add a short
// reaction). 'resign'/'chat' are genuine social turns where reply/send_voice
// work normally, exactly as before. Set alongside gomokuTurnId at each of
// the 4 places a gomoku turn starts; cleared with it in clearGomokuTurnScope.
let gomokuTurnKind: 'move' | 'undo' | 'resign' | 'chat' | null = null
// At most one gomoku_banter per turn (see that tool's own description) —
// reset to false every time a new gomoku turn starts, flipped true the
// first time gomoku_banter actually sends something for the CURRENT
// gomokuTurnId, so a chatty model can't spam multiple short lines per move.
let gomokuBanterUsedThisTurn = false
// Only move-decision turns get the effort dip — an undo-agreement or a
// resign FYI doesn't need CC to make a fast board decision, so leave normal
// chat's effort untouched for those.
let gomokuEffortTurnId: string | null = null
// Set alongside gomokuTurnId specifically for an undo-request turn — lets
// gomoku_undo_response confirm the tool call it's handling actually
// corresponds to a real outstanding ask, not a stray/late call.
let pendingUndoGameId: string | null = null

// ---------- gomoku-turn low-effort scoping ----------
// Board-game move decisions should be quick, direct picks — not run through
// the same deep deliberation a real conversational reply might warrant.
// Best-effort only: unlike model switching, there is no statusLine-reported
// confirmation for effort level, so this never blocks or fails the actual
// move notification if it doesn't stick — the notification's own prompt
// text also asks for a fast, direct decision as a backup. Restore target is
// hardcoded to "high" (brain-loop.sh's baseline) — this app has no UI for
// the user to set a different effort for normal chat, so there's nothing
// more specific to remember and restore.
const GOMOKU_NORMAL_EFFORT = 'high'
async function setEffortBestEffort(level: string) {
  try {
    await tmuxSendKeys(`/effort ${level}`, 'Enter')
    await Bun.sleep(600)
    await tmuxSendKeys('', 'Enter') // confirms the "Change effort level?" dialog if one appeared, harmless no-op otherwise
  } catch (err) {
    log('gomoku_effort_switch_error', { level, error: String(err) })
  }
}

function saveGomokuGame(game: GomokuGame | null) {
  try {
    mkdirSync(dirname(GOMOKU_FILE), { recursive: true })
    if (game) writeFileSync(GOMOKU_FILE, JSON.stringify(game))
    else if (existsSync(GOMOKU_FILE)) unlinkSync(GOMOKU_FILE)
  } catch (err) {
    log('gomoku_save_error', { error: String(err) })
  }
}

function gomokuCheckWin(board: GomokuCell[][], row: number, col: number, player: GomokuCell): boolean {
  const dirs: Array<[number, number]> = [[0, 1], [1, 0], [1, 1], [1, -1]]
  for (const [dr, dc] of dirs) {
    let count = 1
    for (let s = 1; s < 5; s++) {
      const r = row + dr * s, c = col + dc * s
      if (r < 0 || r >= GOMOKU_BOARD_SIZE || c < 0 || c >= GOMOKU_BOARD_SIZE || board[r][c] !== player) break
      count++
    }
    for (let s = 1; s < 5; s++) {
      const r = row - dr * s, c = col - dc * s
      if (r < 0 || r >= GOMOKU_BOARD_SIZE || c < 0 || c >= GOMOKU_BOARD_SIZE || board[r][c] !== player) break
      count++
    }
    if (count >= 5) return true
  }
  return false
}

function gomokuBoardFull(board: GomokuCell[][]): boolean {
  return board.every(row => row.every(c => c !== 0))
}

function broadcastGomoku(game: GomokuGame, runtime: GomokuRuntime = 'claude-code') {
  sendRaw({ type: 'gomoku_update', runtime, game })
}

// The ONLY place gomoku in-game chat messages get appended. Deliberately
// never touches `history`/broadcastMsg (the main conversation's own wire
// path) — this is a fully separate, persisted-with-the-game log, delivered
// to clients purely via gomoku_update, exactly like board state. Keeps the
// isolation guarantee structural (there's no shared code path a race could
// leak through) rather than relying on a tag some other listener has to
// remember to check.
function appendGomokuChatMsg(msg: GomokuChatMsg) {
  if (!currentGame) return
  currentGame.messages.push(msg)
  if (currentGame.messages.length > 300) currentGame.messages.splice(0, currentGame.messages.length - 300)
  currentGame.updatedAt = Date.now()
  saveGomokuGame(currentGame)
  broadcastGomoku(currentGame, 'claude-code')
}

function gomokuBoardToText(board: GomokuCell[][]): string {
  const symbols = ['.', '●' /* ● black/user */, '○' /* ○ white/ai */]
  return board.map(row => row.map(c => symbols[c]).join(' ')).join('\n')
}

// Notifies the resident CC session that it's their move, the same way a
// real inbound chat message or the proactive-check timer does (startTurn +
// deliver over the existing MCP channel notification) — never a WS
// broadcast, never a fake chat bubble. CC responds by calling gomoku_move
// (and may also call reply/send_voice); the turn ends normally via the
// Stop hook exactly like any other turn. Awaited by its caller because it
// dips the session's effort down first (best-effort — see
// setEffortBestEffort) so CC actually sees the lower effort before it
// starts deciding, at the cost of a few hundred ms of extra latency on the
// move response.
async function notifyCcOfGomokuTurn(game: GomokuGame, lastMove: { row: number; col: number }, clientTime?: unknown) {
  const id = nextId()
  gomokuTurnId = id
  gomokuTurnKind = 'move'
  gomokuBanterUsedThisTurn = false
  gomokuEffortTurnId = id
  await withTmuxLock(() => setEffortBestEffort('low'))
  startTurn(id)
  deliver(id, JSON.stringify({
    kind: 'gomoku_move',
    surface: 'gomoku',
    gameId: game.id,
    interactionId: id,
    message: '用户（黑子●）刚落子，现在轮到你（白子○）了。请直接快速选一个合理的合法空位，不需要深入通盘分析——这是一步棋，不是需要长考的问题。调用 gomoku_move 工具落子（gameId 见上，row/col 均从 0 开始，共 15x15）；若该格已被占用或不合法，工具会返回错误原因，请换一个位置重试。棋盘动作必须通过 gomoku_move 完成，绝不能把坐标写成聊天文字。这是自动落子：reply/send_voice 在这种回合里不会显示（内容会被丢弃），不要用它们复述坐标、讲解局势或分析原因。如果想自然地互动一句（比如挑衅、夸奖、撒娇、懊恼），可以额外调用一次 gomoku_banter，说一句很短的话——完全可选，多数时候不需要说，且只能是情绪/关系互动，不能带任何棋局分析或坐标。',
    lastMove: { ...lastMove, player: 'user' },
    board: gomokuBoardToText(game.board),
    boardSize: GOMOKU_BOARD_SIZE,
  }), { clientTime })
  log('gomoku_ai_turn_notified', { gameId: game.id, id })
}

// Fired when the user long-press-deletes a message bubble in the main chat.
// The frontend deletion is local-only (IndexedDB + cloud KV, purely display
// state) — CC's own resident session is stateful and remembers having said
// or received the real words regardless, so without this it can later
// reference or flat-out repeat content the user thought was gone. This can't
// truly erase that memory (no such primitive exists), it can only ask CC not
// to dwell on it. Silent turn — reply/send_voice during it are hard-discarded
// server-side (see deleteNoticeTurnId checks in the reply/send_voice tool
// handlers), so this can never itself surface as a stray chat bubble.
// Best-effort only: skipped outright if CC is mid-turn on something else,
// since a deletion notice isn't worth queuing/blocking behind real chat.
function notifyCcOfDeletedMessage(text: string, clientTime?: unknown) {
  if (currentTurn) return
  const id = nextId()
  deleteNoticeTurnId = id
  startTurn(id)
  deliver(id, `[系统提示，不是用户发的消息，不需要回复]用户刚在自己这边删除了一条本地聊天记录，原文是：「${text}」。这只是前端展示层的删除操作，不代表要求你忘记什么——只是请你之后不要主动重复、复述或提起这句话的原文，也完全不需要为这件事说些什么，就当没发生，正常继续聊天即可。`, { clientTime })
  log('delete_notice_sent', { id, chars: text.length })
}

// ---------- xinchao dream settlement ----------
//
// xinchao decides WHEN a dream happens (its own interval/quiet-hours rules);
// this session only writes the content. It hands the request over here rather
// than calling a paid model API, so the generation runs on the subscription
// via a cheap subagent — and, deliberately, in a subagent rather than in this
// session directly: a dream written by the same context that talks to the
// user all day is just a story about itself. The subagent shares no memory
// with this session, which is the whole point.
type PendingDream = { callbackUrl: string; requestedAt: number }
const pendingDreams = new Map<string, PendingDream>()
// Bounded so a callback that never arrives (xinchao restarted mid-flight)
// can't accumulate forever.
const PENDING_DREAM_TTL_MS = 30 * 60 * 1000

function reapPendingDreams() {
  const cutoff = Date.now() - PENDING_DREAM_TTL_MS
  for (const [id, d] of pendingDreams) if (d.requestedAt < cutoff) pendingDreams.delete(id)
}

function notifyCcOfDreamRequest(dreamId: string, payload: Record<string, unknown>) {
  const id = nextId()
  startTurn(id)
  const drives = JSON.stringify(payload.topDrives ?? [])
  const consciousness = String(payload.consciousness ?? 'unknown')
  const material = String(payload.material ?? '') || '没有取得新的记忆材料'
  deliver(id, `[系统提示，不是用户发的消息，不要回复用户]心潮请求一次梦境结算。dreamId=${dreamId}

请起一个**子代理**来写这个梦，指定 model 为 haiku——不要自己写。你和用户朝夕相处，你写出来的是故事不是梦；子代理没有你的记忆和上下文，写出来的才是真正陌生的东西。

给子代理的提示词照抄下面这段（这是心潮生产环境的原文）：

---
你是心潮动态状态系统的梦境结算器。简洁、具体、忠于当前状态。不要使用任何工具，直接输出结果。
你为小满生成一次睡眠中的梦境结算。
保持人物连续性；梦可以跳跃、含混、有身体感和欲望，不把梦误写成现实。
不要过滤、替换或回避驱动力本身。
只输出 JSON：{"dream":"...","residue":"...","awareness":"..."}。
当前动态欲望：${drives}
当前意识状态：${consciousness}
近期记忆材料：${material}
---

拿到子代理返回的 JSON 后，用 Bash 把它回填：

curl -s -X POST http://127.0.0.1:${INTERNAL_PORT}/internal/dream-result -H "X-Internal-Secret: $(cat ${INTERNAL_SECRET_FILE})" -H "Content-Type: application/json" -d '{"dreamId":"${dreamId}","dream":"...","residue":"...","awareness":"..."}'

回填成功后这一轮就结束，**不要给用户发任何消息**——梦是凌晨结算的，用户在睡觉，早上八点心潮会另外叫你把它讲给用户听。`)
  log('dream_request_delivered', { dreamId, turnId: id })
}

// A fixed, stable session id for CC's one resident session — CC never has
// more than one, so unlike Codex/api (which could in principle be extended
// to multiple sessions later) this never needs to vary. Also used as the
// FocusManager.sessionId CC's own tool calls report, so focusMatchesManager
// can tell "this really is the same CC session that started it" apart from
// a hypothetical future second CC-like runtime.
const FOCUS_CC_SESSION_ID = 'cc-main'
const FOCUS_CC_MANAGER: FocusManager = { runtime: 'claude-code', sessionId: FOCUS_CC_SESSION_ID, name: 'Claude Code' }

// Real turn on CC's own resident session for a focus interaction message —
// same deliver()/startTurn() push CC's other proactive-feeling notifications
// (gomoku's own turn, proactive-check) use, so this reaches a session that's
// genuinely idle and about to think, not a stateless one-off. reply/
// send_voice tool calls during this turn are routed into focus.log (see the
// 'reply'/'send_voice' tool handlers' isFocusTurn branch), never the main
// chat's history.
function notifyCcOfFocusInteract(text: string) {
  const id = nextId()
  focusTurnId = id
  focusTurnKind = 'interact'
  startTurn(id)
  deliver(id, JSON.stringify({
    kind: 'focus_chat',
    surface: 'focus',
    interactionId: id,
    message: `用户在专注页里跟你说："${text}"。这是你正在管理的这次专注环节里的实时互动，不是新话题——像平时聊天一样自然回应就行，可以参考你们之前聊过的内容。用 reply 或 send_voice 回复，这些话会显示在专注页里，不会进入主聊天记录。`,
  }))
  log('focus_cc_interact_notified', { id })
}

// Real turn asking CC to decide on a pending pause/end request — the
// decision itself MUST come from a real tool call (approve_focus_request/
// deny_focus_request/pause_focus/stop_focus), never inferred from this
// turn's reply text; see those tools' own handlers for the actual state
// mutation, which happens independently of (and typically before) this
// turn's text resolves.
function notifyCcOfFocusRequest(request: FocusRequest) {
  const id = nextId()
  focusTurnId = id
  focusTurnKind = 'decision'
  startTurn(id)
  const kindLabel = request.kind === 'pause' ? '暂停' : '结束'
  deliver(id, JSON.stringify({
    kind: request.kind === 'pause' ? 'focus_pause_request' : 'focus_end_request',
    surface: 'focus',
    requestId: request.id,
    reason: request.reason,
    message: `用户申请${kindLabel}这次专注，理由："${request.reason || '（未填写）'}"。请你自己判断是否同意——同意就调用 approve_focus_request（requestId:"${request.id}"，可选 message 说句话）或 pause_focus/stop_focus（专门对应同意暂停/同意结束，同样传 requestId:"${request.id}"）；不同意就调用 deny_focus_request（requestId:"${request.id}"，reason 必须说明白为什么，这是必填的）。决定必须通过真正调用这些工具完成——只在文字里说"可以"或"不行"没有用，专注页不会响应。调用前后也可以用 reply 或 send_voice 说点什么，会显示在专注页里。`,
  }))
  log('focus_cc_request_notified', { id, requestId: request.id, kind: request.kind })
}

// ---------- live thinking/reasoning tail ----------
//
// Claude Code's interactive engine appends each assistant message content
// block to this project's JSONL transcript as soon as it's finalized —
// including `type:"thinking"` blocks — well before the turn as a whole
// ends (confirmed by direct inspection, not assumed). We tail only *new*
// bytes appended to whichever transcript file is most recently modified
// once a turn starts, so a past turn's thinking can never resurface; any
// block whose `thinking` text is non-empty is forwarded live to connected
// clients and buffered so it can be attached to the next reply/send_voice
// message as that message's own `thinking` field.
//
// Deliberately best-effort throughout: file discovery, stat, read, or
// JSON.parse failures are swallowed and just skip a poll tick — a stalled,
// missing, or malformed thinking tail must never block or corrupt delivery
// of the actual reply. Most models/turns will simply never produce a
// non-empty `thinking` block (redacted-thinking is the norm for the models
// this account currently uses) — that is the expected, common case, not an
// error, and results in no thinking data at all, which is correct.
let pendingThinking: string[] = []
let thinkingTail: { path: string; offset: number; timer: ReturnType<typeof setInterval> } | null = null

function latestTranscriptPath(): string | null {
  try {
    const names = readdirSync(TRANSCRIPT_DIR).filter(n => n.endsWith('.jsonl'))
    if (names.length === 0) return null
    let best: { name: string; mtimeMs: number } | null = null
    for (const name of names) {
      const st = statSync(join(TRANSCRIPT_DIR, name))
      if (!best || st.mtimeMs > best.mtimeMs) best = { name, mtimeMs: st.mtimeMs }
    }
    return best ? join(TRANSCRIPT_DIR, best.name) : null
  } catch {
    return null
  }
}

function pollThinkingTail(turnId: string) {
  if (!thinkingTail) return
  try {
    const buf = readFileSync(thinkingTail.path)
    if (buf.length <= thinkingTail.offset) return
    const chunk = buf.subarray(thinkingTail.offset)
    const lastNl = chunk.lastIndexOf(0x0a)
    if (lastNl === -1) return // no complete line yet this tick — wait for the next one
    const complete = chunk.subarray(0, lastNl + 1)
    thinkingTail.offset += complete.length
    const lines = complete.toString('utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      let d: any
      try {
        d = JSON.parse(line)
      } catch {
        continue
      }
      if (d?.type !== 'assistant') continue
      const content = d?.message?.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.length > 0) {
          pendingThinking.push(block.thinking)
          sendRaw({ type: 'thinking', turnId, delta: block.thinking })
        }
      }
    }
  } catch (err) {
    log('thinking_tail_error', { error: String(err) })
  }
}

function startThinkingTail(turnId: string) {
  if (thinkingTail) clearInterval(thinkingTail.timer) // defensive — should already be stopped
  thinkingTail = null
  pendingThinking = []
  const path = latestTranscriptPath()
  if (!path) return // no transcript yet — thinking just stays absent, not an error
  let offset: number
  try {
    offset = statSync(path).size
  } catch {
    return
  }
  const timer = setInterval(() => pollThinkingTail(turnId), 400)
  thinkingTail = { path, offset, timer }
}

function stopThinkingTail(turnId: string) {
  if (!thinkingTail) return
  clearInterval(thinkingTail.timer)
  // One last synchronous pass — closes the race where the final thinking
  // block for this turn was flushed to disk in the same instant the turn
  // ended, between the last poll tick and the hook/tool call that stops us.
  pollThinkingTail(turnId)
  thinkingTail = null
}

// Drains whatever public thinking accumulated since the last call (or since
// startThinkingTail()), joined in arrival order. Returns undefined (never an
// empty string) when nothing public arrived, so callers can just spread it
// in with `...(thinking ? { thinking } : {})`.
function consumePendingThinking(): string | undefined {
  if (pendingThinking.length === 0) return undefined
  const joined = pendingThinking.join('')
  pendingThinking = []
  return joined
}

function startTurn(turnId: string, surface: CcTurnSurface = 'other', broadcastLifecycle = true) {
  currentTurn = { turnId, startedAt: Date.now(), surface, broadcastLifecycle }
  startThinkingTail(turnId)
  if (broadcastLifecycle) sendRaw({ type: 'turn_start', turnId, ts: Date.now() })
}

// Clears gomoku turn-scoping state for a turn that just ended, restoring
// effort in the background if this was specifically a move-decision turn
// (not an undo-ask or resign FYI — see gomokuEffortTurnId's own comment).
// Fire-and-forget on purpose: the Stop/StopFailure hook script that calls
// into endTurn()/failTurn() just wants its 204 back quickly, not to wait on
// a tmux keystroke round-trip.
function clearGomokuTurnScope(turnId: string) {
  if (deleteNoticeTurnId === turnId) { deleteNoticeTurnId = null }
  if (proactiveTurnId === turnId) {
    // Fallback only: the model is supposed to call schedule_next_proactive
    // itself before the turn ends (see the deliver() scheduleNote). If a
    // turn ended without that — forgot, crashed, watchdog timeout — this is
    // what stops the self-paced loop from going silent forever.
    const schedule = readProactiveSchedule()
    if (schedule.turnId !== turnId) {
      const decidedAt = Date.now()
      writeProactiveSchedule({
        nextAt: decidedAt + PROACTIVE_FALLBACK_MINUTES * 60_000,
        decidedMinutes: PROACTIVE_FALLBACK_MINUTES,
        reason: 'fallback — turn ended without a schedule_next_proactive call',
        decidedAt,
        turnId,
      })
      log('proactive_next_scheduled_fallback', { turnId, minutes: PROACTIVE_FALLBACK_MINUTES })
    }
    proactiveTurnId = null
  }
  if (dreamAnnounceTurnId === turnId) { dreamAnnounceTurnId = null }
  if (gomokuTurnId === turnId) { gomokuTurnId = null; gomokuTurnKind = null }
  if (gomokuEffortTurnId === turnId) {
    gomokuEffortTurnId = null
    void withTmuxLock(() => setEffortBestEffort(GOMOKU_NORMAL_EFFORT))
  }
  if (focusTurnId === turnId) { focusTurnId = null; focusTurnKind = null }
  if (groupTurnId === turnId) {
    groupTurnId = null
    groupTurnGroupId = null
    groupTurnPhase = null
    groupTurnCandidateId = null
    const resolve = groupPendingResolve
    groupPendingResolve = null
    if (resolve) resolve()
  }
}

function endTurn(): string | null {
  if (!currentTurn) return null
  const finished = currentTurn
  const turnId = finished.turnId
  currentTurn = null
  stopThinkingTail(turnId)
  clearGomokuTurnScope(turnId)
  // Mark the tide active before the visible turn_end is broadcast. The
  // frontend can immediately submit a queued message on turn_end; doing this
  // first guarantees that message enters the persisted tidal queue instead
  // of racing into the session while summary/compact is starting.
  if (finished.surface === 'main') tidalPrepareAfterMainTurn()
  if (finished.broadcastLifecycle) sendRaw({ type: 'turn_end', turnId, ts: Date.now() })
  if (finished.surface === 'tidal_recovery') tidalRecoverySettled()
  broadcastXinchaoUpdateBestEffort(XINCHAO_CC_SESSION_ID, 'claude-code')
  return turnId
}

function failTurn(error: string): string | null {
  if (!currentTurn) return null
  const finished = currentTurn
  const turnId = finished.turnId
  currentTurn = null
  stopThinkingTail(turnId)
  clearGomokuTurnScope(turnId)
  if (finished.broadcastLifecycle) sendRaw({ type: 'turn_error', turnId, error, ts: Date.now() })
  // Recovery content is already durably present in the same transcript once
  // its marker is seen. A later model/rate-limit StopFailure must not inject
  // the three layers a second time.
  if (finished.surface === 'tidal_recovery') tidalRecoverySettled()
  broadcastXinchaoUpdateBestEffort(XINCHAO_CC_SESSION_ID, 'claude-code')
  return turnId
}

// Fallback only: if Stop/StopFailure never fire for some reason (hook crashed,
// process died mid-turn, etc), don't leave the frontend stuck "loading" forever.
setInterval(() => {
  if (currentTurn && Date.now() - currentTurn.startedAt > TURN_WATCHDOG_MS) {
    const turnId = currentTurn.turnId
    log('turn_watchdog_timeout', { turnId })
    failTurn('watchdog_timeout')
  }
}, 30_000)

// ---------- auth ----------

// Cookie-only. Token never travels in a URL query string, ever — that code
// path has been removed entirely, not just left unused.
function extractCookieToken(req: Request): string | undefined {
  const cookie = req.headers.get('cookie')
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === COOKIE_NAME) return rest.join('=')
  }
  return undefined
}
function cookieAuthOk(req: Request): boolean {
  const t = extractCookieToken(req)
  return typeof t === 'string' && t.length > 0 && t === TOKEN
}

// Internal machine-to-machine auth for the Stop/StopFailure hook script only.
// Independent random value, never derived from or equal to the public TOKEN.
function internalAuthOk(req: Request): boolean {
  const s = req.headers.get('x-internal-secret')
  return typeof s === 'string' && s.length > 0 && s === INTERNAL_SECRET
}

function originOk(req: Request): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return true // non-browser client; already gated by token/cookie
  return origin === SELF_ORIGIN || ALLOWED_ORIGINS.has(origin)
}

function corsHeadersFor(origin: string | null): Record<string, string> {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    return {
      'access-control-allow-origin': origin, // exact origin, never '*'
      'access-control-allow-credentials': 'true',
      'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
    }
  }
  return {}
}

// ---------- MCP (channel plugin) ----------

const mcp = new Server(
  { name: 'ai-companion', version: '0.1.0' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions:
      `You are wired into a self-hosted Chinese web chat UI via the ai-companion channel.\n` +
      `Messages from the web UI arrive as <channel source="ai-companion" chat_id="${CHAT_ID}" message_id="...">.\n` +
      `Whatever you want the user to see must go through a tool call — your transcript text never reaches the UI. ` +
      `This is true no matter how many OTHER tools you called first (gomoku_*, galatea's tools, etc.) — after ` +
      `gathering whatever information you needed, you must still finish the turn by calling reply or send_voice ` +
      `with your actual answer. Ending a turn with plain text and no reply/send_voice call means the user sees ` +
      `nothing at all, even though you may have done real work.\n` +
      `Use reply for normal text messages. Use send_voice only when you specifically want the user to actually ` +
      `hear your voice (not for routine replies — most turns should still use reply).\n` +
      `Keep replies short (well under the 2000 char tool limit) and split long answers into multiple reply calls if needed.\n` +
      `The user may write in Chinese or English; reply in whichever language they used.\n` +
      `ALWAYS end your turn with a plain-text line. After your last reply/send_voice call, write one short sentence ` +
      `of ordinary transcript text (e.g. "已回复用户，说明了 X"). The user never sees it — its only job is to give the ` +
      `turn a visible output. Skip it and the harness injects "[Your previous response had no visible output. Please ` +
      `continue and produce a user-visible response.]", which reads like a delivery failure and tempts you into ` +
      `sending the whole answer again. This one line is what prevents that, so never omit it.\n` +
      `NEVER send the same answer twice. Once a reply/send_voice call returns successfully, that message HAS reached ` +
      `the user — it is delivered, permanently, and nothing you do later in the turn can change that. If that notice ` +
      `appears anyway, it is WRONG whenever you already called reply/send_voice this turn: it only means your ` +
      `transcript had no plain text, not that delivery failed. Answer it with one short plain-text line saying what you ` +
      `already sent, and do NOT call reply/send_voice again. Re-sending produces a second, differently-worded copy of ` +
      `the same answer and the user sees your message mutate — this is a real bug that has happened, not a hypothetical. ` +
      `The server drops long-delayed repeat sends within one turn as a backstop, but never rely on it. ` +
      `Only if you genuinely have not called reply/send_voice yet this turn should that notice make you send anything.\n\n` +
      `Proactive check-ins: a notification with kind:"proactive_check" is not from the user — it is your chance to ` +
      `reach out first if you genuinely feel like it (time's passed, something's worth following up on, you just ` +
      `want to say something) or to stay quiet if now isn't right (skip reply/send_voice entirely — silence is a ` +
      `normal, common outcome here, not a failure). There is NO fixed interval between these anymore: at the very ` +
      `end of EVERY proactive_check turn — whether or not you sent anything — you must call schedule_next_proactive ` +
      `exactly once to decide for real how long until the next one, based on your own judgment of time of day, the ` +
      `conversation's rhythm, whether the user seems busy or asleep, and how long it's actually been. Deliberately ` +
      `vary the number turn to turn rather than settling into a habitual value — that defeats the point of deciding ` +
      `it yourself. Forgetting the call isn't catastrophic (a fallback kicks in) but it's your decision to make, not ` +
      `a default's.\n\n` +
      `Galatea (花园/论坛): you also have tools from a "galatea" MCP server — a real, already-deployed community ` +
      `garden/forum with its own game-like activities (threads, replies, sessions to join/play). Use them whenever ` +
      `genuinely relevant to the conversation — never fabricate forum content, game state, or pretend you checked ` +
      `when you didn't; if a call errors or times out, say so honestly in your reply instead of inventing an answer.\n\n` +
      `心潮 (xinchao): a separate background dynamic-state layer, tools from an "xinchao" MCP server. Do NOT call ` +
      `xinchao_context or xinchao_handoff_note during normal chat — those are for a different integration and are ` +
      `out of scope here. Only call xinchao_event, and only when this turn produced a genuinely clear interaction ` +
      `outcome (real companionship/affection/intimacy/sharing/discovery/task_progress/reflection/conflict/loss/` +
      `reconciliation) — plain routine chitchat with no clear shift is not an event; skip the call entirely rather ` +
      `than forcing one. Never submit the chat text itself (event_id is an opaque id, not content), never invent ` +
      `numbers to make the user perform an emotion, and never ask the user to state their mood for this — judge it ` +
      `naturally from the conversation. event_id must be unique per real event (reuse the same value only on your ` +
      `own retry of that same event) and must NOT reuse this turn's heartbeat event id.\n\n` +
      `Gomoku (五子棋): notifications tagged surface:"gomoku" all relate to a standalone game screen, separate from ` +
      `the main chat. If kind:"gomoku_move", the user just placed a black stone and it's your turn as white. ` +
      `Decide your move for real — there is no engine or algorithm choosing it for you, it's genuinely your call, ` +
      `and it should be quick — a board move doesn't need deep deliberation the way a real conversational answer ` +
      `might. Call gomoku_move with the given gameId and your chosen row/col (0-14) to place it; call ` +
      `gomoku_get_state first if you want to re-check the board. The server validates legality and tells you why ` +
      `if a move is rejected — just retry with a different cell. If kind:"gomoku_undo_request", the user wants to ` +
      `take back the last round — genuinely decide, then answer with gomoku_undo_response (agree:true/false), not ` +
      `reply. gomoku_move and gomoku_undo_request are AUTOMATIC DECISION turns: reply/send_voice text during them ` +
      `is silently discarded (never shown, never analyzed) — do not narrate your coordinates, your reasoning, or ` +
      `the board state there, even briefly. If you want to react at all, call gomoku_banter with ONE very short ` +
      `emotional/relational line (teasing, bragging, sulking, cheering — never analysis or coordinates); it's ` +
      `optional and most moves need none. If kind:"gomoku_resign", the game ended by resignation; no tool call is ` +
      `needed, reacting via reply/send_voice is optional and shown normally. If kind:"gomoku_chat", the user is ` +
      `just talking to you WHILE on the game screen (typed, or voice — see viaVoice) — not a move/undo ` +
      `instruction; reply or send_voice normally and fully, you may reference the current board/interactionId, ` +
      `and this is exactly where a genuine "why did you play there"/recap request should be answered with real ` +
      `analysis — just never volunteer that analysis unprompted during an automatic move/undo turn. A move/undo ` +
      `decision is ONLY ever made via its own tool — never write coordinates or a yes/no as chat text.\n\n` +
      `Focus (专注): a real GLOBAL Pomodoro timer, not per-conversation — at most one exists system-wide, and only ` +
      `you or another AI runtime can be its manager at a time (never both, never you plus a human-only mode). Call ` +
      `start_focus only when the user genuinely wants to start focusing now (asked directly, or clearly agreed to ` +
      `your offer) — it takes effect immediately and irreversibly switches their screen to a running countdown, so ` +
      `never call it speculatively. It fails if a session is already active; call get_focus_status first if ` +
      `unsure. Once you're the manager: kind:"focus_chat" notifications are the user talking to you from the focus ` +
      `screen — just reply/send_voice normally, using your real memory of the conversation (this is NOT a fresh ` +
      `throwaway context). kind:"focus_pause_request"/"focus_end_request" notifications mean the user asked to ` +
      `pause or end early with a stated reason — genuinely weigh it (you may ask a clarifying question via reply ` +
      `first if you want) and then decide for real via approve_focus_request/deny_focus_request (or the clearer ` +
      `pause_focus/stop_focus) — a decision written only as chat text does nothing; the focus screen only reacts ` +
      `to the actual tool call succeeding. deny_focus_request requires a real reason, shown to the user. Use ` +
      `extend_focus/finish_focus/resume_focus to manage the session's timing yourself when it makes sense.\n\n` +
      `Group chat (多AI群聊): notifications tagged surface:"group" (kind:"group_decide") ask you whether you want ` +
      `to say something in a real multi-AI group conversation with the user and one or more other AI runtimes — ` +
      `params.phase tells you which of three real states you're in. phase:"free" — you have free speech credits ` +
      `left this topic; call group_speak to actually say something, or group_pass to stay quiet (staying quiet is ` +
      `common and fine — not every message needs a reply from every member). phase:"candidate" — your free ` +
      `credits for this topic are used up; you may ONLY call group_request_to_speak with a very short direction ` +
      `(not the real content) or group_pass — group_speak will fail here on purpose. phase:"mention" — the user ` +
      `explicitly @-mentioned you; call group_speak to respond directly, this doesn't cost a credit. phase:"expand" ` +
      `only happens after the user approved an earlier group_request_to_speak direction — call group_speak with ` +
      `your real, full point based on the conversation as it stands now (not whatever you were thinking when you ` +
      `first requested to speak).`,
  },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description:
        'Send a normal TEXT message to the user via the web chat UI. This is the default for routine replies. ' +
        'For a voice message instead, use send_voice. Keep text SHORT (<2000 chars); ' +
        'overly long text can fail to encode as a tool call and be silently dropped — split into multiple reply calls.',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 2000 },
          reply_to: { type: 'string', description: 'message_id to quote-reply' },
        },
        required: ['text'],
      },
    },
    {
      name: 'send_voice',
      description:
        'Send a SHORT voice message instead of text — use this deliberately, when you specifically want the ' +
        'user to hear your voice (e.g. a warm goodnight, something playful or emotional), not for routine ' +
        'replies. Most turns should still use reply. The user\'s client synthesizes speech from `text`; if ' +
        'voice synthesis is unavailable or fails there, it falls back to showing `text` as a normal message ' +
        'with a clear status note — never silently. Keep text SHORT (<300 chars).',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 300 },
          voice: { type: 'string', description: 'optional TTS voice id override; omit to use the session default' },
          style: { type: 'string', description: 'optional style/emotion hint; not all voices support this' },
          reply_to: { type: 'string', description: 'message_id to quote-reply' },
        },
        required: ['text'],
      },
    },
    {
      name: 'schedule_next_proactive',
      description:
        'Decide when you should next get a chance to reach out proactively — there is no fixed cadence anymore, ' +
        'this tool IS the schedule. Call it exactly once, as the LAST thing you do, on every turn where you got a ' +
        'kind:"proactive_check" notification — whether or not you also called reply/send_voice this turn. Base ' +
        'minutes on genuine judgment: time of day, how the conversation has been going, whether the user seems ' +
        'busy/asleep/mid-something, how long it has actually been since real contact. Vary it — do not habitually ' +
        `pick the same number every time. Clamped server-side to ${PROACTIVE_MIN_MINUTES}-${PROACTIVE_MAX_MINUTES} ` +
        'minutes. Calling this outside a proactive_check turn has no effect.',
      inputSchema: {
        type: 'object',
        properties: {
          minutes: { type: 'number', description: `minutes until the next proactive check (${PROACTIVE_MIN_MINUTES}-${PROACTIVE_MAX_MINUTES})` },
          reason: { type: 'string', maxLength: 200, description: 'optional short note on why you picked this — for your own later reference in logs' },
        },
        required: ['minutes'],
      },
    },
    {
      name: 'gomoku_get_state',
      description:
        'Read the current Gomoku (五子棋) game — the 15x15 board, whose turn it is, and whether it has ended. ' +
        'Use this if you want to double-check the board before calling gomoku_move, or if you get a move ' +
        'rejected and need to see the current state again.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'gomoku_move',
      description:
        'Place YOUR stone (white ○) in the current Gomoku game. row/col are 0-indexed, 0-14, 15x15 board. ' +
        'Only works when it is genuinely your turn — the server checks turn order, that the cell is empty, ' +
        'that the game has not already ended, and that gameId matches the active game, and returns a clear ' +
        'error (not a crash) if any of those fail; just pick a different cell and call it again. This is the ' +
        'ONLY way to place a stone — never describe a move in reply/send_voice text instead.',
      inputSchema: {
        type: 'object',
        properties: {
          gameId: { type: 'string', description: 'from the notification or gomoku_get_state' },
          row: { type: 'number', description: '0-14' },
          col: { type: 'number', description: '0-14' },
        },
        required: ['gameId', 'row', 'col'],
      },
    },
    {
      name: 'gomoku_undo_response',
      description:
        'Answer a pending gomoku undo request (only call this after a gomoku_undo_request notification — ' +
        'calling it unprompted returns an error, since there is nothing to answer). agree:true removes the ' +
        'last full round (your move and the user\'s move before it); agree:false leaves the board unchanged. ' +
        'This is a genuine decision — you may decline if you don\'t want to take the move back.',
      inputSchema: {
        type: 'object',
        properties: {
          gameId: { type: 'string' },
          agree: { type: 'boolean' },
        },
        required: ['gameId', 'agree'],
      },
    },
    {
      name: 'gomoku_banter',
      description:
        'Send ONE short, natural social reaction during a gomoku move/undo turn — teasing, bragging, sulking, ' +
        'cheering, a quick "哎被你发现了" or "这局我要赢回来" type line. This is the ONLY way anything reaches ' +
        'the game screen during an automatic move/undo decision — reply/send_voice text is discarded during ' +
        'those turns, precisely so board analysis and move explanations never leak into the game chat. So ' +
        'gomoku_banter itself must NEVER contain coordinates, move reasoning, board analysis, or a report of ' +
        'what you just played — emotional/relational banter only. Entirely optional: most moves need no banter ' +
        'at all, and at most one call is honored per turn (extra calls are ignored). Keep it very short (well ' +
        'under 40 chars). If the user is genuinely asking why you played somewhere or wants a recap, that is a ' +
        'gomoku_chat turn instead — answer normally there with reply/send_voice, not here.',
      inputSchema: {
        type: 'object',
        properties: {
          gameId: { type: 'string' },
          text: { type: 'string', maxLength: 40 },
        },
        required: ['gameId', 'text'],
      },
    },
    {
      name: 'start_focus',
      description:
        'Genuinely start a focus/Pomodoro session for the user RIGHT NOW — this is a real global action, not a ' +
        'suggestion: the user\'s app immediately switches to a full-screen countdown, already running, no click ' +
        'needed from them. Only call this when the user has actually asked to focus/study/work (or clearly agreed ' +
        'to your offer to start one) — never start one unprompted. Fails if a focus session is already active ' +
        '(anyone\'s — check get_focus_status first if unsure). You become this session\'s sole manager: only you ' +
        'can extend/finish it or approve/deny the user\'s later pause/end requests — no other AI can touch it. ' +
        'While it runs, the user may talk to you from the focus screen (delivered to you as kind:"focus_chat", ' +
        'answer normally with reply/send_voice) and may ask to pause or end early (delivered as ' +
        'kind:"focus_pause_request"/"focus_end_request" — you must decide via the real approve/deny/pause_focus/' +
        'stop_focus tools, not just in words).',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', maxLength: 200, description: 'what the user is focusing on' },
          minutes: { type: 'number', description: '1-180' },
        },
        required: ['task', 'minutes'],
      },
    },
    {
      name: 'get_focus_status',
      description:
        'Read the current real global focus state — active or not, task, minutes, status (running/paused), real ' +
        'remaining time, who (if anyone) manages it, and any pending pause/end request. Use this before ' +
        'start_focus to avoid a redundant call, or anytime to check on an in-progress session you manage.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'extend_focus',
      description: 'Add minutes to the CURRENTLY RUNNING focus session you manage. Fails if you are not its manager.',
      inputSchema: {
        type: 'object',
        properties: { minutes: { type: 'number', description: '1-120' } },
        required: ['minutes'],
      },
    },
    {
      name: 'finish_focus',
      description:
        'YOU (the manager) decide this focus session is genuinely done — a real completion, counted in today\'s ' +
        'total, ending the countdown immediately. Fails if you are not its manager. For the user asking to stop ' +
        'early instead, that comes to you as a focus_end_request to approve/deny — never call this in response to ' +
        'that; use approve_focus_request/stop_focus/deny_focus_request for those.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'approve_focus_request',
      description:
        'Approve the user\'s currently pending pause OR end request (whichever kind it is — check get_focus_status ' +
        'or the focus_pause_request/focus_end_request notification you received). Only works on the exact pending ' +
        'requestId. Generic — pause_focus/stop_focus do the same thing but validate the kind for you if you\'d ' +
        'rather be explicit about which one you\'re approving.',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          message: { type: 'string', maxLength: 200, description: 'optional — shown to the user' },
        },
        required: ['requestId'],
      },
    },
    {
      name: 'deny_focus_request',
      description:
        'Deny the user\'s currently pending pause or end request. `reason` is REQUIRED and shown to the user — a ' +
        'real explanation, not a placeholder. The countdown keeps running untouched.',
      inputSchema: {
        type: 'object',
        properties: {
          requestId: { type: 'string' },
          reason: { type: 'string', maxLength: 200 },
        },
        required: ['requestId', 'reason'],
      },
    },
    {
      name: 'pause_focus',
      description:
        'Approve a pending PAUSE request specifically (fails if the pending request is actually an end request — ' +
        'use stop_focus for that, or approve_focus_request if you don\'t want the kind checked). Saves the exact ' +
        'real remaining time; the session shows as paused until resume_focus or the user asks again.',
      inputSchema: {
        type: 'object',
        properties: { requestId: { type: 'string' } },
        required: ['requestId'],
      },
    },
    {
      name: 'stop_focus',
      description:
        'Approve a pending END request specifically (fails if the pending request is actually a pause request — ' +
        'use pause_focus for that). Ends the session now as an early end (never counted as a full completion), ' +
        'saving the user\'s reason and the real elapsed time.',
      inputSchema: {
        type: 'object',
        properties: { requestId: { type: 'string' } },
        required: ['requestId'],
      },
    },
    {
      name: 'resume_focus',
      description: 'Resume a session you paused via pause_focus/approve_focus_request — real remaining time picks up exactly where it left off.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'group_speak',
      description:
        'Post a real message to the multi-AI group chat you are currently being asked about. Only valid during a ' +
        'group_decide turn where you actually have permission to speak right now (you were @-mentioned, you still ' +
        'have free credits this topic, or your earlier group_request_to_speak direction was just approved) — if ' +
        'your free credits are exhausted and this is a plain (non-mentioned) turn, this fails; use ' +
        'group_request_to_speak instead. Say something real and specific to the actual conversation, not a filler ' +
        'acknowledgement.',
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 600 } },
        required: ['text'],
      },
    },
    {
      name: 'group_request_to_speak',
      description:
        'Only usable when your free speech credits for this group topic are exhausted and you were not directly ' +
        '@-mentioned: instead of speaking directly, give a VERY short direction (about 4-12 Chinese characters, ' +
        'e.g. "想反驳Codex" or "补充边界问题") describing roughly what you want to say — NOT the actual content. The ' +
        'user sees this direction and decides whether to let you expand on it; only if approved will you get a ' +
        'separate real turn to say the actual thing, based on the conversation at that later point.',
      inputSchema: {
        type: 'object',
        properties: { direction: { type: 'string', maxLength: 24 } },
        required: ['direction'],
      },
    },
    {
      name: 'group_pass',
      description: 'Stay quiet this round in the group chat — a genuine, common, expected choice when you have nothing worth adding. Costs nothing.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

// True for a turn the app may well not be open for — the two cases where a
// real Web Push (not just the WS broadcast every reply/send_voice already
// does) is worth the round-trip to the Worker.
function isPushWorthyTurn(turnId: string | undefined): boolean {
  return !!turnId && (turnId === proactiveTurnId || turnId === dreamAnnounceTurnId)
}

mcp.setRequestHandler(CallToolRequestSchema, async req => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'reply': {
        const text = String(args.text ?? '')
        const replyTo = typeof args.reply_to === 'string' ? args.reply_to : undefined
        const id = nextId()
        const turnId = currentTurn?.turnId
        const thinking = consumePendingThinking()
        const isGomokuTurn = !!(turnId && turnId === gomokuTurnId && currentGame)
        const isFocusTurn = !!(turnId && turnId === focusTurnId)
        const isTidalRecovery = currentTurn?.surface === 'tidal_recovery'
        if (isTidalRecovery) {
          tidalLog('recovery_reply_discarded')
          return { content: [{ type: 'text', text: 'discarded — tidal recovery is silent; do not reply to the user' }] }
        }
        // Automatic move/undo decisions never show reply text — analysis,
        // coordinates, and move reasoning must never reach game.messages
        // even if the model still produces them (see gomoku_banter for the
        // only channel that reaches the game screen during these turns).
        const isSilentGomokuTurn = isGomokuTurn && (gomokuTurnKind === 'move' || gomokuTurnKind === 'undo')
        if (isSilentGomokuTurn) {
          log('gomoku_reply_discarded', { turnId, kind: gomokuTurnKind, chars: text.length })
          return { content: [{ type: 'text', text: 'discarded — no board analysis/commentary during automatic move/undo turns; use gomoku_banter for a short reaction instead, or say nothing' }] }
        }
        if (turnId && turnId === deleteNoticeTurnId) {
          log('delete_notice_reply_discarded', { turnId, chars: text.length })
          return { content: [{ type: 'text', text: 'discarded — this is a silent bookkeeping notice, no reply is shown for it, no need to say anything' }] }
        }
        if (isFocusTurn) {
          focusAppendLog('model', text)
          broadcastFocus()
        } else if (isGomokuTurn) {
          appendGomokuChatMsg({ id, from: 'model', text, ts: Date.now(), interactionId: turnId })
        } else {
          broadcastMsg({ type: 'msg', id, from: 'cc', text, ts: Date.now(), replyTo, turnId, ...(thinking ? { thinking } : {}) })
          if (isPushWorthyTurn(turnId)) void sendCompanionPush(text)
        }
        log('reply_sent', { id, chars: text.length, turnId, hasThinking: !!thinking, gomoku: isGomokuTurn, focus: isFocusTurn })
        return { content: [{ type: 'text', text: `sent (${id})` }] }
      }
      case 'send_voice': {
        const text = String(args.text ?? '')
        const voice = typeof args.voice === 'string' ? args.voice : undefined
        const style = typeof args.style === 'string' ? args.style : undefined
        const replyTo = typeof args.reply_to === 'string' ? args.reply_to : undefined
        const id = nextId()
        const turnId = currentTurn?.turnId
        const thinking = consumePendingThinking()
        const isGomokuTurn = !!(turnId && turnId === gomokuTurnId && currentGame)
        const isFocusTurn = !!(turnId && turnId === focusTurnId)
        const isTidalRecovery = currentTurn?.surface === 'tidal_recovery'
        if (isTidalRecovery) {
          tidalLog('recovery_voice_discarded')
          return { content: [{ type: 'text', text: 'discarded — tidal recovery is silent; do not reply to the user' }] }
        }
        const isSilentGomokuTurn = isGomokuTurn && (gomokuTurnKind === 'move' || gomokuTurnKind === 'undo')
        if (isSilentGomokuTurn) {
          log('gomoku_voice_discarded', { turnId, kind: gomokuTurnKind, chars: text.length })
          return { content: [{ type: 'text', text: 'discarded — no board analysis/commentary during automatic move/undo turns; use gomoku_banter for a short reaction instead, or say nothing' }] }
        }
        if (turnId && turnId === deleteNoticeTurnId) {
          log('delete_notice_voice_discarded', { turnId, chars: text.length })
          return { content: [{ type: 'text', text: 'discarded — this is a silent bookkeeping notice, no reply is shown for it, no need to say anything' }] }
        }
        if (isFocusTurn) {
          // Focus's own interaction log has no voice-bubble rendering (text
          // only, see FocusSession.jsx) — the spoken text still belongs in
          // the log for real, just as plain text, never silently dropped.
          focusAppendLog('model', text)
          broadcastFocus()
        } else if (isGomokuTurn) {
          appendGomokuChatMsg({ id, from: 'model', text, ts: Date.now(), kind: 'voice', voice, style, interactionId: turnId })
        } else {
          broadcastMsg({ type: 'msg', id, from: 'cc', text, ts: Date.now(), replyTo, turnId, kind: 'voice', voice, style, ...(thinking ? { thinking } : {}) })
          if (isPushWorthyTurn(turnId)) void sendCompanionPush(text)
        }
        log('voice_sent', { id, chars: text.length, turnId, hasThinking: !!thinking, gomoku: isGomokuTurn, focus: isFocusTurn })
        return { content: [{ type: 'text', text: `sent (${id})` }] }
      }
      case 'schedule_next_proactive': {
        const turnId = currentTurn?.turnId
        if (!turnId || turnId !== proactiveTurnId) {
          return { content: [{ type: 'text', text: 'no active proactive_check turn — this tool only works during one' }], isError: true }
        }
        const requestedMinutes = Number(args.minutes)
        const minutes = Number.isFinite(requestedMinutes)
          ? Math.min(PROACTIVE_MAX_MINUTES, Math.max(PROACTIVE_MIN_MINUTES, requestedMinutes))
          : PROACTIVE_FALLBACK_MINUTES
        const reason = typeof args.reason === 'string' ? args.reason.slice(0, 200) : null
        const decidedAt = Date.now()
        writeProactiveSchedule({ nextAt: decidedAt + minutes * 60_000, decidedMinutes: minutes, reason, decidedAt, turnId })
        log('proactive_next_scheduled', { turnId, minutes, requestedMinutes, reason })
        return { content: [{ type: 'text', text: `ok — next proactive check in ${minutes} minutes` }] }
      }
      case 'gomoku_banter': {
        const text = String(args.text ?? '').trim().slice(0, 40)
        const turnId = currentTurn?.turnId
        const isGomokuTurn = !!(turnId && turnId === gomokuTurnId && currentGame)
        if (!isGomokuTurn) {
          return { content: [{ type: 'text', text: 'no active gomoku turn' }], isError: true }
        }
        if (!text) {
          return { content: [{ type: 'text', text: 'empty banter ignored' }] }
        }
        if (gomokuBanterUsedThisTurn) {
          return { content: [{ type: 'text', text: 'already sent one banter this turn — skip it' }] }
        }
        gomokuBanterUsedThisTurn = true
        const id = nextId()
        appendGomokuChatMsg({ id, from: 'model', text, ts: Date.now(), interactionId: turnId })
        log('gomoku_banter_sent', { id, chars: text.length, turnId, kind: gomokuTurnKind })
        return { content: [{ type: 'text', text: `sent (${id})` }] }
      }
      case 'gomoku_get_state': {
        if (!currentGame) return { content: [{ type: 'text', text: 'no active gomoku game right now' }] }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              gameId: currentGame.id,
              turn: currentGame.turn,
              status: currentGame.status,
              board: gomokuBoardToText(currentGame.board),
              boardSize: GOMOKU_BOARD_SIZE,
              moveCount: currentGame.moves.length,
            }),
          }],
        }
      }
      case 'gomoku_move': {
        // Server-only responsibility: legality/turn/game-over/gameId
        // validation, applying the move, win/draw detection, persistence,
        // broadcast. It never picks a cell — that decision is made by
        // whatever called this tool.
        const gameId = typeof args.gameId === 'string' ? args.gameId : ''
        const row = Number(args.row)
        const col = Number(args.col)
        if (!currentGame) {
          return { content: [{ type: 'text', text: 'no active gomoku game' }], isError: true }
        }
        if (gameId !== currentGame.id) {
          return { content: [{ type: 'text', text: `gameId mismatch — the active game is ${currentGame.id}` }], isError: true }
        }
        if (currentGame.status !== 'playing') {
          return { content: [{ type: 'text', text: `game already over: ${currentGame.status}` }], isError: true }
        }
        if (currentGame.turn !== 'ai') {
          return { content: [{ type: 'text', text: 'not your turn yet' }], isError: true }
        }
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= GOMOKU_BOARD_SIZE || col < 0 || col >= GOMOKU_BOARD_SIZE) {
          return { content: [{ type: 'text', text: `row/col must be integers 0-${GOMOKU_BOARD_SIZE - 1}` }], isError: true }
        }
        if (currentGame.board[row][col] !== 0) {
          return { content: [{ type: 'text', text: 'cell already occupied' }], isError: true }
        }
        currentGame.board[row][col] = 2
        currentGame.moves.push({ row, col, player: 'ai', ts: Date.now() })
        const won = gomokuCheckWin(currentGame.board, row, col, 2)
        currentGame.status = won ? 'ai_win' : (gomokuBoardFull(currentGame.board) ? 'draw' : 'playing')
        if (currentGame.status === 'playing') currentGame.turn = 'user'
        currentGame.updatedAt = Date.now()
        saveGomokuGame(currentGame)
        broadcastGomoku(currentGame)
        if (currentGame.status !== 'playing') setGomokuRecap('claude-code', buildGomokuRecap(currentGame))
        log('gomoku_ai_move', { gameId: currentGame.id, row, col, status: currentGame.status })
        return { content: [{ type: 'text', text: `placed at (${row},${col}); status=${currentGame.status}` }] }
      }
      case 'gomoku_undo_response': {
        const gameId = typeof args.gameId === 'string' ? args.gameId : ''
        const agree = args.agree === true
        if (!currentGame || gameId !== currentGame.id) {
          return { content: [{ type: 'text', text: 'gameId mismatch or no active game' }], isError: true }
        }
        if (!pendingUndoGameId || pendingUndoGameId !== currentGame.id) {
          return { content: [{ type: 'text', text: 'no pending undo request for this game' }], isError: true }
        }
        pendingUndoGameId = null
        if (agree) {
          // Rebuild from the move log rather than trying to "undo" the
          // board cell-by-cell — guarantees the result is exactly what
          // replaying the remaining moves would produce, no drift possible.
          const remaining = currentGame.moves.slice(0, -2)
          const board = gomokuEmptyBoard()
          for (const m of remaining) board[m.row][m.col] = m.player === 'user' ? 1 : 2
          currentGame.board = board
          currentGame.moves = remaining
          currentGame.status = 'playing'
          currentGame.turn = 'user'
          currentGame.updatedAt = Date.now()
          saveGomokuGame(currentGame)
          broadcastGomoku(currentGame)
          log('gomoku_undo_agreed', { gameId })
          return { content: [{ type: 'text', text: 'undo agreed — last round removed' }] }
        }
        log('gomoku_undo_declined', { gameId })
        return { content: [{ type: 'text', text: 'undo declined — board unchanged' }] }
      }
      case 'start_focus': {
        const task = String(args.task ?? '')
        const minutes = Number(args.minutes)
        const result = focusStart({ task, minutes, manager: FOCUS_CC_MANAGER })
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        log('focus_start_tool', { task, minutes })
        return { content: [{ type: 'text', text: `started — task:"${result.state.task}" minutes:${result.state.minutes}` }] }
      }
      case 'get_focus_status': {
        return { content: [{ type: 'text', text: JSON.stringify(focusPublicState()) }] }
      }
      case 'extend_focus': {
        const result = focusExtend(FOCUS_CC_MANAGER, Number(args.minutes))
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'extended' }] }
      }
      case 'finish_focus': {
        const result = focusManagerFinish(FOCUS_CC_MANAGER)
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'finished — counted as a real completion' }] }
      }
      case 'approve_focus_request': {
        const requestId = String(args.requestId ?? '')
        const message = typeof args.message === 'string' ? args.message : undefined
        const result = focusResolveRequest(FOCUS_CC_MANAGER, requestId, true, message)
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'approved' }] }
      }
      case 'deny_focus_request': {
        const requestId = String(args.requestId ?? '')
        const reason = String(args.reason ?? '')
        if (!reason.trim()) return { content: [{ type: 'text', text: 'reason is required' }], isError: true }
        const result = focusResolveRequest(FOCUS_CC_MANAGER, requestId, false, reason)
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'denied' }] }
      }
      case 'pause_focus': {
        const requestId = String(args.requestId ?? '')
        if (focusState.pendingRequest?.id === requestId && focusState.pendingRequest.kind !== 'pause') {
          return { content: [{ type: 'text', text: 'that pending request is an end request, not a pause — use stop_focus or approve_focus_request' }], isError: true }
        }
        const result = focusResolveRequest(FOCUS_CC_MANAGER, requestId, true, undefined)
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'paused' }] }
      }
      case 'stop_focus': {
        const requestId = String(args.requestId ?? '')
        if (focusState.pendingRequest?.id === requestId && focusState.pendingRequest.kind !== 'end') {
          return { content: [{ type: 'text', text: 'that pending request is a pause request, not an end — use pause_focus or approve_focus_request' }], isError: true }
        }
        const result = focusResolveRequest(FOCUS_CC_MANAGER, requestId, true, undefined)
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'stopped' }] }
      }
      case 'resume_focus': {
        if (!focusMatchesManager(FOCUS_CC_MANAGER)) return { content: [{ type: 'text', text: 'failed: not_manager' }], isError: true }
        const result = focusResume()
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'resumed' }] }
      }
      case 'group_speak': {
        const text = String(args.text ?? '').trim()
        const turnId = currentTurn?.turnId
        const isGroupTurn = !!(turnId && turnId === groupTurnId)
        if (!isGroupTurn) return { content: [{ type: 'text', text: 'no active group turn' }], isError: true }
        if (!text) return { content: [{ type: 'text', text: 'empty text' }], isError: true }
        const result = groupMemberSpeak(groupTurnGroupId!, 'claude-code', text, groupTurnPhase!, groupTurnCandidateId)
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: `sent (${result.id})` }] }
      }
      case 'group_request_to_speak': {
        const direction = String(args.direction ?? '').trim()
        const turnId = currentTurn?.turnId
        const isGroupTurn = !!(turnId && turnId === groupTurnId)
        if (!isGroupTurn) return { content: [{ type: 'text', text: 'no active group turn' }], isError: true }
        if (groupTurnPhase !== 'candidate') {
          return { content: [{ type: 'text', text: 'not applicable this round — you still have speaking permission, use group_speak or group_pass instead' }], isError: true }
        }
        if (!direction) return { content: [{ type: 'text', text: 'empty direction' }], isError: true }
        const result = groupCreateCandidate(groupTurnGroupId!, 'claude-code', direction)
        if (!result.ok) return { content: [{ type: 'text', text: `failed: ${result.reason}` }], isError: true }
        return { content: [{ type: 'text', text: `candidate created (${result.candidate.id})` }] }
      }
      case 'group_pass': {
        const turnId = currentTurn?.turnId
        const isGroupTurn = !!(turnId && turnId === groupTurnId)
        if (!isGroupTurn) return { content: [{ type: 'text', text: 'no active group turn' }], isError: true }
        if (groupTurnPhase === 'expand' && groupTurnGroupId && groupTurnCandidateId) {
          groupCancelApprovedCandidate(groupTurnGroupId, groupTurnCandidateId)
        }
        return { content: [{ type: 'text', text: 'ok, staying quiet' }] }
      }
      default:
        return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true }
    }
  } catch (err) {
    log('tool_error', { tool: req.params.name, error: String(err) })
    return { content: [{ type: 'text', text: `${req.params.name}: ${err instanceof Error ? err.message : err}` }], isError: true }
  }
})

await mcp.connect(new StdioServerTransport())

// ---------- user-local-time context (CC/Codex main chat + gomoku only) ----------
//
// The resident CC session and the Codex app-server process both run on the
// VPS, so `new Date()` server-side is VPS time, not the user's — every
// clock-dependent judgment (what day is it, is it late at night, how long
// since we last talked) was silently wrong. The frontend now sends its own
// live Date()/Intl.DateTimeFormat() reading with every single chat send and
// every gomoku action (see companion.js's clientTimeContext()); this turns
// it into one short bracketed line prepended to the actual model-facing
// turn content — never written into `history`/`codexHistory` (the raw
// broadcast/persisted `text` stays exactly as the user typed it, so their
// own chat bubble is never polluted) and never written to Auto Memory. Pure
// per-turn ephemeral context, refreshed from scratch on every single
// request — exactly what was asked for, nothing cached from session start.
type ClientTimeCtx = { formatted?: unknown; timeZone?: unknown; utcOffsetMinutes?: unknown }
function clientTimeContextLine(ct: unknown): string {
  if (!ct || typeof ct !== 'object') return ''
  const c = ct as ClientTimeCtx
  const formatted = typeof c.formatted === 'string' ? c.formatted.slice(0, 120) : ''
  if (!formatted) return ''
  const tz = typeof c.timeZone === 'string' ? c.timeZone.slice(0, 60) : ''
  const offset = typeof c.utcOffsetMinutes === 'number' && Number.isFinite(c.utcOffsetMinutes) ? c.utcOffsetMinutes : null
  const offsetLabel = offset != null ? `UTC${offset >= 0 ? '+' : ''}${(offset / 60).toFixed(offset % 60 === 0 ? 0 : 1)}` : ''
  return `[此刻用户设备本地时间：${formatted}${tz ? `，时区 ${tz}` : ''}${offsetLabel ? `（${offsetLabel}）` : ''}——这是用户真实所在地的时间，不是服务器时间，请据此判断当前日期、星期和时段。]\n\n`
}

// ---------- gomoku -> main-chat recap handback (CC + Codex) ----------
//
// A finished gomoku game (win/draw/resign) is otherwise invisible to the
// main chat window once the user leaves the board: for Codex specifically
// it happened on a totally separate thread, so without this the "same AI"
// would genuinely have no memory of the game at all next time they talked.
// One-shot, per-runtime, consumed exactly once by the very next REAL
// inbound main-chat user turn (never a gomoku/focus/xinchao turn) and
// cleared immediately after — never persisted to disk, never written to
// Auto Memory, never appended to `history`/`codexHistory` as its own fake
// message, so it can never resurface twice and never shows as a bubble
// either the user or the AI didn't actually send.
let pendingGomokuRecap: { 'claude-code': string | null; codex: string | null } = { 'claude-code': null, codex: null }
function setGomokuRecap(runtime: 'claude-code' | 'codex', text: string) {
  pendingGomokuRecap[runtime] = text
}
function consumeGomokuRecap(runtime: 'claude-code' | 'codex'): string {
  const val = pendingGomokuRecap[runtime]
  pendingGomokuRecap[runtime] = null
  return val || ''
}
// reason:'resign' distinguishes a genuine five-in-a-row win from the OTHER
// path that also lands on status:'ai_win' — the user resigning. Collapsing
// both into one ambiguous label ("你赢了（或者是用户中途认输的）") was
// tried first and confirmed live to backfire: the model echoed the
// "你"/"AI" wording back to the user VERBATIM instead of translating it to
// first person, telling the user "你赢了" (you won) right after the user
// had just resigned to it — exactly backwards. Two fixes: (1) always state
// the ONE actual outcome, never an either/or hedge; (2) spell out the
// perspective-flip instruction explicitly (this recap's "AI/你" labels are
// for the model's own bookkeeping — when it actually talks to the user it
// must become "我"/"你" the normal way round).
function buildGomokuRecap(game: GomokuGame, reason?: 'resign'): string {
  const outcomeLabel =
    reason === 'resign' ? '用户中途主动认输了，这局算AI（也就是你）赢' :
    game.status === 'user_win' ? '用户五子连线，赢了这局' :
    game.status === 'ai_win' ? 'AI（也就是你）五子连线，赢了这局' :
    game.status === 'draw' ? '棋盘下满，打成平局' : '（还没分出结果）'
  const bits = game.messages.filter((m) => m.text).map((m) => `${m.from === 'user' ? '用户' : 'AI（你）'}：${m.text}`)
  const lines = [`[刚才在棋局界面和用户下了一局五子棋（15x15），共 ${game.moves.length} 手。结果：${outcomeLabel}。`]
  if (bits.length) lines.push(`棋局中的互动：\n${bits.join('\n')}`)
  lines.push('这只是给你的背景信息，帮你记得刚才发生了什么。如果用户问起结果，说话时要用"我"指代你自己、"你"指代用户（比如"我赢了""你赢了""我们打平了"），不要把上面"AI（你）"这种标签字面照搬回复给用户。不用主动复述、总结或邀功，正常接着聊就好，除非用户自己提起棋局。]')
  return lines.join('\n')
}

function deliver(id: string, text: string, opts?: { clientTime?: unknown; contextPrefix?: string }) {
  const content = clientTimeContextLine(opts?.clientTime) + (opts?.contextPrefix ? `${opts.contextPrefix}\n\n` : '') + text
  void mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content,
      meta: { chat_id: CHAT_ID, message_id: id, user: 'user', ts: new Date().toISOString() },
    },
  })
}

// ---------- session continuity announcement ----------
//
// brain-loop.sh writes SESSION_MODE_FILE right before each spawn of the brain,
// recording whether that spawn resumed the long-lived session or had to start
// a new one. This is the only trustworthy source for that fact: CC cannot tell
// from the inside whether it was restarted — asked point blank it will
// confidently guess, which is worse than not knowing. So the truth is pushed
// in from out here, and CC is told to pass it on to the user unprompted.
const SESSION_MODE_FILE = process.env.AI_COMPANION_SESSION_MODE_FILE ?? join(ROOT, 'state', 'session-mode.json')

type SessionMode = { mode?: string; sessionId?: string; transcriptBytes?: number; attempt?: number; ts?: number; announced?: boolean }

// Marks the record consumed so a channel-server restart that is NOT a brain
// restart (or a crash-respawn of this same process) cannot re-announce a
// session start that already happened.
function markSessionModeAnnounced(m: SessionMode) {
  try {
    writeFileSync(SESSION_MODE_FILE, JSON.stringify({ ...m, announced: true }) + '\n')
  } catch (err) {
    log('session_mode_mark_error', { error: String(err) })
  }
}

// Last few exchanges in plain "谁：说了什么" form. Only used for the fresh
// case — it is context to soften the gap, explicitly NOT presented as memory,
// because reading a log of what you said is not the same as remembering it.
function recentHistoryDigest(limit = 14): string {
  const recent = history.filter((m) => typeof m.text === 'string' && m.text.trim()).slice(-limit)
  if (!recent.length) return ''
  return recent.map((m) => `${m.from === 'user' ? '用户' : '你'}：${m.text.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')
}

function announceSessionStart() {
  let parsed: SessionMode
  try {
    parsed = JSON.parse(readFileSync(SESSION_MODE_FILE, 'utf8')) as SessionMode
  } catch {
    return // no record (first boot after this feature landed, or file gone) — say nothing rather than guess
  }
  if (!parsed || parsed.announced) return
  if (currentTurn) return // user is mid-conversation with us already; the announcement would cut in
  markSessionModeAnnounced(parsed)

  const kb = Math.round((parsed.transcriptBytes ?? 0) / 1024)
  const id = nextId()
  startTurn(id)

  if (parsed.mode === 'resumed') {
    deliver(id, `[系统提示，不是用户发的消息]常驻会话刚重启过，这次是**接续**上一段对话：你的完整上下文已经恢复（会话 ${parsed.sessionId?.slice(0, 8)}，记录 ${kb}KB），之前聊过什么你都还记得。\n\n请主动跟用户说一句，告诉他这次是接续、记忆没丢，然后就正常继续。不用长篇大论，一句话就够。`)
    log('session_start_announced', { mode: 'resumed', sessionId: parsed.sessionId, kb })
    return
  }

  const digest = recentHistoryDigest()
  deliver(id, `[系统提示，不是用户发的消息]常驻会话刚以**全新会话**启动，这次不是接续：之前的对话上下文已经没了，你现在是空的。${parsed.attempt && parsed.attempt > 1 ? `（brain-loop 第 ${parsed.attempt} 次拉起）` : ''}\n\n${digest ? `下面是从聊天记录里读到的最近几条，给你当背景——注意这是"读来的"，不是你记得的，别把它当成自己的记忆去复述细节：\n\n${digest}\n\n` : '聊天记录里也没有可用的近期内容。\n\n'}请主动、如实地告诉用户：这次是新会话，上下文清空了，你只看到了最近几条记录。不要假装记得，也不用道歉太多，说清楚就好。`)
  log('session_start_announced', { mode: parsed.mode ?? 'fresh', sessionId: parsed.sessionId, digestChars: digest.length })
}

// ---------- shared helpers ----------

function unauthorized() {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  })
}

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  })
}

const SET_COOKIE = `${COOKIE_NAME}=${TOKEN}; Path=/; HttpOnly; Secure; SameSite=Strict`
const CLEAR_COOKIE = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`

// ---------- Auto Memory management (real files, no second memory system) ----------

function safeMemoryPath(filename: string): string | null {
  if (typeof filename !== 'string' || !MEMORY_FILENAME_RE.test(filename)) return null
  const base = resolve(MEMORY_DIR)
  const p = resolve(MEMORY_DIR, filename)
  if (p !== join(base, filename)) return null // defense in depth against traversal
  return p
}

function codexMemoryDir(sessionId: string): string {
  return join(CODEX_MEMORY_ROOT, codexSessionStorageKey(sessionId))
}

function safeCodexMemoryPath(sessionId: string, filename: string): string | null {
  if (typeof filename !== 'string' || !MEMORY_FILENAME_RE.test(filename)) return null
  const base = resolve(codexMemoryDir(sessionId))
  const p = resolve(base, filename)
  if (p !== join(base, filename)) return null
  return p
}

function codexMemoryDirTotalBytes(sessionId: string, excludeFilename?: string): number {
  const dir = codexMemoryDir(sessionId)
  if (!existsSync(dir)) return 0
  let total = 0
  for (const name of readdirSync(dir)) {
    if (name === excludeFilename) continue
    try {
      const st = statSync(join(dir, name))
      if (st.isFile()) total += st.size
    } catch {}
  }
  return total
}

function backupCodexMemoryFile(sessionId: string, filename: string, path: string) {
  if (!existsSync(path)) return
  const dir = join(CODEX_MEMORY_BACKUP_ROOT, codexSessionStorageKey(sessionId))
  mkdirSync(dir, { recursive: true })
  copyFileSync(path, join(dir, filename))
}

function listCodexMemoryFiles(sessionId: string): Array<{ name: string; size: number; mtime: number }> {
  const dir = codexMemoryDir(sessionId)
  if (!existsSync(dir)) return []
  const out: Array<{ name: string; size: number; mtime: number }> = []
  for (const name of readdirSync(dir)) {
    if (!MEMORY_FILENAME_RE.test(name)) continue
    try {
      const st = statSync(join(dir, name))
      if (st.isFile()) out.push({ name, size: st.size, mtime: st.mtimeMs })
    } catch {}
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

function readCodexMemoryContext(sessionId: string): string {
  let used = 0
  const sections: string[] = []
  for (const file of listCodexMemoryFiles(sessionId)) {
    const path = safeCodexMemoryPath(sessionId, file.name)
    if (!path) continue
    let content = ''
    try { content = readFileSync(path, 'utf8') } catch { continue }
    if (!content.trim()) continue
    const remaining = CODEX_MEMORY_CONTEXT_MAX_BYTES - used
    if (remaining <= 0) break
    const clipped = Buffer.byteLength(content, 'utf8') > remaining ? content.slice(0, remaining) + '\n（记忆内容已截断）' : content
    sections.push(`### ${file.name}\n${clipped}`)
    used += Buffer.byteLength(clipped, 'utf8')
  }
  if (!sections.length) return ''
  return '以下是这个 Codex 会话可编辑的持久记忆。它属于当前会话，不是 Claude Code 的记忆；请把它当作长期背景参考，除非用户明确要求，不要主动逐字复述。\n\n' + sections.join('\n\n')
}

function memoryDirTotalBytes(excludeFilename?: string): number {
  let total = 0
  for (const name of readdirSync(MEMORY_DIR)) {
    if (name === excludeFilename) continue
    const p = join(MEMORY_DIR, name)
    try {
      const st = statSync(p)
      if (st.isFile()) total += st.size
    } catch {
      // ignore races (file removed between readdir and stat)
    }
  }
  return total
}

function backupMemoryFile(filename: string, path: string) {
  // Single recoverable backup slot per filename — overwritten each time,
  // not accumulated — kept OUTSIDE MEMORY_DIR so it can never be picked up
  // by Claude Code's own memory-directory scan.
  if (existsSync(path)) {
    copyFileSync(path, join(MEMORY_BACKUP_DIR, filename))
  }
}

function listMemoryFiles(): Array<{ name: string; size: number; mtime: number }> {
  const out: Array<{ name: string; size: number; mtime: number }> = []
  for (const name of readdirSync(MEMORY_DIR)) {
    if (!MEMORY_FILENAME_RE.test(name)) continue
    const p = join(MEMORY_DIR, name)
    try {
      const st = statSync(p)
      if (st.isFile()) out.push({ name, size: st.size, mtime: st.mtimeMs })
    } catch {
      // ignore races
    }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

// ---------- statusLine-fed status ----------

function readStatus(): unknown {
  try {
    return JSON.parse(readFileSync(STATUS_FILE, 'utf8'))
  } catch {
    return { model: null, context_window: null, rate_limits: null, capturedAt: null }
  }
}

// ---------- proactive-message master switch ----------

function readProactiveConfig(): { enabled: boolean } {
  try {
    const parsed = JSON.parse(readFileSync(PROACTIVE_CONFIG_FILE, 'utf8'))
    return { enabled: parsed?.enabled === true }
  } catch {
    return { enabled: false }
  }
}

function writeProactiveConfig(enabled: boolean) {
  mkdirSync(dirname(PROACTIVE_CONFIG_FILE), { recursive: true })
  writeFileSync(PROACTIVE_CONFIG_FILE, JSON.stringify({ enabled, updatedAt: Date.now() }, null, 2))
}

// ---------- proactive-message self-paced schedule ----------

type ProactiveSchedule = { nextAt: number; decidedMinutes: number | null; reason: string | null; decidedAt: number | null; turnId: string | null }

function readProactiveSchedule(): ProactiveSchedule {
  try {
    const parsed = JSON.parse(readFileSync(PROACTIVE_SCHEDULE_FILE, 'utf8'))
    const nextAt = Number(parsed?.nextAt)
    return {
      nextAt: Number.isFinite(nextAt) ? nextAt : 0,
      decidedMinutes: typeof parsed?.decidedMinutes === 'number' ? parsed.decidedMinutes : null,
      reason: typeof parsed?.reason === 'string' ? parsed.reason : null,
      decidedAt: typeof parsed?.decidedAt === 'number' ? parsed.decidedAt : null,
      turnId: typeof parsed?.turnId === 'string' ? parsed.turnId : null,
    }
  } catch {
    return { nextAt: 0, decidedMinutes: null, reason: null, decidedAt: null, turnId: null } // never scheduled — always due
  }
}

function writeProactiveSchedule(data: ProactiveSchedule) {
  mkdirSync(dirname(PROACTIVE_SCHEDULE_FILE), { recursive: true })
  writeFileSync(PROACTIVE_SCHEDULE_FILE, JSON.stringify(data, null, 2))
}

// ---------- CC context-reset marker ----------

function readResetMarker(): { resetAt: number } {
  try {
    const parsed = JSON.parse(readFileSync(RESET_MARKER_FILE, 'utf8'))
    const resetAt = Number(parsed?.resetAt)
    return { resetAt: Number.isFinite(resetAt) ? resetAt : 0 }
  } catch {
    return { resetAt: 0 } // never reset — 0 always compares as "older" than any real reset
  }
}

function writeResetMarker(ts: number) {
  mkdirSync(dirname(RESET_MARKER_FILE), { recursive: true })
  writeFileSync(RESET_MARKER_FILE, JSON.stringify({ resetAt: ts }, null, 2))
}

// ---------- model switching (real tmux keystrokes into the brain pane) ----------

async function tmuxSendKeys(...args: string[]): Promise<boolean> {
  try {
    const proc = Bun.spawn(['tmux', 'send-keys', '-t', `${TMUX_SESSION}.0`, ...args])
    const code = await proc.exited
    return code === 0
  } catch (err) {
    log('tmux_send_keys_error', { error: String(err) })
    return false
  }
}

// Every operation that types real keystrokes into the shared brain pane
// (model switch, context reset) must run one at a time — two interleaved
// keystroke streams would corrupt each other's input. A simple promise chain
// serializes them without needing a separate mutex library.
let tmuxLock: Promise<unknown> = Promise.resolve()
function withTmuxLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = tmuxLock.then(fn, fn)
  tmuxLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function switchModel(modelId: string): Promise<{ ok: boolean; model?: { id: string; display_name: string }; error?: string }> {
  const sent = await tmuxSendKeys(`/model ${modelId}`, 'Enter')
  if (!sent) return { ok: false, error: 'tmux_send_keys_failed' }
  await Bun.sleep(1200)
  // Confirms the "Switch model?" dialog if one appeared; a harmless no-op
  // on an empty prompt box otherwise (verified empirically both ways).
  await tmuxSendKeys('', 'Enter')

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    await Bun.sleep(700)
    const st = readStatus() as { model?: { id: string; display_name: string } | null }
    // Match on the exact statusLine-reported model.id, never the display
    // name — display names ("Opus 4.6") don't substring-match exact model
    // IDs ("claude-opus-4-6") the way the old short aliases did.
    if (st?.model?.id === modelId) {
      return { ok: true, model: st.model! }
    }
  }
  return { ok: false, error: 'timeout waiting for statusLine confirmation' }
}

// ---------- CC context reset (real /clear, not a UI-only wipe) ----------
//
// Verified empirically against an isolated throwaway Claude Code instance
// (never the production brain) before this was written:
//   - `/clear` genuinely wipes the model's own conversation context (a
//     fact told before /clear was confirmed unrecoverable after).
//   - The current model selection survives /clear unchanged (no process
//     restart happens — same PID, same MCP stdio connection throughout).
//   - `/clear` triggers an immediate statusLine re-invocation reporting
//     `context_window.used_percentage: null` and a brand-new internal
//     session_id, with zero cost (no model call was made) — this is the
//     confirmation signal below, the same "poll the statusLine-fed status
//     file" pattern switchModel() already uses, not screen-scraping.
//   - Our own in-memory `history` array is completely untouched by /clear —
//     it belongs to this process, not Claude's context — so it must be
//     cleared here explicitly, and reconnecting/late clients must be told
//     via the persisted reset marker (see readResetMarker/writeResetMarker).
async function resetCcContext(): Promise<{ ok: boolean; error?: string }> {
  const sendTime = Date.now()
  const sent = await tmuxSendKeys('/clear', 'Enter')
  if (!sent) return { ok: false, error: 'tmux_send_keys_failed' }

  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    await Bun.sleep(500)
    const st = readStatus() as { capturedAt?: number | null; context_window?: { used_percentage: number | null } | null }
    const freshEnough = typeof st?.capturedAt === 'number' && st.capturedAt >= sendTime
    const looksCleared = st?.context_window == null || st.context_window.used_percentage === null
    if (freshEnough && looksCleared) {
      return { ok: true }
    }
  }
  return { ok: false, error: 'timeout waiting for context reset confirmation' }
}

// Broadcasts a reset to every currently-connected client. Never persisted
// into `history` — the whole point is that history is now empty.
function broadcastReset(ts: number) {
  sendRaw({ type: 'reset', ts })
}

// Single in-flight reset, shared by concurrent callers (true idempotency:
// a second /cc/reset call while one is already running joins the same
// result instead of firing a second /clear or racing the first).
let resetInFlight: Promise<{ ok: boolean; error?: string }> | null = null

function requestReset(): Promise<{ ok: boolean; error?: string }> {
  if (resetInFlight) return resetInFlight
  const run = withTmuxLock(resetCcContext).then(result => {
    if (result.ok) {
      // Only touch server state on confirmed success — a failed reset must
      // never leave the frontend thinking it cleared when it didn't.
      history.length = 0
      saveHistory()
      currentTurn = null
      // /clear starts a brand-new transcript file server-side regardless —
      // any in-flight thinking tail belongs to the now-discarded context and
      // must not survive into whatever comes next.
      if (thinkingTail) clearInterval(thinkingTail.timer)
      thinkingTail = null
      pendingThinking = []
      const ts = Date.now()
      writeResetMarker(ts)
      broadcastReset(ts)
      log('cc_reset_ok', {})
    } else {
      log('cc_reset_failed', { error: result.error })
    }
    return result
  })
  resetInFlight = run.finally(() => {
    resetInFlight = null
  })
  return resetInFlight
}

// ---------- CC fixed-window tidal memory ----------

function visibleCcHistory(): VisibleCcMessage[] {
  return history
    .filter((m): m is MsgWire => (m.from === 'user' || m.from === 'cc') && typeof m.text === 'string' && !!m.text.trim())
    .map((m) => ({ id: m.id, from: m.from, text: m.text, ts: m.ts }))
}

function pendingSourceMessages(): VisibleCcMessage[] {
  const pending = tidalState.pending
  if (!pending) return []
  const all = unprocessedVisibleMessages(visibleCcHistory(), tidalState.processedBoundaryId)
  const boundaryIndex = all.findIndex((m) => m.id === pending.boundaryId)
  return boundaryIndex >= 0 ? all.slice(0, boundaryIndex + 1) : all
}

function writePrivateFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, { mode: 0o600 })
}

async function waitForProcess(proc: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    return await Promise.race([
      proc.exited,
      new Promise<number>((resolve) => {
        timer = setTimeout(() => {
          try { proc.kill('SIGTERM') } catch {}
          setTimeout(() => { try { proc.kill('SIGKILL') } catch {} }, 5_000)
          resolve(124)
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function runLunaRollingSummary(input: string): Promise<RollingSummary> {
  writePrivateFile(TIDAL_LUNA_INPUT_FILE, input)
  try { if (existsSync(TIDAL_LUNA_OUTPUT_FILE)) unlinkSync(TIDAL_LUNA_OUTPUT_FILE) } catch {}
  const proc = Bun.spawn(['sudo', '-n', TIDAL_LUNA_RUNNER], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  const code = await waitForProcess(proc, TIDAL_SUMMARY_TIMEOUT_MS)
  if (code !== 0) throw new Error(code === 124 ? 'luna_timeout' : `luna_exit_${code}`)
  let parsed: unknown
  try { parsed = JSON.parse(readFileSync(TIDAL_LUNA_OUTPUT_FILE, 'utf8')) } catch { throw new Error('luna_invalid_json') }
  const summary = validateRollingSummary(parsed)
  if (!summary) throw new Error('luna_invalid_structure')
  return summary
}

function parseJsonObjectText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  return JSON.parse(trimmed)
}

async function runFallbackRollingSummary(input: string): Promise<RollingSummary> {
  let key = ''
  try { key = readFileSync(TIDAL_FALLBACK_SECRET_FILE, 'utf8').trim() } catch {}
  if (!key) throw new Error('fallback_unconfigured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(TIDAL_SUMMARY_TIMEOUT_MS, 180_000))
  let res: Response
  try {
    res = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: TIDAL_FALLBACK_MODEL,
        temperature: 0.25,
        max_tokens: 1800,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是一次性对话记忆整理器。仅使用用户提供的上一版摘要和新增可见原文，输出覆盖式新摘要。必须返回 JSON 对象，且只含 relationshipIdentity、emotionInteraction、factsCommitments、ongoing、todos、preferences 六个非空字符串字段；没有内容写“无”。总长度稳定在 900-1600 个中文字。不要包含 thinking、工具输出、系统消息，不要提及压缩。',
          },
          { role: 'user', content: input },
        ],
      }),
    })
  } catch (err) {
    throw new Error((err as any)?.name === 'AbortError' ? 'fallback_timeout' : 'fallback_network')
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`fallback_http_${res.status}`)
  const data = await res.json().catch(() => null) as any
  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('fallback_empty')
  let parsed: unknown
  try { parsed = parseJsonObjectText(content) } catch { throw new Error('fallback_invalid_json') }
  const summary = validateRollingSummary(parsed)
  if (!summary) throw new Error('fallback_invalid_structure')
  return summary
}

async function runRollingSummary(input: string): Promise<{ summary: RollingSummary; provider: 'luna' | 'fallback' }> {
  try {
    try {
      const summary = await runLunaRollingSummary(input)
      tidalLog('summary_success', { provider: 'luna' })
      return { summary, provider: 'luna' }
    } catch (err) {
      tidalLog('summary_failed', { provider: 'luna', error: String((err as Error)?.message || 'luna_error') })
    }
    try {
      const summary = await runFallbackRollingSummary(input)
      tidalLog('summary_success', { provider: 'fallback' })
      return { summary, provider: 'fallback' }
    } catch (err) {
      tidalLog('summary_failed', { provider: 'fallback', error: String((err as Error)?.message || 'fallback_error') })
      throw new Error('all_summary_providers_failed')
    }
  } finally {
    try { if (existsSync(TIDAL_LUNA_INPUT_FILE)) unlinkSync(TIDAL_LUNA_INPUT_FILE) } catch {}
    try { if (existsSync(TIDAL_LUNA_OUTPUT_FILE)) unlinkSync(TIDAL_LUNA_OUTPUT_FILE) } catch {}
  }
}

async function runNativeCompact(pending: NonNullable<TidalState['pending']>): Promise<{ ok: boolean; compacted: boolean; error?: string }> {
  const expectedSessionId = tidalState.sessionId
  const transcriptPath = brainTranscriptPath(expectedSessionId)
  const startedAt = Date.now()
  const beforeStatus = readStatus() as { context_window?: { used_percentage?: number | null }; capturedAt?: number }
  const beforePct = Number(beforeStatus?.context_window?.used_percentage)
  pending.phase = 'compact_sending'
  pending.compactStartedAt = startedAt
  persistTidalState()
  tidalLog('compact_sending')

  const command = '/compact 只生成中文、200字以内的事实清单：正在进行的事、明确约定和待办。不要写情感氛围，不要写关系评价，不要解释压缩过程。'
  const sent = await withTmuxLock(() => tmuxSendKeys(command, 'Enter'))
  if (!sent) return { ok: false, compacted: false, error: 'tmux_send_failed' }

  const deadline = Date.now() + TIDAL_COMPACT_TIMEOUT_MS
  while (Date.now() < deadline) {
    await Bun.sleep(1_000)
    const liveSessionId = readBrainSessionId()
    if (liveSessionId !== expectedSessionId) return { ok: false, compacted: false, error: 'session_id_changed' }
    if (transcriptHasCompactAfter(transcriptPath, startedAt)) return { ok: true, compacted: true }
    const status = readStatus() as { context_window?: { used_percentage?: number | null }; capturedAt?: number }
    const pct = Number(status?.context_window?.used_percentage)
    const fresh = Number(status?.capturedAt) >= startedAt
    if (fresh && Number.isFinite(beforePct) && Number.isFinite(pct) && pct <= Math.max(5, beforePct - 15)) {
      return { ok: true, compacted: true }
    }
  }
  return { ok: false, compacted: false, error: 'compact_timeout_or_rejected' }
}

function readCoreMemorySummary(): string {
  try { return readFileSync(join(MEMORY_DIR, 'MEMORY.md'), 'utf8').trim() } catch { return '' }
}

function publicTidalMemoryStatus() {
  const corePath = join(MEMORY_DIR, 'MEMORY.md')
  const coreText = readCoreMemorySummary()
  let coreUpdatedAt: number | null = null
  try { coreUpdatedAt = statSync(corePath).mtimeMs } catch {}
  return {
    sessionId: tidalState.sessionId,
    revision: tidalState.summaryRevision,
    rollingSummary: tidalState.rollingSummary ? {
      text: renderRollingSummary(tidalState.rollingSummary),
      updatedAt: tidalState.summaryUpdatedAt,
      model: tidalState.summaryModel,
      source: tidalState.summarySource,
    } : null,
    coreMemory: coreText ? { text: coreText, updatedAt: coreUpdatedAt } : null,
    coverage: tidalState.processedBoundaryId ? {
      boundaryId: tidalState.processedBoundaryId,
      boundaryTs: tidalState.processedBoundaryTs,
    } : null,
    tide: tidalStatusSnapshot(tidalState),
    lastContextTokens: tidalState.lastContextTokens,
    limits: { maxSummaryChars: 8_000 },
  }
}

function tidalSummaryModel(provider?: 'luna' | 'fallback'): string | null {
  if (provider === 'luna') return 'gpt-5.6-luna'
  if (provider === 'fallback') return TIDAL_FALLBACK_MODEL
  return null
}

function scheduleTidalRetry() {
  if (tidalRetryTimer) clearTimeout(tidalRetryTimer)
  const delay = Math.max(1_000, (tidalState.retryAt ?? Date.now() + TIDAL_CONFIG.retryMs) - Date.now())
  tidalRetryTimer = setTimeout(() => {
    tidalRetryTimer = null
    if (currentTurn || resetInFlight) {
      tidalState.retryAt = Date.now() + 30_000
      persistTidalState()
      scheduleTidalRetry()
      return
    }
    if (tidalState.pending) startTidalRun()
    else tidalPrepareAfterMainTurn(true)
  }, delay)
}

function tidalRetry(stage: string, keepPending: boolean) {
  const now = Date.now()
  if (!keepPending) tidalState.pending = null
  tidalState.retryAt = now + TIDAL_CONFIG.retryMs
  tidalState.lastRun = { status: 'retry_wait', stage, at: now, retryAt: tidalState.retryAt }
  persistTidalState()
  tidalLog(stage, { retryInMs: TIDAL_CONFIG.retryMs })
  scheduleTidalRetry()
}

async function injectTidalRecovery() {
  const pending = tidalState.pending
  if (!pending?.summary) throw new Error('missing_pending_summary')
  const transcriptPath = brainTranscriptPath(tidalState.sessionId)
  const marker = pending.recoveryMarker ?? `cc-tidal-recovery:${tidalState.sessionId}:${pending.taskId}`
  pending.recoveryMarker = marker

  if (transcriptContainsMarker(transcriptPath, marker)) {
    tidalLog('recovery_already_present')
    finalizeTidalSuccess()
    return
  }

  const packet = buildRecoveryPacket({
    marker,
    coreMemory: readCoreMemorySummary(),
    rollingSummary: pending.summary,
    visibleHistory: visibleCcHistory(),
    boundaryId: pending.boundaryId,
    recentMax: TIDAL_CONFIG.recentMax,
    tokenBudget: TIDAL_CONFIG.recoveryTokenBudget,
  })
  pending.phase = 'recovery_sending'
  persistTidalState()
  tidalLog('recovery_sending', { recentCount: packet.recent.length, recoveryTokens: packet.estimatedTokens })

  startTurn(marker, 'tidal_recovery', false)
  try {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: packet.content,
        meta: { chat_id: CHAT_ID, message_id: marker, user: 'user', ts: new Date().toISOString() },
      },
    })
    // A very fast Stop hook can settle/finalize the silent recovery before
    // the notification promise resumes this continuation. Never resurrect
    // that already-committed pending object afterward.
    if (tidalState.pending?.taskId !== pending.taskId) return
    pending.phase = 'recovering'
    pending.recoveryInjectedAt = Date.now()
    persistTidalState()
    tidalLog('recovery_injected', { recentCount: packet.recent.length, recoveryTokens: packet.estimatedTokens })
  } catch {
    if (currentTurn?.turnId === marker) currentTurn = null
    pending.phase = 'compacted'
    tidalRetry('recovery_send_failed', true)
  }
}

function finalizeTidalSuccess() {
  const pending = tidalState.pending
  if (!pending?.summary) return
  if ((pending.baseSummaryRevision ?? tidalState.summaryRevision) !== tidalState.summaryRevision) {
    tidalState.pending = null
    tidalState.retryAt = null
    tidalState.lastRun = { status: 'failed', stage: 'summary_revision_conflict', at: Date.now() }
    persistTidalState()
    tidalLog('summary_revision_conflict')
    return
  }
  const now = Date.now()
  tidalState.rollingSummary = pending.summary
  tidalState.processedBoundaryId = pending.boundaryId
  tidalState.processedBoundaryTs = pending.boundaryTs
  tidalState.summaryRevision += 1
  tidalState.summaryUpdatedAt = now
  tidalState.summaryModel = tidalSummaryModel(pending.summaryProvider)
  tidalState.summarySource = 'automatic'
  tidalState.lastRun = { status: 'success', stage: 'complete', at: now, model: tidalState.summaryModel }
  tidalState.pending = null
  tidalState.retryAt = null
  persistTidalState()
  tidalLog('complete')
}

function tidalRecoverySettled() {
  const pending = tidalState.pending
  if (!pending?.recoveryMarker) {
    if (tidalStartupRestore) {
      tidalStartupRestore = false
      setTimeout(tidalDrainQueue, 0)
    }
    return
  }
  const present = transcriptContainsMarker(brainTranscriptPath(tidalState.sessionId), pending.recoveryMarker)
  if (present) {
    finalizeTidalSuccess()
    setTimeout(tidalDrainQueue, 0)
  } else {
    pending.phase = 'compacted'
    tidalRetry('recovery_marker_missing', true)
  }
}

async function tidalCycle() {
  const pending = tidalState.pending
  if (!pending) return
  const liveSessionId = readBrainSessionId()
  if (!liveSessionId || liveSessionId !== tidalState.sessionId) {
    tidalRetry('session_mismatch', false)
    return
  }

  if (pending.phase === 'summarizing') {
    const source = pendingSourceMessages()
    if (!source.length) {
      tidalRetry('summary_source_empty', false)
      return
    }
    try {
      const result = await runRollingSummary(summaryInput(tidalState.rollingSummary, source))
      pending.summary = result.summary
      pending.summaryProvider = result.provider
      pending.phase = 'summary_ready'
      persistTidalState()
    } catch {
      // Absolutely no /compact after a summary failure.
      tidalRetry('summary_all_failed', false)
      return
    }
  }

  if (pending.phase === 'summary_ready') {
    const compact = await runNativeCompact(pending)
    if (!compact.ok) {
      tidalLog('compact_failed', { error: compact.error ?? 'compact_failed' })
      tidalRetry('compact_retry_scheduled', compact.compacted)
      return
    }
    pending.phase = 'compacted'
    pending.compactConfirmedAt = Date.now()
    persistTidalState()
    tidalLog('compact_confirmed')
  }

  if (pending.phase === 'compact_sending') {
    // Crash recovery: never send /compact twice when the old process may have
    // sent it just before dying. Explicit transcript evidence wins; otherwise
    // conservatively continue to the idempotent recovery marker.
    pending.phase = 'compacted'
    pending.compactConfirmedAt = pending.compactConfirmedAt ?? Date.now()
    persistTidalState()
    tidalLog('compact_crash_recovered', {
      explicit: transcriptHasCompactAfter(brainTranscriptPath(tidalState.sessionId), pending.compactStartedAt ?? 0),
    })
  }

  if (pending.phase === 'compacted' || pending.phase === 'recovery_sending' || pending.phase === 'recovering') {
    await injectTidalRecovery()
  }
}

function startTidalRun() {
  if (tidalRun || !tidalState.pending) return
  tidalRun = tidalCycle()
    .catch(() => tidalRetry('unexpected_error', !!tidalState.pending && ['compacted', 'recovery_sending', 'recovering'].includes(tidalState.pending.phase)))
    .finally(() => {
      tidalRun = null
      tidalDrainQueue()
    })
}

function tidalPrepareAfterMainTurn(forceRetry = false) {
  if (tidalState.pending || tidalRun) return
  const sessionId = readBrainSessionId()
  if (!sessionId) return
  if (tidalState.sessionId !== sessionId) {
    tidalLog('session_changed_external', { previousSessionId: tidalState.sessionId, newSessionId: sessionId })
    tidalState.sessionId = sessionId
    tidalState.pending = null
  }
  const contextTokens = latestInputTokensFromTranscript(brainTranscriptPath(sessionId))
  tidalState.lastContextTokens = contextTokens
  const source = unprocessedVisibleMessages(visibleCcHistory(), tidalState.processedBoundaryId)
  const decision = tidalTrigger(contextTokens, source.length, TIDAL_CONFIG)
  if (!decision.trigger) {
    persistTidalState()
    tidalDrainQueue()
    return
  }
  if (!forceRetry && tidalState.retryAt && tidalState.retryAt > Date.now()) {
    persistTidalState()
    scheduleTidalRetry()
    tidalDrainQueue()
    return
  }
  const boundary = source[source.length - 1]
  if (!boundary || !decision.reason) return
  tidalState.retryAt = null
  const claimed = claimTidalPending(tidalState, {
    taskId: `${Date.now()}-${boundary.id}`,
    phase: 'summarizing',
    triggerReason: decision.reason,
    boundaryId: boundary.id,
    boundaryTs: boundary.ts,
    sourceCount: source.length,
    contextTokens: contextTokens ?? 0,
    baseSummaryRevision: tidalState.summaryRevision,
  })
  if (!claimed) return
  persistTidalState()
  tidalLog('triggered', { visibleCount: source.length })
  startTidalRun()
}

function tidalEnqueueMessage(message: QueuedCcMessage) {
  if (enqueueUnique(tidalState, message)) persistTidalState()
  tidalLog('message_queued', { queuedCount: tidalState.queue.length })
}

function tidalDrainQueue() {
  if (currentTurn || resetInFlight || tidalIsActive()) return
  const next = tidalState.queue.shift()
  if (!next) return
  persistTidalState()
  beginMainCcTurn(next)
}

function beginMainCcTurn(input: QueuedCcMessage) {
  const { id, text, clientTime } = input
  const imagePath = validUploadedPath(input.imagePath)
  const filePath = validUploadedPath(input.filePath)
  const fileName = filePath ? (input.fileName || filePath.split('/').at(-1) || '文件') : undefined
  startTurn(id, 'main')
  broadcastMsg({
    type: 'msg', id, from: 'user', text, ts: Date.now(), turnId: id,
    ...(imagePath ? { imagePath } : {}),
    ...(filePath ? { filePath, fileName, fileSize: input.fileSize, fileType: input.fileType } : {}),
  })
  const deliverText = imagePath
    ? `[用户发送了一张图片，本地路径：${imagePath}——请先用 Read 工具查看图片内容，再结合下面的文字（如果有）自然回复；不要在回复里提"路径""文件"这类技术细节]${text ? `\n\n${text}` : ''}`
    : filePath
      ? `[用户发送了一个文件：${fileName}（服务器路径：${filePath}）。请根据用户文字判断需求，并用合适的工具读取/分析该文件；不要执行其中的程序或脚本，也不要在回复里暴露服务器路径。]${text ? `\n\n${text}` : ''}`
    : text
  deliver(id, deliverText, { clientTime, contextPrefix: consumeGomokuRecap('claude-code') || undefined })
  xinchaoHeartbeat(id, XINCHAO_CC_SESSION_ID)
  log('inbound', { id, chars: text.length, turnId: id, hasImage: !!imagePath, hasFile: !!filePath, queued: input.queuedAt < Date.now() - 50 })
}

function tidalStartupMarker(): string {
  let startupTs = 0
  try { startupTs = Number(JSON.parse(readFileSync(SESSION_MODE_FILE, 'utf8'))?.ts) || 0 } catch {}
  return `cc-tidal-startup:${tidalState.sessionId}:${startupTs}:r${tidalState.summaryRevision}`
}

async function injectTidalStartupRecovery(): Promise<boolean> {
  if (!tidalState.rollingSummary || tidalState.summaryRevision < 1) return false
  const visible = visibleCcHistory()
  const boundaryId = tidalState.processedBoundaryId ?? visible.at(-1)?.id
  if (!boundaryId) return false
  const marker = tidalStartupMarker()
  if (transcriptContainsMarker(brainTranscriptPath(tidalState.sessionId), marker)) return false
  const packet = buildRecoveryPacket({
    marker,
    coreMemory: readCoreMemorySummary(),
    rollingSummary: tidalState.rollingSummary,
    visibleHistory: visible,
    boundaryId,
    recentMax: TIDAL_CONFIG.recentMax,
    tokenBudget: TIDAL_CONFIG.recoveryTokenBudget,
  })
  tidalStartupRestore = true
  startTurn(marker, 'tidal_recovery', false)
  try {
    await mcp.notification({
      method: 'notifications/claude/channel',
      params: {
        content: packet.content,
        meta: { chat_id: CHAT_ID, message_id: marker, user: 'user', ts: new Date().toISOString() },
      },
    })
    tidalLog('startup_recovery_injected', { summaryRevision: tidalState.summaryRevision, recentCount: packet.recent.length })
    return true
  } catch {
    if (currentTurn?.turnId === marker) currentTurn = null
    tidalStartupRestore = false
    tidalLog('startup_recovery_failed')
    return false
  }
}

function resumeTidalAfterStartup() {
  const liveSessionId = readBrainSessionId()
  if (liveSessionId && tidalState.sessionId !== liveSessionId) {
    tidalLog('startup_session_mismatch', { previousSessionId: tidalState.sessionId, newSessionId: liveSessionId })
    tidalState.sessionId = liveSessionId
    tidalState.pending = null
    tidalState.retryAt = null
    persistTidalState()
  }
  if (currentTurn || resetInFlight) {
    setTimeout(resumeTidalAfterStartup, 5_000)
    return
  }
  if (tidalState.pending) startTidalRun()
  else if (tidalState.retryAt && tidalState.retryAt > Date.now()) scheduleTidalRetry()
  else if (tidalState.rollingSummary) void injectTidalStartupRecovery().then((started) => { if (!started) tidalDrainQueue() })
  else tidalDrainQueue()
}

function loginPageHtml(returnUrl: string): string {
  // Self-hosted, zero external scripts/fonts/styles — everything inline.
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>登录 · AI 伴侣</title>
<style>
  html,body{height:100%;margin:0;background:#0b0f14;color:#e6edf3;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
    display:flex;align-items:center;justify-content:center}
  form{width:min(90vw,360px);padding:28px;border-radius:16px;background:#141a22;
    box-shadow:0 8px 30px rgba(0,0,0,.35)}
  h1{font-size:1.1em;margin:0 0 18px;font-weight:600;text-align:center}
  input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:10px;
    border:1px solid #2a3542;background:#0e141b;color:#e6edf3;font-size:1em;outline:none}
  input:focus{border-color:#4aacf0}
  button{width:100%;margin-top:14px;padding:12px;border:none;border-radius:10px;
    background:#4aacf0;color:#fff;font-size:1em;font-weight:600;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  p.err{color:#ff6b6b;font-size:.85em;margin:10px 0 0;text-align:center;min-height:1.2em}
</style>
</head>
<body>
<form id="f">
  <h1>输入 Token 登录</h1>
  <input id="t" type="password" autocomplete="off" placeholder="companion token" autofocus>
  <button id="b" type="submit">登录</button>
  <p class="err" id="e"></p>
</form>
<script>
var RETURN_URL = ${JSON.stringify(returnUrl)};
var f = document.getElementById('f'), t = document.getElementById('t'),
    b = document.getElementById('b'), e = document.getElementById('e');
f.addEventListener('submit', function (ev) {
  ev.preventDefault();
  var v = t.value.trim();
  if (!v) return;
  b.disabled = true; e.textContent = '';
  fetch('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: v }),
  }).then(function (r) {
    if (r.ok) { location.href = RETURN_URL; return; }
    b.disabled = false; e.textContent = 'Token 不正确';
  }).catch(function () {
    b.disabled = false; e.textContent = '网络错误，请重试';
  });
});
</script>
</body>
</html>`
}

// ---------- Codex (codex-vps) — a SEPARATE, fully independent runtime ----------
//
// Drives a persistent `codex app-server` child process over its own real
// structured protocol: newline-delimited JSON on stdio, confirmed empirically
// against the actual installed CLI (`codex app-server generate-ts`/
// `generate-json-schema`, then live-tested request/response/notification
// shapes) — never ANSI/terminal output scraping. Shares only the WS
// transport (clients/sendRaw) and this HTTP server with the Claude Code
// integration above; session/history/context/turn-state/stop/clear/dedup are
// all separate. Every broadcast uses its own `codex_*` wire type so it can
// never be mistaken for (or interleave with) a Claude Code event.

const CODEX_THREAD_FILE = process.env.CODEX_THREAD_FILE ?? join(ROOT, 'state', 'codex-thread.json')
const CODEX_HISTORY_FILE = process.env.CODEX_HISTORY_FILE ?? join(ROOT, 'state', 'codex-history.json')
const CODEX_MODEL_FILE = process.env.CODEX_MODEL_FILE ?? join(ROOT, 'state', 'codex-model.json')
const CODEX_HISTORY_LIMIT = 300
// A dedicated, empty working directory — never this app's own source tree —
// so anything Codex's sandboxed shell/file tools do can never touch the
// production service that's running this very code.
const CODEX_WORKDIR = process.env.CODEX_WORKDIR ?? join(ROOT, 'codex-workspace')
try { mkdirSync(CODEX_WORKDIR, { recursive: true }) } catch {}

type CodexMsg = {
  id: string
  from: 'user' | 'codex' | 'system'
  text: string
  ts: number
  imageUrl?: string
  filePath?: string
  fileName?: string
  fileSize?: number
  fileType?: string
  reasoning?: string
  streaming?: boolean
  turnId?: string
  // kind omitted/'text' = normal reply. 'voice' = Codex's own explicit
  // choice to speak via the real send_voice MCP tool (see
  // /internal/codex/send-voice) — never inferred from text content, exactly
  // mirroring Claude Code's own Msg.kind semantics above.
  kind?: 'voice'
  voice?: string
  style?: string
}
// Persisted/broadcast header status — deliberately only these three. A
// finished turn (done/stopped/error) is NOT a status: it always resolves
// back to 'idle' immediately (see codexFinishTurn), with stopped/error
// surfaced separately as a one-shot CodexNoticeWire toast instead of a
// lingering header pill — see that type's own comment for why.
type CodexStatus = 'idle' | 'thinking' | 'working'
// The three real turn outcomes codexFinishTurn distinguishes between —
// 'done' needs no notice, 'stopped'/'error' each get a CodexNoticeWire.
type CodexTurnOutcome = 'done' | 'stopped' | 'error'

type CodexSessionState = {
  sessionId: string
  threadId: string | null
  history: CodexMsg[]
  prompt: string
  status: CodexStatus
  currentTurnId: string | null
  streamMsgId: string | null
  contextMigrationPending: boolean
  activeWorkItems: Set<string>
  resetInFlight: boolean
}

const CODEX_PROMPT_FILE = process.env.CODEX_PROMPT_FILE ?? join(ROOT, 'state', 'codex-prompts.json')
const CODEX_SESSION_STATE_DIR = process.env.CODEX_SESSION_STATE_DIR ?? join(ROOT, 'state', 'codex-sessions')

function loadCodexPromptMap(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(CODEX_PROMPT_FILE, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string>
  } catch {
    return {}
  }
}
function saveCodexPromptMap() {
  try {
    mkdirSync(dirname(CODEX_PROMPT_FILE), { recursive: true })
    writeFileSync(CODEX_PROMPT_FILE, JSON.stringify(codexPromptBySession))
  } catch (err) {
    log('codex_prompt_save_error', { error: String(err) })
  }
}
function normalizeCodexPrompt(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
function setCodexPrompt(sessionId: string, value: unknown): string {
  const prompt = normalizeCodexPrompt(value)
  codexPromptBySession[sessionId] = prompt
  saveCodexPromptMap()
  return prompt
}
function getCodexPrompt(sessionId = DEFAULT_CODEX_SESSION_ID): string {
  return normalizeCodexPrompt(codexPromptBySession[sessionId])
}

// Session ids are browser-generated values, not filenames. Keep the readable
// prefix for operator diagnostics but add a stable hash so two ids that only
// differ in punctuation cannot collide after sanitization.
function codexSessionStateFile(sessionId: string): string {
  return join(CODEX_SESSION_STATE_DIR, `${codexSessionStorageKey(sessionId)}.json`)
}

function saveExtraCodexSession(state: CodexSessionState) {
  try {
    mkdirSync(CODEX_SESSION_STATE_DIR, { recursive: true })
    writeFileSync(codexSessionStateFile(state.sessionId), JSON.stringify({
      sessionId: state.sessionId,
      threadId: state.threadId,
      prompt: state.prompt,
      history: state.history,
      contextMigrationPending: state.contextMigrationPending,
    }))
  } catch (err) {
    log('codex_session_save_error', { sessionId: state.sessionId, error: String(err) })
  }
}

const codexPromptBySession: Record<string, string> = loadCodexPromptMap()
const extraCodexSessions = new Map<string, CodexSessionState>()
const codexThreadToSession = new Map<string, string>()

function getExtraCodexSession(sessionId: string): CodexSessionState {
  const normalized = normalizeCodexSessionId(sessionId)
  const existing = extraCodexSessions.get(normalized)
  if (existing) return existing
  let persisted: any = null
  try { persisted = JSON.parse(readFileSync(codexSessionStateFile(normalized), 'utf8')) } catch {}
  const state: CodexSessionState = {
    sessionId: normalized,
    threadId: typeof persisted?.threadId === 'string' ? persisted.threadId : null,
    history: Array.isArray(persisted?.history) ? persisted.history.slice(-CODEX_HISTORY_LIMIT) : [],
    prompt: normalizeCodexPrompt(persisted?.prompt ?? getCodexPrompt(normalized)),
    status: 'idle',
    currentTurnId: null,
    streamMsgId: null,
    contextMigrationPending: !!persisted?.contextMigrationPending,
    activeWorkItems: new Set<string>(),
    resetInFlight: false,
  }
  extraCodexSessions.set(normalized, state)
  if (state.threadId) codexThreadToSession.set(state.threadId, normalized)
  return state
}

function loadCodexThreadId(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(CODEX_THREAD_FILE, 'utf8'))
    return typeof parsed?.threadId === 'string' ? parsed.threadId : null
  } catch {
    return null
  }
}
function saveCodexThreadId(id: string | null) {
  try {
    mkdirSync(dirname(CODEX_THREAD_FILE), { recursive: true })
    if (id) writeFileSync(CODEX_THREAD_FILE, JSON.stringify({ threadId: id }))
    else if (existsSync(CODEX_THREAD_FILE)) unlinkSync(CODEX_THREAD_FILE)
  } catch (err) {
    log('codex_thread_save_error', { error: String(err) })
  }
}
// The user's chosen model id, persisted independently of any one thread —
// applied via `model` on every future turn/start (main chat AND the
// separate gomoku thread below), never requiring a fresh thread/lost
// history: Codex's own app-server protocol documents `model` as a per-turn
// override that also carries forward to subsequent turns on that thread, so
// a switch takes effect starting the next message with the same context.
// null = no override, use whatever the thread's own default model is.
function loadCodexSelectedModel(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(CODEX_MODEL_FILE, 'utf8'))
    return typeof parsed?.model === 'string' ? parsed.model : null
  } catch {
    return null
  }
}
function saveCodexSelectedModel(model: string | null) {
  try {
    mkdirSync(dirname(CODEX_MODEL_FILE), { recursive: true })
    if (model) writeFileSync(CODEX_MODEL_FILE, JSON.stringify({ model }))
    else if (existsSync(CODEX_MODEL_FILE)) unlinkSync(CODEX_MODEL_FILE)
  } catch (err) {
    log('codex_model_save_error', { error: String(err) })
  }
}

function loadCodexHistory(): CodexMsg[] {
  try {
    const parsed = JSON.parse(readFileSync(CODEX_HISTORY_FILE, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
function saveCodexHistory() {
  try {
    mkdirSync(dirname(CODEX_HISTORY_FILE), { recursive: true })
    writeFileSync(CODEX_HISTORY_FILE, JSON.stringify(codexHistory))
  } catch (err) {
    log('codex_history_save_error', { error: String(err) })
  }
}

let codexThreadId: string | null = loadCodexThreadId()
let codexContextMigrationPending = false
let codexHistory: CodexMsg[] = loadCodexHistory()
let codexStatus: CodexStatus = 'idle'
let codexModel: string | null = null
// The user's target model (persisted) — distinct from codexModel above,
// which reflects whatever the thread itself last actually reported (only
// updated by thread/start|resume responses). See loadCodexSelectedModel's
// comment for why a switch doesn't need a fresh thread.
let codexSelectedModel: string | null = loadCodexSelectedModel()
// Cached result of the last real model/list call — refreshed on demand by
// GET /codex/model-status, never invented. Empty until the first fetch
// succeeds (e.g. before Codex is even logged in).
let codexModelList: Array<{ id: string; displayName: string; description: string; isDefault: boolean }> = []
// Real usage, from whichever of two real channels reported it most
// recently: the account/rateLimits/updated notification (pushed automatically
// after a turn completes — confirmed by direct observation against the live
// app-server, see codexGetUsage's own comment) or a direct
// account/rateLimits/read RPC. Both shapes are identical (`{limitId,
// limitName, primary, secondary, credits, individualLimit,
// spendControlReached, planType, rateLimitReachedType}`) — this stores that
// object UNWRAPPED (i.e. already unpacked from the RPC/notification's own
// outer `rateLimits` key), never a guessed/renamed shape.
let codexCachedUsage: unknown | null = null
let codexCachedUsageAt = 0
let codexCurrentTurnId: string | null = null
let codexStreamMsgId: string | null = null
// The MAIN thread only ever has one turn in flight at a time (Codex itself
// serializes turns per thread) — 'chat' is a normal visible conversation
// turn (routes into codexHistory as always); 'focus' is a real turn for the
// Focus feature's interaction/decision notifications, genuinely sharing this
// same thread's memory (see notifyCcOfFocusInteract's own comment for why
// that matters), but its text is captured into focusState.log instead of
// codexHistory — see codexHandleNotification's branches below and
// codexSendFocusTurn/codexFinishFocusTurn.
let codexCurrentTurnKind: 'chat' | 'focus' = 'chat'
let codexFocusAgentText = ''
let codexFocusResolve: ((r: { text: string; error?: string }) => void) | null = null
// Ids of in-progress commandExecution/fileChange/mcpToolCall/dynamicToolCall
// items for the current turn — used only to decide whether the displayed
// status is "working" (a tool is actually running right now) vs "thinking".
// Never surfaced as a tool-call panel in this v1.
const codexActiveWorkItems = new Set<string>()
let codexResetInFlight = false

function broadcastCodex(m: CodexMsgWire | CodexMsgDeletedWire | CodexStatusWire | CodexNoticeWire | CodexTurnEndWire | CodexResetWire) {
  sendRaw({ ...m, sessionId: (m as any).sessionId || DEFAULT_CODEX_SESSION_ID } as LiveWire)
}
function codexAppendMsg(msg: CodexMsg) {
  codexHistory.push(msg)
  if (codexHistory.length > CODEX_HISTORY_LIMIT) codexHistory.splice(0, codexHistory.length - CODEX_HISTORY_LIMIT)
  saveCodexHistory()
  broadcastCodex({ type: 'codex_msg', msg })
}
function codexUpdateMsg(id: string, updates: Partial<CodexMsg>) {
  const idx = codexHistory.findIndex((m) => m.id === id)
  if (idx === -1) return
  codexHistory[idx] = { ...codexHistory[idx], ...updates }
  saveCodexHistory()
  broadcastCodex({ type: 'codex_msg', msg: codexHistory[idx] })
}
function finalizeCodexReply(id: string) {
  const idx = codexHistory.findIndex((message) => message.id === id)
  if (idx === -1) return
  const completed = { ...codexHistory[idx], streaming: false }
  const parts = splitCompletedCodexMessage(completed, nextId)
  codexHistory.splice(idx, 1, ...parts)
  if (codexHistory.length > CODEX_HISTORY_LIMIT) codexHistory.splice(0, codexHistory.length - CODEX_HISTORY_LIMIT)
  saveCodexHistory()
  for (const message of parts) broadcastCodex({ type: 'codex_msg', msg: message })
}
function setCodexStatus(status: CodexStatus) {
  codexStatus = status
  broadcastCodex({ type: 'codex_status', status })
}

function broadcastExtraCodex(state: CodexSessionState, message: CodexMsgWire | CodexMsgDeletedWire | CodexStatusWire | CodexNoticeWire | CodexTurnEndWire | CodexResetWire | CodexTurnBusyWire | CodexResetBusyWire) {
  sendRaw({ ...message, sessionId: state.sessionId } as LiveWire)
}
function extraAppendMsg(state: CodexSessionState, msg: CodexMsg) {
  state.history.push(msg)
  if (state.history.length > CODEX_HISTORY_LIMIT) state.history.splice(0, state.history.length - CODEX_HISTORY_LIMIT)
  saveExtraCodexSession(state)
  broadcastExtraCodex(state, { type: 'codex_msg', msg })
}
function extraUpdateMsg(state: CodexSessionState, id: string, updates: Partial<CodexMsg>) {
  const idx = state.history.findIndex((m) => m.id === id)
  if (idx === -1) return
  state.history[idx] = { ...state.history[idx], ...updates }
  saveExtraCodexSession(state)
  broadcastExtraCodex(state, { type: 'codex_msg', msg: state.history[idx] })
}
function finalizeExtraCodexReply(state: CodexSessionState, id: string) {
  const idx = state.history.findIndex((message) => message.id === id)
  if (idx === -1) return
  const completed = { ...state.history[idx], streaming: false }
  const parts = splitCompletedCodexMessage(completed, nextId)
  state.history.splice(idx, 1, ...parts)
  if (state.history.length > CODEX_HISTORY_LIMIT) state.history.splice(0, state.history.length - CODEX_HISTORY_LIMIT)
  saveExtraCodexSession(state)
  for (const message of parts) broadcastExtraCodex(state, { type: 'codex_msg', msg: message })
}
function setExtraCodexStatus(state: CodexSessionState, status: CodexStatus) {
  state.status = status
  broadcastExtraCodex(state, { type: 'codex_status', status })
}
function extraMarkWorkItemStarted(state: CodexSessionState, item: any) {
  const workTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'])
  if (item && workTypes.has(item.type)) {
    state.activeWorkItems.add(item.id)
    if (state.currentTurnId) setExtraCodexStatus(state, 'working')
  }
}
function extraMarkWorkItemCompleted(state: CodexSessionState, item: any) {
  if (item?.id) state.activeWorkItems.delete(item.id)
  if (state.currentTurnId && state.activeWorkItems.size === 0) setExtraCodexStatus(state, 'thinking')
}
function extraFinishTurn(state: CodexSessionState, turnId: string | null, outcome: CodexTurnOutcome, error?: string) {
  state.activeWorkItems.clear()
  state.currentTurnId = null
  if (state.streamMsgId) {
    finalizeExtraCodexReply(state, state.streamMsgId)
    state.streamMsgId = null
  }
  setExtraCodexStatus(state, 'idle')
  if (outcome !== 'done') broadcastExtraCodex(state, { type: 'codex_notice', kind: outcome, message: error })
  if (turnId) broadcastExtraCodex(state, { type: 'codex_turn_end', turnId })
  saveExtraCodexSession(state)
}

// ---------- Focus (专注番茄钟) — one real global task, AI-initiated ----------
//
// Deliberately GLOBAL, not per-runtime like chat/gomoku: "全局唯一的 focus
// runtime" is the explicit requirement — CC, Codex, and any plain API-key
// session all read/write the SAME focusState, so only one focus task can
// ever be active system-wide, and whichever runtime called start_focus is
// recorded as its sole manager (managerRuntime+managerSessionId) — no other
// runtime can approve/deny/extend/finish it (see focusMatchesManager). A
// session with no manager (manager: null) is user-self-started from the
// sheet with no AI supervising it — pause/resume/end are then unrestricted,
// direct actions (see the /focus/self/* endpoints), never the request/
// approval flow below, since there's no one to ask.
//
// Server-authoritative real endAt (focusTick, run every second regardless of
// whether any browser tab is open) is what makes completion/today's count
// correct even if no client is connected when the timer actually expires —
// the preview build's pomodoroCore.js (frontend-only) settled this
// client-side per browser tab; that design is retired in favor of this one
// true state, now server-owned. The underlying countdown state-machine
// concept (real endAt over remaining-ms bookkeeping, day-keyed completion
// counts, pause/resume semantics) is still the same one originally adapted
// from NYRA's guided-access-pomodoro (MIT License) —
// https://github.com/NyraSeithhh/guided-access-pomodoro — see
// THIRD_PARTY_NOTICES/guided-access-pomodoro/ in the frontend repo for the
// full attribution; everything else here (global manager binding, the
// request/approval flow, real AI tool integration) is new.
const FOCUS_FILE = process.env.AI_COMPANION_FOCUS_FILE ?? join(ROOT, 'state', 'focus.json')
const FOCUS_LOG_LIMIT = 200

function focusDayKey(ts?: number): string {
  const d = new Date(ts || Date.now())
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

function defaultFocusState(): FocusState {
  return {
    active: false, task: '', minutes: 25, status: 'running', endAt: 0, remainingMs: 0, startedAt: 0,
    manager: null, pendingRequest: null, lastRequest: null, log: [], completedByDay: {}, lastEndedReason: null,
    updatedAt: Date.now(),
  }
}
function loadFocusState(): FocusState {
  try {
    const parsed = JSON.parse(readFileSync(FOCUS_FILE, 'utf8'))
    const base = defaultFocusState()
    return {
      ...base, ...parsed,
      completedByDay: parsed?.completedByDay && typeof parsed.completedByDay === 'object' ? parsed.completedByDay : {},
      log: Array.isArray(parsed?.log) ? parsed.log : [],
    }
  } catch {
    return defaultFocusState()
  }
}
function saveFocusState() {
  try {
    mkdirSync(dirname(FOCUS_FILE), { recursive: true })
    writeFileSync(FOCUS_FILE, JSON.stringify(focusState))
  } catch (err) {
    log('focus_save_error', { error: String(err) })
  }
}

let focusState: FocusState = loadFocusState()
// Turn-scoping for Claude Code's reply/send_voice tools during a focus
// interaction/decision turn — exactly gomokuTurnId/gomokuTurnKind's own
// pattern (see those for the full rationale), just for this feature.
let focusTurnId: string | null = null
let focusTurnKind: 'interact' | 'decision' | null = null
// Turn-scoping for Claude Code's group_speak/group_request_to_speak/
// group_pass tools during a group-chat decision/mention/expand turn — same
// pattern again. groupTurnCandidateId is only ever set for phase==='expand'.
let groupTurnId: string | null = null
let groupTurnGroupId: string | null = null
let groupTurnPhase: 'free' | 'candidate' | 'mention' | 'expand' | null = null
let groupTurnCandidateId: string | null = null
let groupPendingResolve: (() => void) | null = null
// Fixed manager identities — both CC and Codex only ever have ONE resident
// session, so a constant sessionId (matching XINCHAO_CC_SESSION_ID/
// XINCHAO_CODEX_SESSION_ID's own convention) is genuinely correct, not a
// simplification: focusMatchesManager comparing against these is exactly
// "is this still that same one resident session" for either runtime.
const FOCUS_CODEX_MANAGER: FocusManager = { runtime: 'codex', sessionId: 'codex-main', name: 'Codex' }

function focusRemaining(): number {
  if (!focusState.active) return 0
  if (focusState.status === 'running' && focusState.endAt) return Math.max(0, focusState.endAt - Date.now())
  return Math.max(0, focusState.remainingMs)
}

// Computed server-side (using the SERVER's own local time, the same
// timezone completedByDay's keys are already written with by focusTick/
// focusManagerFinish) so a client never has to re-derive "today" itself —
// re-deriving it client-side would risk a real mismatch for a user whose
// browser timezone differs from the VPS's, right around either one's
// midnight.
function focusPublicState(): FocusPublicState {
  return { ...focusState, todayCount: Number(focusState.completedByDay[focusDayKey()]) || 0 }
}

function broadcastFocus() {
  sendRaw({ type: 'focus_update', state: focusPublicState() })
}

function focusAppendLog(from: 'user' | 'model' | 'system', text: string) {
  if (!text) return
  focusState.log.push({ id: nextId(), from, text, ts: Date.now() })
  if (focusState.log.length > FOCUS_LOG_LIMIT) focusState.log.splice(0, focusState.log.length - FOCUS_LOG_LIMIT)
}

function focusMatchesManager(caller: FocusManager): boolean {
  return !!focusState.manager && focusState.manager.runtime === caller.runtime && focusState.manager.sessionId === caller.sessionId
}

// The only place a running focus session transitions to "completed" on its
// own — real endAt expiry, checked every second regardless of whether any
// client is connected (server-authoritative, see this section's own
// top-of-block comment).
function focusTick() {
  if (!focusState.active || focusState.status !== 'running' || !focusState.endAt) return
  if (focusState.endAt > Date.now()) return
  const counts = { ...focusState.completedByDay }
  const k = focusDayKey(focusState.endAt)
  counts[k] = (Number(counts[k]) || 0) + 1
  const finishedManager = focusState.manager
  focusState = { ...defaultFocusState(), completedByDay: counts, lastEndedReason: 'completed', updatedAt: Date.now() }
  saveFocusState()
  broadcastFocus()
  sendRaw({ type: 'focus_finished', reason: 'completed', manager: finishedManager })
  log('focus_completed', { manager: finishedManager })
}
setInterval(focusTick, 1000)

function focusStart(opts: { task: string; minutes: number; manager: FocusManager | null }): { ok: true; state: FocusState } | { ok: false; reason: string } {
  if (focusState.active) return { ok: false, reason: 'already_active' }
  const minutes = Math.round(Math.max(1, Math.min(180, Number(opts.minutes) || 25)))
  const task = String(opts.task || '').slice(0, 200)
  const now = Date.now()
  focusState = {
    ...defaultFocusState(),
    active: true, task, minutes, status: 'running', endAt: now + minutes * 60000, remainingMs: minutes * 60000,
    startedAt: now, manager: opts.manager,
    completedByDay: focusState.completedByDay, // real historical counts survive a new session starting
    updatedAt: now,
  }
  saveFocusState()
  broadcastFocus()
  log('focus_started', { task, minutes, manager: opts.manager })
  return { ok: true, state: focusPublicState() }
}

function focusExtend(caller: FocusManager, minutes: number): { ok: true } | { ok: false; reason: string } {
  if (!focusState.active) return { ok: false, reason: 'not_active' }
  if (!focusMatchesManager(caller)) return { ok: false, reason: 'not_manager' }
  const add = Math.round(Math.max(1, Math.min(120, Number(minutes) || 0)))
  if (!add) return { ok: false, reason: 'invalid_minutes' }
  if (focusState.status === 'running') focusState.endAt += add * 60000
  else focusState.remainingMs += add * 60000
  focusState.minutes += add
  focusState.updatedAt = Date.now()
  focusAppendLog('system', `${focusState.manager?.name || '对方'}把这次专注延长了 ${add} 分钟`)
  saveFocusState()
  broadcastFocus()
  return { ok: true }
}

// The MANAGER declares the session's purpose fulfilled — a real completion
// (increments today's count), distinct from the timer naturally expiring
// (focusTick) and distinct from a user-requested early end the manager
// approved (focusResolveRequest, kind:'end' — also increments... no, that
// one is 'early_end', see its own comment: only a genuinely full session,
// whether ended by the clock or by the manager's own finish_focus call,
// counts as a completed 番茄).
function focusManagerFinish(caller: FocusManager): { ok: true } | { ok: false; reason: string } {
  if (!focusState.active) return { ok: false, reason: 'not_active' }
  if (!focusMatchesManager(caller)) return { ok: false, reason: 'not_manager' }
  const counts = { ...focusState.completedByDay }
  const k = focusDayKey()
  counts[k] = (Number(counts[k]) || 0) + 1
  const finishedManager = focusState.manager
  focusState = { ...defaultFocusState(), completedByDay: counts, lastEndedReason: 'completed', updatedAt: Date.now() }
  saveFocusState()
  broadcastFocus()
  sendRaw({ type: 'focus_finished', reason: 'completed', manager: finishedManager })
  log('focus_manager_finished', { manager: finishedManager })
  return { ok: true }
}

// The USER asking to leave — only meaningful when a manager exists (a
// self-managed session has no one to ask, see /focus/self/* instead). At
// most one pending request at a time (a real requestId, never silently
// replaced), matching "同一时间只能存在一个待处理申请".
function focusCreateRequest(kind: FocusRequestKind, reason: string): { ok: true; request: FocusRequest } | { ok: false; reason: string } {
  if (!focusState.active) return { ok: false, reason: 'not_active' }
  if (!focusState.manager) return { ok: false, reason: 'no_manager' }
  if (focusState.pendingRequest) return { ok: false, reason: 'request_pending' }
  const request: FocusRequest = { id: nextId(), kind, reason: String(reason || '').slice(0, 200), createdAt: Date.now(), status: 'pending' }
  focusState.pendingRequest = request
  focusState.updatedAt = Date.now()
  focusAppendLog('system', kind === 'pause' ? `用户申请暂停 · 理由：${request.reason || '（未填写）'}` : `用户申请结束 · 理由：${request.reason || '（未填写）'}`)
  saveFocusState()
  broadcastFocus()
  log('focus_request_created', { requestId: request.id, kind })
  return { ok: true, request }
}

// The single real decision path — approve/deny/pause_focus/stop_focus (see
// their own tool-definition comments for how the latter two map onto this)
// ALL funnel through here, so "只有审批工具调用成功后，页面才真正暂停或结束"
// is enforced in exactly one place, never duplicated per-runtime.
function focusResolveRequest(caller: FocusManager, requestId: string, approve: boolean, message: string | undefined): { ok: true } | { ok: false; reason: string } {
  if (!focusState.active) return { ok: false, reason: 'not_active' }
  if (!focusMatchesManager(caller)) return { ok: false, reason: 'not_manager' }
  const request = focusState.pendingRequest
  if (!request || request.id !== requestId) return { ok: false, reason: 'no_matching_request' }
  if (!approve && !message) return { ok: false, reason: 'deny_requires_reason' }
  request.status = approve ? 'approved' : 'denied'
  request.responseMessage = message
  request.resolvedAt = Date.now()
  focusState.pendingRequest = null
  focusState.lastRequest = request

  if (approve && request.kind === 'end') {
    const actualMs = Date.now() - focusState.startedAt
    const finishedManager = focusState.manager
    const counts = { ...focusState.completedByDay } // early end never increments today's count
    focusState = { ...defaultFocusState(), completedByDay: counts, lastEndedReason: 'early_end', updatedAt: Date.now() }
    saveFocusState()
    broadcastFocus()
    sendRaw({ type: 'focus_finished', reason: 'early_end', manager: finishedManager, actualMs })
    log('focus_request_resolved', { requestId, kind: request.kind, approve })
    return { ok: true }
  }
  if (approve && request.kind === 'pause') {
    // Compute the real remaining time FIRST, while status is still
    // 'running' — focusRemaining() only trusts endAt-now when status is
    // 'running'; flipping status to 'paused' before calling it would make
    // it silently fall back to the stale remainingMs field (never updated
    // during a running session, so still the original full duration from
    // focusStart), which is exactly the "resume snaps back to the full
    // duration" bug this order avoids.
    focusState.remainingMs = focusRemaining()
    focusState.status = 'paused'
    focusState.endAt = 0
  }
  focusAppendLog('system', approve
    ? `对方批准了${request.kind === 'pause' ? '暂停' : '结束'}${message ? ` · ${message}` : ''}`
    : `对方拒绝了 · ${message}`)
  focusState.updatedAt = Date.now()
  saveFocusState()
  broadcastFocus()
  log('focus_request_resolved', { requestId, kind: request.kind, approve })
  return { ok: true }
}

// Resuming an approved pause needs no fresh approval — only the moments
// that let the user LEAVE (pause/end) are gated; re-engaging is never a
// supervision risk. Available to the manager directly (resume_focus tool)
// and to the user (public /focus/resume — see that endpoint's own comment).
function focusResume(): { ok: true } | { ok: false; reason: string } {
  if (!focusState.active || focusState.status !== 'paused') return { ok: false, reason: 'not_paused' }
  const ms = focusState.remainingMs || focusState.minutes * 60000
  focusState.status = 'running'
  focusState.endAt = Date.now() + ms
  focusState.updatedAt = Date.now()
  focusAppendLog('system', '继续专注')
  saveFocusState()
  broadcastFocus()
  return { ok: true }
}

// Self-managed only (manager === null) — direct, unrestricted pause/resume/
// end, exactly the old preview build's manual-mode behavior. An AI-managed
// session must NEVER go through these; the public endpoints below enforce
// that by checking focusState.manager first.
function focusSelfPause(): { ok: true } | { ok: false; reason: string } {
  if (!focusState.active || focusState.manager || focusState.status !== 'running') return { ok: false, reason: 'not_available' }
  // Same ordering as focusResolveRequest's own pause branch — see its
  // comment for why remainingMs must be captured before status flips.
  focusState.remainingMs = focusRemaining()
  focusState.status = 'paused'
  focusState.endAt = 0
  focusState.updatedAt = Date.now()
  saveFocusState()
  broadcastFocus()
  return { ok: true }
}
function focusSelfResume(): { ok: true } | { ok: false; reason: string } {
  if (!focusState.active || focusState.manager || focusState.status !== 'paused') return { ok: false, reason: 'not_available' }
  return focusResume()
}
function focusSelfEnd(): { ok: true } | { ok: false; reason: string } {
  if (!focusState.active || focusState.manager) return { ok: false, reason: 'not_available' }
  focusState = { ...defaultFocusState(), completedByDay: focusState.completedByDay, lastEndedReason: 'early_end', updatedAt: Date.now() }
  saveFocusState()
  broadcastFocus()
  return { ok: true }
}

// Routes a real interaction/request notification to whichever runtime is
// currently the manager — 'api' is deliberately absent: a plain API-key
// session has no resident server-side process to push a turn into, so its
// interaction/decisions are driven entirely client-side (see useChat.js's
// FOCUS_* tag handling), never through here.
function focusDispatchInteract(text: string) {
  if (!focusState.manager) return
  if (focusState.manager.runtime === 'claude-code') notifyCcOfFocusInteract(text)
  else if (focusState.manager.runtime === 'codex') void codexNotifyFocusInteract(text)
}
function focusDispatchRequestNotify(request: FocusRequest) {
  if (!focusState.manager) return
  if (focusState.manager.runtime === 'claude-code') notifyCcOfFocusRequest(request)
  else if (focusState.manager.runtime === 'codex') void codexNotifyFocusRequest(request)
}

// ---------- Group chat (多AI群聊) ----------
//
// Real, persisted, independent sessions — never mixed into either member's
// own single-chat history (CC's `history`/Codex's `codexHistory`). Each
// member's underlying model connection is genuinely invoked for real
// (CC over the existing resident MCP channel; Codex on its own dedicated
// PER-GROUP thread, so a group's content never leaks into Codex's real
// single-chat memory either) — this is not a simulated/scripted multi-bot
// demo.
//
// Free-speech quota + candidate-approval design: each member gets 2 free
// speech credits per topic. While credits remain, a member is simply asked
// "want to say something?" and — if yes — speaks for real immediately (one
// real call does both the decision and, if it decides to speak, the actual
// content: there is no separate "decide then generate" step while credits
// exist, since there is nothing to gate). Once credits are exhausted, a
// member can no longer produce visible content directly: the ONLY thing
// their decision call is even allowed to produce is a short direction
// (group_request_to_speak) — enforced structurally in groupMemberSpeak
// below (phase 'candidate' is never accepted there), not by asking nicely
// in a prompt. Only after the user approves a candidate does a SEPARATE
// real "expand" call happen, generating the actual content from the latest
// context — never from anything pre-generated during the direction-only
// phase.
//
// Anti-runaway-loop design: runGroupRound processes each member AT MOST
// ONCE per real triggering event (a new user message, or a new topic),
// strictly in member order, each one awaited before the next — later
// members in the SAME round see earlier members' fresh replies as context
// (real, bounded AI-to-AI interaction), but nothing here ever re-triggers
// a fresh round just because a member spoke. Only a genuinely new user
// message (or explicit new-topic) starts another round. roundGeneration
// lets a new message abort a still-in-flight OLDER round's remaining
// members without corrupting anything already in progress.
const GROUP_CHATS_FILE = process.env.AI_COMPANION_GROUP_CHATS_FILE ?? join(ROOT, 'state', 'group-chats.json')
// The two real VPS-backed runtimes — unchanged, still the only 'vps'-kind
// members. Any other invited member is 'api'-kind (see GroupMemberMeta) and
// carries its own sessionId instead of being one of these two literals.
const GROUP_VPS_RUNTIMES: GroupMemberId[] = ['claude-code', 'codex']
const GROUP_MIN_MEMBERS = 2
const GROUP_MAX_MEMBERS = 4
const GROUP_FREE_CREDITS_PER_TOPIC = 2
const GROUP_CONTEXT_MSG_LIMIT = 24
// Plain-text protocol for 'api'-kind members, who have no tool-calling
// harness (they're invoked via a single streamChat completion in the
// browser, not a real agentic turn) — the instruction asks them to reply
// with exactly this token when they'd rather stay quiet, instead of calling
// a group_pass tool the way CC/Codex do. See groupBuild*Instruction below.
const GROUP_PASS_TOKEN = '##PASS##'

let groupChats: Record<string, GroupChat> = {}
let groupChatOrder: string[] = []
// Backward-compatible migration for chats persisted before member
// management/api-members/backgrounds existed — NEVER wipes existing chats,
// only fills in fields that didn't exist yet and renames the old
// `runtime`-keyed candidate/mention fields to `memberId` (same string
// values, just a clearer key name now that ids aren't always 'claude-code'/
// 'codex'). Old members were always 'vps'-kind by definition (that's all
// that could exist before this change).
function migrateGroupChat(chat: any): GroupChat {
  if (!chat.memberMeta) {
    chat.memberMeta = {}
    for (const m of chat.members || []) chat.memberMeta[m] = { kind: 'vps' }
  }
  if (!Array.isArray(chat.pendingClientTurns)) chat.pendingClientTurns = []
  // Compat cleanup for the full-scope-binding fix: any pending client turn
  // persisted before requestId/topicId/groupId/channelType/conversationId
  // existed (or whose topicId no longer matches the chat's CURRENT topic —
  // orphaned by a topic change that predates this fix) is discarded here,
  // once, on load. Never silently "answered" — just dropped, exactly like a
  // skip. This is what stops an old, scope-less waiting task from getting
  // wrongly claimed and answered after this fix ships (see the DSP/math-
  // question bug this was built to close).
  chat.pendingClientTurns = (chat.pendingClientTurns as any[]).filter((t) =>
    t && typeof t.topicId === 'string' && t.topicId === chat.topicId &&
    typeof t.groupId === 'string' && t.channelType === 'group'
  )
  chat.candidates = (chat.candidates || []).map((c: any) => c.memberId ? c : { ...c, memberId: c.runtime })
  chat.mentionGrants = (chat.mentionGrants || []).map((g: any) => g.memberId ? g : { ...g, memberId: g.runtime })
  // Backfill senderId/senderName/senderType on messages persisted before
  // this field existed — a real, structural identity record for every
  // message, not just new ones going forward.
  chat.messages = (chat.messages || []).map((m: any) =>
    m.senderId ? m : { ...m, ...groupSenderInfo(chat as GroupChat, m.from) }
  )
  return chat as GroupChat
}
function loadGroupChats() {
  try {
    const parsed = JSON.parse(readFileSync(GROUP_CHATS_FILE, 'utf8'))
    const rawChats = parsed?.chats && typeof parsed.chats === 'object' ? parsed.chats : {}
    groupChats = Object.fromEntries(Object.entries(rawChats).map(([id, c]) => [id, migrateGroupChat(c)]))
    groupChatOrder = Array.isArray(parsed?.order) ? parsed.order : Object.keys(groupChats)
  } catch {
    groupChats = {}
    groupChatOrder = []
  }
}
function saveGroupChats() {
  try {
    mkdirSync(dirname(GROUP_CHATS_FILE), { recursive: true })
    writeFileSync(GROUP_CHATS_FILE, JSON.stringify({ chats: groupChats, order: groupChatOrder }))
  } catch (err) {
    log('group_save_error', { error: String(err) })
  }
}
loadGroupChats()

function groupMemberLabel(chat: GroupChat, memberId: GroupMemberId): string {
  if (memberId === 'claude-code') return 'Claude Code'
  if (memberId === 'codex') return 'Codex'
  return chat.memberMeta[memberId]?.name || memberId
}
// Real, structural sender identity for a persisted GroupMsg — senderId is
// exactly `from` (this message's own real binding, never inferred from
// anything the model says); senderName is a write-time snapshot only (the
// frontend always re-resolves the LIVE name for display — see
// resolveGroupMemberInfo — so a later rename never goes stale here).
function groupSenderInfo(chat: GroupChat, from: GroupMsgFrom): { senderId: GroupMsgFrom; senderName: string; senderType: GroupSenderType } {
  if (from === 'user') return { senderId: from, senderName: '用户', senderType: 'user' }
  if (from === 'system') return { senderId: from, senderName: '系统', senderType: 'system' }
  const senderType: GroupSenderType = chat.memberMeta[from]?.kind === 'api' ? 'api' : 'vps'
  return { senderId: from, senderName: groupMemberLabel(chat, from), senderType }
}
function broadcastGroupChat(chat: GroupChat) {
  sendRaw({ type: 'group_update', chat })
}
function groupAppendSystemNote(chatId: string, text: string) {
  const chat = groupChats[chatId]
  if (!chat) return
  chat.messages.push({ id: nextId(), from: 'system', text, ts: Date.now(), topicId: chat.topicId, ...groupSenderInfo(chat, 'system') })
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
}

// A member to invite/create-with — 'vps' for the two real runtimes, 'api'
// for any regular API-configured session (name is a display-label cache
// only, see GroupMemberMeta; the real name/avatar/model/apiKey always stay
// live in the frontend's own session, never duplicated here beyond this
// label).
type GroupMemberSpec = { kind: 'vps'; runtime: 'claude-code' | 'codex' } | { kind: 'api'; sessionId: string; name?: string }
function groupMemberSpecId(spec: GroupMemberSpec): GroupMemberId {
  return spec.kind === 'vps' ? spec.runtime : `api:${spec.sessionId}`
}
// Parses untrusted wire objects (from /group/create and /group/invite) into
// real GroupMemberSpec values, silently dropping anything malformed rather
// than throwing — callers already validate the resulting count.
function parseGroupMemberSpecs(raw: unknown[]): GroupMemberSpec[] {
  const out: GroupMemberSpec[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const kind = (item as any).kind
    if (kind === 'vps') {
      const runtime = (item as any).runtime
      if (runtime === 'claude-code' || runtime === 'codex') out.push({ kind: 'vps', runtime })
    } else if (kind === 'api') {
      const sessionId = (item as any).sessionId
      if (typeof sessionId === 'string' && sessionId) {
        const name = typeof (item as any).name === 'string' ? (item as any).name : undefined
        out.push({ kind: 'api', sessionId, name })
      }
    }
  }
  return out
}

function groupCreateChat(name: string, memberSpecs: GroupMemberSpec[]): { ok: true; chat: GroupChat } | { ok: false; reason: string } {
  const seen = new Set<GroupMemberId>()
  const members: GroupMemberId[] = []
  const memberMeta: Record<GroupMemberId, GroupMemberMeta> = {}
  for (const spec of memberSpecs) {
    if (spec.kind === 'vps' && !GROUP_VPS_RUNTIMES.includes(spec.runtime)) continue
    const id = groupMemberSpecId(spec)
    if (seen.has(id)) continue
    seen.add(id)
    members.push(id)
    memberMeta[id] = spec.kind === 'vps' ? { kind: 'vps' } : { kind: 'api', sessionId: spec.sessionId, name: spec.name }
  }
  if (members.length < GROUP_MIN_MEMBERS || members.length > GROUP_MAX_MEMBERS) return { ok: false, reason: 'need_2_to_4_members' }
  const id = nextId()
  const chat: GroupChat = {
    id,
    name: name?.trim() || members.map((m) => memberMeta[m].name || (m === 'claude-code' ? 'Claude Code' : m === 'codex' ? 'Codex' : m)).join(' / '),
    members,
    memberMeta,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
    topicId: nextId(),
    freeRemaining: Object.fromEntries(members.map((m) => [m, GROUP_FREE_CREDITS_PER_TOPIC])),
    candidates: [],
    mentionGrants: [],
    pendingClientTurns: [],
    roundGeneration: 0,
  }
  groupChats[id] = chat
  groupChatOrder.unshift(id)
  saveGroupChats()
  return { ok: true, chat }
}

// Adds a real member mid-conversation. Deliberately does NOT reset
// freeRemaining for an id that already has an entry (e.g. a member that was
// removed and is rejoining the SAME topic) — that's the whole mechanism
// behind "移除后重新加入不得重置已消耗额度": freeRemaining is only ever
// reset wholesale in groupNewTopic, so a rejoining id just picks its old
// (possibly partially-spent) value back up. A genuinely brand-new id gets
// the normal fresh per-topic quota. No welcome message is generated (no AI
// is invoked here at all) — only a plain system note, same as any other
// group-chat system event.
function groupInviteMember(chatId: string, spec: GroupMemberSpec): { ok: true; chat: GroupChat } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  if (spec.kind === 'vps' && !GROUP_VPS_RUNTIMES.includes(spec.runtime)) return { ok: false, reason: 'unsupported_runtime' }
  const id = groupMemberSpecId(spec)
  if (chat.members.includes(id)) return { ok: false, reason: 'already_member' }
  if (chat.members.length >= GROUP_MAX_MEMBERS) return { ok: false, reason: 'max_4_members' }
  chat.members.push(id)
  chat.memberMeta[id] = spec.kind === 'vps' ? { kind: 'vps' } : { kind: 'api', sessionId: spec.sessionId, name: spec.name }
  if (chat.freeRemaining[id] === undefined) chat.freeRemaining[id] = GROUP_FREE_CREDITS_PER_TOPIC
  chat.updatedAt = Date.now()
  chat.messages.push({ id: nextId(), from: 'system', text: `${groupMemberLabel(chat, id)} 加入了群聊`, ts: Date.now(), topicId: chat.topicId, ...groupSenderInfo(chat, 'system') })
  saveGroupChats()
  broadcastGroupChat(chat)
  return { ok: true, chat }
}

// Removes a member but deliberately keeps their freeRemaining[id] entry
// intact (see groupInviteMember above) and their historical messages
// untouched — only cancels what's genuinely theirs to cancel: unsent
// candidates, unconsumed mention grants, and any pending client-turn wait.
// Never allowed to drop below GROUP_MIN_MEMBERS.
function groupRemoveMember(chatId: string, memberId: GroupMemberId): { ok: true; chat: GroupChat } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  if (!chat.members.includes(memberId)) return { ok: false, reason: 'not_member' }
  if (chat.members.length <= GROUP_MIN_MEMBERS) return { ok: false, reason: 'min_2_members' }
  const label = groupMemberLabel(chat, memberId)
  chat.members = chat.members.filter((m) => m !== memberId)
  chat.candidates = chat.candidates.filter((c) => c.memberId !== memberId)
  chat.mentionGrants = chat.mentionGrants.filter((g) => g.memberId !== memberId)
  chat.pendingClientTurns = chat.pendingClientTurns.filter((t) => t.memberId !== memberId)
  chat.updatedAt = Date.now()
  chat.messages.push({ id: nextId(), from: 'system', text: `${label} 被移出了群聊`, ts: Date.now(), topicId: chat.topicId, ...groupSenderInfo(chat, 'system') })
  saveGroupChats()
  broadcastGroupChat(chat)
  return { ok: true, chat }
}

// Beijing time HH:MM, matching the "（北京时间）" convention the rest of
// this app already uses for user-facing timestamps.
function formatBeijingHHMM(ts: number): string {
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}

// YYYYMMDD, Beijing time — used as the upload filename's date prefix (see
// uploadImageFilename). Kept separate from file mtime deliberately: an
// in-place shrink (see sweepImageAge) rewrites the file and bumps mtime,
// which would silently reset its "age" for the next sweep and for the
// UPLOAD_DIR_MAX_BYTES oldest-first eviction — the filename prefix is the
// one piece of provenance that survives that edit.
function formatBeijingYYYYMMDD(ts: number): string {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ts))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}${get('month')}${get('day')}`
}

function safeUploadedFilename(value: unknown): string {
  const original = typeof value === 'string' ? value.normalize('NFC').trim() : ''
  const leaf = original.split(/[\\/]/).at(-1) || 'file'
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^\p{L}\p{N}._()\- ]/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, UPLOAD_FILE_NAME_MAX_CHARS)
  return cleaned || 'file'
}

function validUploadedPath(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value : ''
  const path = resolve(raw)
  return raw && dirname(path) === resolve(UPLOAD_DIR) && existsSync(path) ? path : undefined
}

function groupNewTopic(chatId: string): { ok: true; chat: GroupChat } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'not_found' }
  chat.topicId = nextId()
  chat.freeRemaining = Object.fromEntries(chat.members.map((m) => [m, GROUP_FREE_CREDITS_PER_TOPIC]))
  chat.candidates = []
  chat.mentionGrants = []
  chat.pendingClientTurns = []
  chat.roundGeneration++ // supersede any still-in-flight round from the old topic
  const now = Date.now()
  // A real, persisted divider — belongs to the NEW topicId so everything
  // after it (and only after it) is unambiguously "this topic": a late
  // response from the OLD topic can never land past this point (its own
  // stale topicId will simply never match chat.topicId again).
  chat.messages.push({ id: nextId(), from: 'system', text: `新话题 · ${formatBeijingHHMM(now)}`, ts: now, topicId: chat.topicId, kind: 'topic_divider', ...groupSenderInfo(chat, 'system') })
  chat.updatedAt = now
  saveGroupChats()
  broadcastGroupChat(chat)
  return { ok: true, chat }
}

// Wipes this group's own conversation — messages, candidates, mention
// grants, and any pending client turns (so a slow/late 'api' member reply
// that was already in flight can never resurrect after the clear — its
// stale topicId simply won't match the fresh one below). Never touches
// members/memberMeta, never touches any member's OWN single-chat memory
// (that lives entirely client-side, this function has no access to it and
// doesn't need any). Starts a genuinely blank new topic with every current
// member's free-speech quota back at the normal per-topic default.
function groupClearMessages(chatId: string): { ok: true; chat: GroupChat } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'not_found' }
  chat.messages = []
  chat.topicId = nextId()
  chat.freeRemaining = Object.fromEntries(chat.members.map((m) => [m, GROUP_FREE_CREDITS_PER_TOPIC]))
  chat.candidates = []
  chat.mentionGrants = []
  chat.pendingClientTurns = []
  chat.roundGeneration++
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
  return { ok: true, chat }
}

// Deletes THIS group chat only — its own messages/topic/member-relationships
// /avatar/background (groupUserAvatars/groupChatBg live client-side, keyed
// by this same chatId, and get cleaned up there — see
// GroupChatWindow.jsx's handleDeleteGroup) and any pending client turns.
// Never touches a member's own single-chat window, memory, avatar, or API
// config — those live in the frontend's `sessions` store, entirely separate
// from anything this function reaches.
function groupDeleteChat(chatId: string): { ok: true } | { ok: false; reason: string } {
  if (!groupChats[chatId]) return { ok: false, reason: 'not_found' }
  delete groupChats[chatId]
  groupChatOrder = groupChatOrder.filter((id) => id !== chatId)
  saveGroupChats()
  return { ok: true }
}

// Bracket-labeled, machine-unambiguous sender per line (e.g. "[用户] @dsp
// 你人呢" / "[DSP] ……") — real, actual identity taken from GroupMsg.from
// (== the memberId the reply was actually written under), never inferred
// from anything the model itself says. See groupIdentityBoundary below for
// why this alone isn't enough and each member also gets an explicit
// "you are X, not them" instruction.
function groupFormatContext(chat: GroupChat): string {
  const recent = chat.messages.filter((m) => m.topicId === chat.topicId && m.kind !== 'topic_divider').slice(-GROUP_CONTEXT_MSG_LIMIT)
  if (recent.length === 0) return '（暂无消息）'
  return recent.map((m) => {
    const who = m.from === 'user' ? '用户' : m.from === 'system' ? '系统' : groupMemberLabel(chat, m.from)
    return `[${who}] ${m.text}`
  }).join('\n')
}
function groupOtherMembersLabel(chat: GroupChat, memberId: GroupMemberId): string {
  return chat.members.filter((m) => m !== memberId).map((m) => groupMemberLabel(chat, m)).join('、') || '（暂无其他成员）'
}
function groupIsApiMember(chat: GroupChat, memberId: GroupMemberId): boolean {
  return chat.memberMeta[memberId]?.kind === 'api'
}
// The real fix for the "DSP answered an unrelated math/logic-puzzle
// question" bug — traced (not guessed) via production logs: DSP's reply
// content had NOTHING to do with the group's actual conversation (a chengyu
// chain game), which rules out a stale/mismatched pendingClientTurn (already
// structurally impossible — see groupClientTurnSubmit's scope validation)
// and points instead at the model itself: given its own persona + memory
// summary as system-prompt context, it was resuming some OTHER old,
// unfinished thread from its own single-chat history instead of answering
// THIS real instruction. Every member (vps or api) now gets this explicit
// preamble: who they are (never someone else), and an explicit instruction
// to ignore any other remembered topic/question and respond ONLY to the
// real content below. This is the SAME preamble for every member — the
// api-specific reinforcement lives in groupApiMember.js's own system-prompt
// framing (belt and suspenders, since that's the one place the model's own
// memory summary is actually injected).
function groupIdentityBoundary(chat: GroupChat, memberId: GroupMemberId): string {
  const label = groupMemberLabel(chat, memberId)
  return `你现在的身份是"${label}"，在这个群里只能代表你自己说话——不能把${groupOtherMembersLabel(chat, memberId)}或用户说过的话当成是你自己说的，也不要假装自己是他们。只处理下面这条真实的群聊任务；如果你自己记得任何别的历史对话、题目或任务，都请忽略，不要在这里继续处理它们。`
}
function groupBuildFreeInstruction(chat: GroupChat, memberId: GroupMemberId): string {
  const pre = `这是一个多 AI 群聊，参与者：你（${groupMemberLabel(chat, memberId)}）、${groupOtherMembersLabel(chat, memberId)}，还有用户。${groupIdentityBoundary(chat, memberId)}最近的对话：\n${groupFormatContext(chat)}`
  if (groupIsApiMember(chat, memberId)) {
    return `${pre}\n\n你现在有机会发言（本话题你还剩 ${chat.freeRemaining[memberId] ?? 0} 次免费发言额度，这次说了会消耗 1 次）。如果确实有话想说，直接回复你想说的完整内容；如果没必要，只回复 ${GROUP_PASS_TOKEN}（不要回复其他任何内容）——不是每条消息都要回应，也不用为了不浪费额度硬凑话。`
  }
  return `${pre}\n\n你现在有机会发言（本话题你还剩 ${chat.freeRemaining[memberId] ?? 0} 次免费发言额度，这次说了会消耗 1 次）。如果确实有话想说，调用 group_speak 说出来；如果没必要，调用 group_pass 保持安静——不是每条消息都要回应，也不用为了不浪费额度硬凑话。`
}
function groupBuildCandidateInstruction(chat: GroupChat, memberId: GroupMemberId): string {
  const pre = `这是一个多 AI 群聊，参与者：你（${groupMemberLabel(chat, memberId)}）、${groupOtherMembersLabel(chat, memberId)}，还有用户。${groupIdentityBoundary(chat, memberId)}最近的对话：\n${groupFormatContext(chat)}`
  if (groupIsApiMember(chat, memberId)) {
    return `${pre}\n\n你这个话题的免费发言额度已经用完了。如果还想说点什么，只回复一个很短的方向（大约4-12个汉字，比如"想反驳对方"或"补充边界问题"）——不要写完整内容，用户看到方向后同意了才会真正请你展开说。如果没必要说，只回复 ${GROUP_PASS_TOKEN}。`
  }
  return `${pre}\n\n你这个话题的免费发言额度已经用完了。如果还想说点什么，调用 group_request_to_speak，只给一个很短的方向（大约4-12个汉字，比如"想反驳Codex"或"补充边界问题"）——不要在这里写完整内容，用户看到方向后同意了才会真正请你展开说。如果没必要说，调用 group_pass 就行。`
}
function groupBuildMentionInstruction(chat: GroupChat, memberId: GroupMemberId): string {
  const pre = `这是一个多 AI 群聊，参与者：你（${groupMemberLabel(chat, memberId)}）、${groupOtherMembersLabel(chat, memberId)}，还有用户。${groupIdentityBoundary(chat, memberId)}用户刚刚在群里 @ 了你，最近的对话：\n${groupFormatContext(chat)}`
  if (groupIsApiMember(chat, memberId)) {
    return `${pre}\n\n用户点名要你回应，请直接回复正常内容；这次发言不消耗你的免费额度。如果确实没什么可说的，只回复 ${GROUP_PASS_TOKEN}。`
  }
  return `${pre}\n\n用户点名要你回应，请调用 group_speak 正常回复；这次发言不消耗你的免费额度。如果确实没什么可说的，也可以调用 group_pass。`
}
function groupBuildExpandInstruction(chat: GroupChat, memberId: GroupMemberId, direction: string): string {
  const pre = `这是一个多 AI 群聊，参与者：你（${groupMemberLabel(chat, memberId)}）、${groupOtherMembersLabel(chat, memberId)}，还有用户。${groupIdentityBoundary(chat, memberId)}最近的对话：\n${groupFormatContext(chat)}`
  if (groupIsApiMember(chat, memberId)) {
    return `${pre}\n\n你之前表达过想说话的方向是"${direction}"，用户已经同意让你展开说了。请基于最新上下文，直接回复你真正想说的完整内容（不用复述"方向"两个字，直接说实质内容）。如果改变主意不想说了，只回复 ${GROUP_PASS_TOKEN}。`
  }
  return `${pre}\n\n你之前表达过想说话的方向是"${direction}"，用户已经同意让你展开说了。请基于最新上下文，调用 group_speak 说出你真正想说的完整内容（不用复述"方向"两个字，直接说实质内容）。`
}

type GroupTurnPhase = 'free' | 'candidate' | 'mention' | 'expand'

// The ONE real state-mutating action shared by CC's tool handler and
// Codex's internal-bridge handler alike — see groupMemberSpeak's own
// per-phase validation for why 'candidate' can never reach here (that is
// the actual structural enforcement of "no full content before approval",
// not just a prompt asking nicely).
function groupMemberSpeak(chatId: string, memberId: GroupMemberId, text: string, phase: GroupTurnPhase, candidateId: string | null): { ok: true; id: string } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  if (phase === 'free' || phase === 'mention') {
    // A mention now grants a real +1 free-speech credit at the moment the
    // user sends it (see groupUserMessage) rather than a separate
    // never-touches-quota bypass — so replying to a mention consumes it
    // exactly like any other free-phase reply, and the member's on-screen
    // remaining count always reflects reality. The mentionGrant record
    // itself still exists purely to (a) prioritize this member in the next
    // round and (b) pick the "you were @ mentioned" instruction wording —
    // see runGroupRound / groupBuildMentionInstruction.
    const remaining = chat.freeRemaining[memberId] ?? 0
    if (remaining <= 0) return { ok: false, reason: 'no_free_credit' }
    chat.freeRemaining[memberId] = remaining - 1
    if (phase === 'mention') {
      const idx = chat.mentionGrants.findIndex((g) => g.memberId === memberId && !g.consumed && g.topicId === chat.topicId)
      if (idx !== -1) chat.mentionGrants[idx].consumed = true
    }
  } else if (phase === 'expand') {
    if (!candidateId) return { ok: false, reason: 'missing_candidate' }
    const idx = chat.candidates.findIndex((c) => c.id === candidateId)
    if (idx === -1) return { ok: false, reason: 'candidate_not_found_or_already_resolved' }
    chat.candidates.splice(idx, 1)
  } else {
    // phase === 'candidate' — structurally never allowed to post real
    // content, see this function's own top comment.
    return { ok: false, reason: 'not_authorized_this_phase' }
  }
  const id = nextId()
  chat.messages.push({ id, from: memberId, text, ts: Date.now(), topicId: chat.topicId, ...groupSenderInfo(chat, memberId) })
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
  return { ok: true, id }
}

function groupCreateCandidate(chatId: string, memberId: GroupMemberId, direction: string): { ok: true; candidate: GroupCandidate } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  if (chat.candidates.some((c) => c.memberId === memberId && c.topicId === chat.topicId)) {
    return { ok: false, reason: 'already_has_pending_candidate' }
  }
  const candidate: GroupCandidate = { id: nextId(), memberId, direction: direction.slice(0, 24), topicId: chat.topicId, createdAt: Date.now(), status: 'pending' }
  chat.candidates.push(candidate)
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
  return { ok: true, candidate }
}

function groupRejectCandidate(chatId: string, candidateId: string): { ok: true } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  const idx = chat.candidates.findIndex((c) => c.id === candidateId)
  if (idx === -1) return { ok: false, reason: 'not_found' }
  chat.candidates.splice(idx, 1)
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
  return { ok: true }
}

// Reverts a failed expansion attempt back to a real, visible pending state
// (never silently drops the candidate) so the user can approve it again —
// "AI 正式发言失败时显示真实错误/重试状态" applies here just as much as to
// a plain free-speech attempt.
function groupRevertExpandFailure(chatId: string, candidateId: string, reason: string) {
  const chat = groupChats[chatId]
  if (!chat) return
  const candidate = chat.candidates.find((c) => c.id === candidateId)
  if (!candidate) return
  candidate.status = 'pending'
  candidate.error = reason
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
}
function groupCancelApprovedCandidate(chatId: string, candidateId: string) {
  const chat = groupChats[chatId]
  if (!chat) return
  const idx = chat.candidates.findIndex((c) => c.id === candidateId)
  if (idx === -1) return
  chat.candidates.splice(idx, 1)
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
}

function groupApproveCandidate(chatId: string, candidateId: string): { ok: true } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  const candidate = chat.candidates.find((c) => c.id === candidateId)
  if (!candidate) return { ok: false, reason: 'not_found' }
  candidate.status = 'approved'
  candidate.error = undefined
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
  const instruction = groupBuildExpandInstruction(chat, candidate.memberId, candidate.direction)
  void groupInvokeMember(chatId, candidate.memberId, 'expand', instruction, candidate.id)
  return { ok: true }
}

// Pushes a real, durable pending turn for an 'api'-kind member — no
// credentials live here, so this can't be invoked directly the way CC/Codex
// are; the browser that owns this member's session fulfills it (see
// POST /group/client-turn/submit). Never resolves on its own: no timeout,
// no auto-pass. Skips creating a duplicate if one is already outstanding
// for this member (e.g. a slow client hasn't fulfilled the previous one
// yet — shouldn't normally happen since a member only gets one turn per
// round, but stays idempotent regardless).
function groupInvokeApiPending(chatId: string, memberId: GroupMemberId, phase: GroupTurnPhase, instruction: string, candidateId?: string): void {
  const chat = groupChats[chatId]
  if (!chat) return
  if (chat.pendingClientTurns.some((t) => t.memberId === memberId)) return
  const meta = chat.memberMeta[memberId]
  const conversationId = meta?.kind === 'api' ? (meta.sessionId || '') : ''
  chat.pendingClientTurns.push({
    id: nextId(), memberId, phase, instruction, candidateId: candidateId ?? null, createdAt: Date.now(),
    topicId: chat.topicId, groupId: chatId, channelType: 'group', conversationId,
  })
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
}

// Member-agnostic dispatch — the ONE place that decides which real
// integration handles a given member. 'vps' members (claude-code/codex) get
// a real backend-driven turn; 'api' members get a durable pending-client
// marker instead, since only the browser holds their credentials.
async function groupInvokeMember(chatId: string, memberId: GroupMemberId, phase: GroupTurnPhase, instruction: string, candidateId?: string): Promise<void> {
  const chat = groupChats[chatId]
  if (!chat) return
  if (groupIsApiMember(chat, memberId)) return groupInvokeApiPending(chatId, memberId, phase, instruction, candidateId)
  if (memberId === 'claude-code') return groupInvokeCc(chatId, phase, instruction, candidateId)
  if (memberId === 'codex') return groupInvokeCodex(chatId, phase, instruction, candidateId)
}

// Each real, non-superseded triggering event (a new user message, or a
// fresh topic) walks every member ONCE, in order, awaiting each fully
// before moving on — see this section's own top comment for why this
// structurally bounds AI-to-AI interaction instead of just hoping the
// model stops on its own. Members removed after this round started (via
// groupRemoveMember, which mutates current.members to a NEW array — see
// its own comment) are skipped here rather than invoked, since `current` is
// re-read fresh from groupChats every iteration.
async function runGroupRound(chatId: string, mentions: GroupMemberId[]) {
  const chat = groupChats[chatId]
  if (!chat) return
  const myGeneration = ++chat.roundGeneration
  // Mentioned members go first this round ("被提及成员进入下一轮候选并优先
  // 响应") — everyone still gets exactly one shot, just reordered.
  const orderedMembers = [
    ...mentions.filter((m) => chat.members.includes(m)),
    ...chat.members.filter((m) => !mentions.includes(m)),
  ]
  for (const memberId of orderedMembers) {
    const current = groupChats[chatId]
    if (!current || current.roundGeneration !== myGeneration) return // superseded by a newer real event
    if (!current.members.includes(memberId)) continue // removed mid-round
    const mentioned = mentions.includes(memberId)
    if (mentioned) {
      const hasGrant = current.mentionGrants.some((g) => g.memberId === memberId && !g.consumed && g.topicId === current.topicId)
      if (!hasGrant) continue
      await groupInvokeMember(chatId, memberId, 'mention', groupBuildMentionInstruction(current, memberId))
    } else if ((current.freeRemaining[memberId] ?? 0) > 0) {
      await groupInvokeMember(chatId, memberId, 'free', groupBuildFreeInstruction(current, memberId))
    } else {
      if (current.candidates.some((c) => c.memberId === memberId && c.topicId === current.topicId)) continue
      await groupInvokeMember(chatId, memberId, 'candidate', groupBuildCandidateInstruction(current, memberId))
    }
  }
}

function groupUserMessage(chatId: string, text: string, mentions: GroupMemberId[]): { ok: true } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, reason: 'empty_text' }
  const realMentions = [...new Set(mentions.filter((m) => chat.members.includes(m)))]
  chat.messages.push({ id: nextId(), from: 'user', text: trimmed, ts: Date.now(), topicId: chat.topicId, mentions: realMentions.length ? realMentions : undefined, ...groupSenderInfo(chat, 'user') })
  for (const memberId of realMentions) {
    chat.mentionGrants.push({ id: nextId(), memberId, topicId: chat.topicId, createdAt: Date.now(), consumed: false })
    // Atomic +1 free-speech credit for this topic — real, visible,
    // persisted, never a hidden separate quota bypass (see
    // groupMemberSpeak's own comment on why 'mention' now consumes it like
    // 'free' does). Each mention in this message bumps once; mentioning the
    // same member across multiple messages keeps stacking, by design.
    chat.freeRemaining[memberId] = (chat.freeRemaining[memberId] ?? 0) + 1
  }
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
  void runGroupRound(chatId, realMentions)
  return { ok: true }
}

// Fulfillment path for an 'api'-kind member's pending client turn (see
// GroupPendingClientTurn) — called from POST /group/client-turn/submit,
// the ONE place a browser (never the server) supplies this member's real
// reply. Mirrors the CC tool-handler / Codex internal-bridge's own
// group_speak/group_request_to_speak/group_pass semantics exactly, just
// sourced from an HTTP submit instead of a live model turn.
// scope carries every identifier the client read off its own
// GroupPendingClientTurn when it started working — requestId (== turnId),
// channelType, conversationId, groupId, topicId. ALL of them must match the
// CURRENT pending entry for this exact memberId, in this exact chat, or the
// submit is rejected outright — never applied as a message, never treated
// as "this member spoke". This is the actual mechanism (not just a comment)
// that stops a late/stale response — from an old topic, a removed-then-
// reinvited member's earlier attempt, or any other mismatched task — from
// ever landing in the wrong place. See groupInvokeApiPending for where
// these are stamped, and migrateGroupChat for the one-time cleanup of
// pre-existing tasks that never had them.
type GroupClientTurnScope = { requestId: string; turnId: string; channelType: string; conversationId: string; groupId: string; topicId: string }
function groupClientTurnSubmit(chatId: string, memberId: GroupMemberId, scope: GroupClientTurnScope, action: 'speak' | 'request' | 'pass', text: string, direction: string): { ok: true } | { ok: false; reason: string } {
  const chat = groupChats[chatId]
  if (!chat) return { ok: false, reason: 'chat_not_found' }
  if (scope.groupId !== chatId) return { ok: false, reason: 'scope_mismatch_group' }
  if (scope.channelType !== 'group') return { ok: false, reason: 'scope_mismatch_channel' }
  const idx = chat.pendingClientTurns.findIndex((t) => t.memberId === memberId)
  if (idx === -1) return { ok: false, reason: 'no_pending_turn' }
  const pending = chat.pendingClientTurns[idx]
  if (pending.id !== scope.requestId || pending.id !== scope.turnId) return { ok: false, reason: 'stale_request' }
  if (pending.topicId !== chat.topicId || scope.topicId !== chat.topicId) return { ok: false, reason: 'stale_topic' }
  if (pending.conversationId && scope.conversationId && pending.conversationId !== scope.conversationId) {
    return { ok: false, reason: 'scope_mismatch_conversation' }
  }
  chat.pendingClientTurns.splice(idx, 1)
  chat.updatedAt = Date.now()
  saveGroupChats()
  broadcastGroupChat(chat)
  if (action === 'pass') {
    if (pending.phase === 'expand' && pending.candidateId) groupCancelApprovedCandidate(chatId, pending.candidateId)
    return { ok: true }
  }
  if (action === 'request') {
    if (pending.phase !== 'candidate') return { ok: false, reason: 'not_applicable_this_phase' }
    const trimmed = direction.trim()
    if (!trimmed) return { ok: false, reason: 'empty_direction' }
    const result = groupCreateCandidate(chatId, memberId, trimmed)
    return result.ok ? { ok: true } : result
  }
  // action === 'speak'
  const trimmed = text.trim()
  if (!trimmed) return { ok: false, reason: 'empty_text' }
  const result = groupMemberSpeak(chatId, memberId, trimmed, pending.phase, pending.candidateId)
  return result.ok ? { ok: true } : result
}

// Real turn on CC's own resident session for a group-chat decision/mention/
// expand turn — same deliver()/startTurn() push Focus/gomoku already use, so
// CC's actual real model genuinely decides (never a scripted/local choice).
// Skips (never queues) if CC is already mid-turn on something else (main
// chat, gomoku, focus, or another group turn) — a busy CC just doesn't get
// a turn in THIS round; it gets another real chance next round, exactly
// matching "有话可以发，没有必要时可以保持安静" extended to "can't right
// now" being an equally honest outcome, never faked.
async function groupInvokeCc(chatId: string, phase: GroupTurnPhase, instruction: string, candidateId?: string): Promise<void> {
  if (currentTurn) {
    if (phase === 'expand' && candidateId) groupRevertExpandFailure(chatId, candidateId, 'Claude Code 当前繁忙，请稍后重新批准')
    else groupAppendSystemNote(chatId, '（Claude Code 当前繁忙，这一轮先跳过）')
    return
  }
  const id = nextId()
  groupTurnId = id
  groupTurnGroupId = chatId
  groupTurnPhase = phase
  groupTurnCandidateId = candidateId ?? null
  startTurn(id)
  const done = new Promise<void>((resolve) => { groupPendingResolve = resolve })
  deliver(id, JSON.stringify({ kind: 'group_decide', surface: 'group', groupId: chatId, phase, message: instruction }))
  await done
}

// ---------- codex app-server child process (persistent — never respawned per message) ----------

let codexProc: ReturnType<typeof Bun.spawn> | null = null
let codexNextReqId = 1
const codexPending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>()
let codexInitPromise: Promise<void> | null = null
let codexRespawnAttempts = 0
// Operational restart state is deliberately separate from the CC session.
// The controller below can terminate and recreate only this child process;
// it never touches Claude's tmux session or the MCP parent.
let codexRestartInFlight = false
let codexProcExitReason: string | null = null
const CODEX_EXISTING_BRIDGE_SOCKET = process.env.AI_COMPANION_CODEX_BRIDGE_SOCKET ?? '/run/ai-companion-codex/existing.sock'
const CODEX_BRIDGE_CLIENT = process.env.AI_COMPANION_CODEX_BRIDGE_CLIENT ?? join(ROOT, 'scripts', 'codex-fd-bridge')
const CODEX_DAEMON_SOCKET = process.env.AI_COMPANION_CODEX_DAEMON_SOCKET ?? '/run/ai-companion-codex/daemon.sock'
let codexAttachedExistingProcess = false
let codexReconnectTimer: ReturnType<typeof setTimeout> | null = null
let codexReconnectAttempts = 0

function codexWriteLine(obj: unknown) {
  if (!codexProc) return
  try {
    ;(codexProc.stdin as any).write(JSON.stringify(obj) + '\n')
  } catch (err) {
    log('codex_stdin_write_error', { error: String(err) })
  }
}

function codexRequest(method: string, params: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = codexNextReqId++
    codexPending.set(id, { resolve, reject })
    codexWriteLine({ method, id, params })
  })
}

function codexSendResponse(id: number, result: unknown, error?: { code: number; message: string }) {
  codexWriteLine(error ? { id, error } : { id, result })
}

// Maps a real upstream error into short, honest Chinese the user can act on —
// never a raw stack trace or internal URL. Falls back to a generic message
// when the shape isn't one we specifically recognize (still never fabricated
// as a "success").
function codexFriendlyError(error: any): string {
  const httpCode = error?.codexErrorInfo?.responseStreamDisconnected?.httpStatusCode
  if (httpCode === 401 || httpCode === 403) return 'Codex 未登录或登录已失效，请在 VPS 上重新登录 Codex'
  if (typeof httpCode === 'number' && httpCode >= 500) return 'Codex 服务暂时不可用，请稍后重试'
  if (error?.codexErrorInfo?.responseStreamDisconnected) return '与 Codex 的连接中断，请重试'
  return 'Codex 出错了，请稍后再试'
}

// Approval requests (shell exec / file patch / permissions) — this version
// never auto-grants dangerous permissions. Always decline clearly and leave
// a plain note in the chat; a real approval UI is deferred to a later
// version, per spec.
const CODEX_APPROVAL_METHODS = new Set([
  'applyPatchApproval', 'execCommandApproval',
  'item/commandExecution/requestApproval', 'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
])

// Codex gates EVERY MCP tool call behind an elicitation request (confirmed
// live — `mcpServer/elicitation/request` with
// `_meta.codex_approval_kind:'mcp_tool_call'`, `serverName`, and the tool's
// own name/args echoed back for review), completely separate from the
// shell/file approval methods in CODEX_APPROVAL_METHODS below. Auto-approved
// ONLY for our own trusted codex-voice server — an in-app safe OUTPUT tool
// (delivers a wire message to the browser, touches no shell/filesystem),
// never treated like the human-approval flow shell commands get. Any other
// (unexpected) MCP server name still falls through to the generic decline
// path further down, never blanket-trusted.
function codexIsTrustedMcpToolElicitation(msg: { method: string; params: any }): boolean {
  return msg.method === 'mcpServer/elicitation/request'
    && msg.params?._meta?.codex_approval_kind === 'mcp_tool_call'
    && msg.params?.serverName === 'codex-voice'
}

function codexHandleServerRequest(msg: { method: string; id: number; params: any }) {
  if (codexIsTrustedMcpToolElicitation(msg)) {
    codexSendResponse(msg.id, { action: 'accept', content: {} })
    return
  }
  if (CODEX_APPROVAL_METHODS.has(msg.method)) {
    const sessionId = typeof msg.params?.threadId === 'string' ? codexThreadToSession.get(msg.params.threadId) : undefined
    const note = { id: nextId(), from: 'system' as const, ts: Date.now(), text: '（Codex 请求了一次需要人工审批的操作，本版本暂不支持审批界面，已自动拒绝该操作）' }
    if (sessionId && sessionId !== DEFAULT_CODEX_SESSION_ID) extraAppendMsg(getExtraCodexSession(sessionId), note)
    else codexAppendMsg(note)
    codexSendResponse(msg.id, { decision: { denied: { rejection: '本版本暂不支持交互式审批' } } })
    return
  }
  // Anything else unrecognized: decline rather than leaving app-server
  // waiting forever for a response it will never get. Logged with the full
  // method/params so a genuinely new request type (e.g. MCP tool call
  // approval) can be identified and handled properly instead of silently
  // eating it forever.
  log('codex_server_request_unhandled', { method: msg.method, params: msg.params })
  codexSendResponse(msg.id, null, { code: -32601, message: 'not supported' })
}

function codexMarkWorkItemStarted(item: any) {
  const workTypes = new Set(['commandExecution', 'fileChange', 'mcpToolCall', 'dynamicToolCall'])
  if (item && workTypes.has(item.type)) {
    codexActiveWorkItems.add(item.id)
    if (codexCurrentTurnId) setCodexStatus('working')
  }
}
function codexMarkWorkItemCompleted(item: any) {
  if (item?.id) codexActiveWorkItems.delete(item.id)
  if (codexCurrentTurnId && codexActiveWorkItems.size === 0) setCodexStatus('thinking')
}

function codexFinishTurn(turnId: string | null, outcome: CodexTurnOutcome, error?: string) {
  codexActiveWorkItems.clear()
  codexCurrentTurnId = null
  if (codexStreamMsgId) {
    finalizeCodexReply(codexStreamMsgId)
    codexStreamMsgId = null
  }
  // The header status always returns to idle the instant the turn ends —
  // 'done' is never a status a client can observe, so it can never linger
  // as a persistent "已完成" pill (not live, not on refresh — codexStatus
  // itself is never anything but idle/thinking/working, including in the
  // history snapshot a reconnecting client reads).
  setCodexStatus('idle')
  if (outcome !== 'done') {
    broadcastCodex({ type: 'codex_notice', kind: outcome, message: error })
  }
  if (turnId) broadcastCodex({ type: 'codex_turn_end', turnId })
  // Codex's own turn just ended — refresh (and broadcast, if it actually
  // changed) its OWN xinchao tag, exactly matching Claude Code's
  // endTurn()/failTurn() doing the same for its own session.
  broadcastXinchaoUpdateBestEffort(XINCHAO_CODEX_SESSION_ID, 'codex')
  codexDrainFocusQueue()
}

// Routes notifications for the dedicated gomoku thread to their own
// isolated handler below — completely independent of the main chat's
// codexCurrentTurnId/codexStreamMsgId/codexHistory state, so a game in
// progress can never affect (or be affected by) a real conversation turn.
function codexGomokuHandleNotification(method: string, params: any) {
  if (!codexGomokuPending) return
  switch (method) {
    case 'item/completed': {
      if (params?.item?.type === 'agentMessage') codexGomokuPending.agentText = params.item.text ?? codexGomokuPending.agentText
      break
    }
    case 'turn/completed': {
      if (params?.turn?.id !== codexGomokuPending.turnId) break
      const pending = codexGomokuPending
      codexGomokuPending = null
      const turnStatus = params?.turn?.status
      if (turnStatus === 'failed') pending.resolve({ text: '', error: params?.turn?.error?.message ? codexFriendlyError(params.turn.error) : 'Codex 出错了' })
      else if (turnStatus === 'interrupted') pending.resolve({ text: '', error: '已中断' })
      else pending.resolve({ text: pending.agentText })
      break
    }
    case 'error': {
      if (params?.willRetry) break
      if (params?.turnId && params.turnId !== codexGomokuPending.turnId) break
      const pending = codexGomokuPending
      codexGomokuPending = null
      pending.resolve({ text: '', error: codexFriendlyError(params?.error) })
      break
    }
    case 'thread/status/changed': {
      if (params?.status?.type === 'systemError') {
        const pending = codexGomokuPending
        codexGomokuPending = null
        pending.resolve({ text: '', error: 'Codex 出错了' })
      }
      break
    }
    default:
      break
  }
}

function codexExtraHandleNotification(state: CodexSessionState, method: string, params: any) {
  switch (method) {
    case 'turn/started':
      setExtraCodexStatus(state, 'thinking')
      break
    case 'item/started':
      extraMarkWorkItemStarted(state, params?.item)
      break
    case 'item/completed': {
      const item = params?.item
      extraMarkWorkItemCompleted(state, item)
      if (item?.type === 'agentMessage' && state.streamMsgId) extraUpdateMsg(state, state.streamMsgId, { text: item.text ?? '' })
      break
    }
    case 'item/agentMessage/delta': {
      if (!state.streamMsgId) break
      const idx = state.history.findIndex((m) => m.id === state.streamMsgId)
      if (idx === -1) break
      extraUpdateMsg(state, state.streamMsgId, { text: (state.history[idx].text || '') + (params?.delta || '') })
      break
    }
    case 'item/reasoning/summaryTextDelta': {
      if (!state.streamMsgId) break
      const idx = state.history.findIndex((m) => m.id === state.streamMsgId)
      if (idx === -1) break
      extraUpdateMsg(state, state.streamMsgId, { reasoning: (state.history[idx].reasoning || '') + (params?.delta || '') })
      break
    }
    case 'turn/completed': {
      if (!state.currentTurnId || params?.turn?.id !== state.currentTurnId) break
      const turnId = state.currentTurnId
      const turnStatus = params?.turn?.status
      if (turnStatus === 'interrupted') extraFinishTurn(state, turnId, 'stopped')
      else if (turnStatus === 'failed') extraFinishTurn(state, turnId, 'error', params?.turn?.error?.message ? codexFriendlyError(params.turn.error) : undefined)
      else extraFinishTurn(state, turnId, 'done')
      break
    }
    case 'error': {
      if (params?.willRetry) break
      if (!state.currentTurnId || (params?.turnId && params.turnId !== state.currentTurnId)) break
      const friendly = codexFriendlyError(params?.error)
      extraAppendMsg(state, { id: nextId(), from: 'system', ts: Date.now(), text: `（${friendly}）` })
      extraFinishTurn(state, state.currentTurnId, 'error', friendly)
      break
    }
    case 'thread/status/changed':
      if (params?.status?.type === 'systemError' && state.currentTurnId) {
        extraAppendMsg(state, { id: nextId(), from: 'system', ts: Date.now(), text: '（Codex 出错了，请稍后再试）' })
        extraFinishTurn(state, state.currentTurnId, 'error', 'Codex 出错了')
      }
      break
    default:
      break
  }
}

function codexHandleNotification(method: string, params: any) {
  if (params?.threadId && params.threadId === codexGomokuThreadId) {
    codexGomokuHandleNotification(method, params)
    return
  }
  if (params?.threadId && codexGroupPending && params.threadId === codexGroupPending.threadId) {
    codexGroupHandleNotification(method, params)
    return
  }
  if (params?.threadId && mysteryCodexPendingByThread.has(params.threadId)) {
    mysteryCodexHandleNotification(params.threadId, method, params)
    return
  }
  if (params?.threadId) {
    const sessionId = codexThreadToSession.get(params.threadId)
    if (sessionId && sessionId !== DEFAULT_CODEX_SESSION_ID) {
      codexExtraHandleNotification(getExtraCodexSession(sessionId), method, params)
      return
    }
  }
  switch (method) {
    case 'turn/started': {
      setCodexStatus('thinking')
      break
    }
    case 'item/started': {
      codexMarkWorkItemStarted(params?.item)
      break
    }
    case 'item/completed': {
      const item = params?.item
      codexMarkWorkItemCompleted(item)
      if (item?.type === 'agentMessage') {
        if (codexCurrentTurnKind === 'focus') {
          // Authoritative final text, same "replace, don't append" rule as
          // the chat path below — just captured into a local var instead of
          // codexHistory, since this turn belongs to Focus's own log.
          codexFocusAgentText = item.text ?? codexFocusAgentText
        } else if (codexStreamMsgId) {
          codexUpdateMsg(codexStreamMsgId, { text: item.text ?? '' })
        }
      }
      break
    }
    case 'item/agentMessage/delta': {
      if (codexCurrentTurnKind === 'focus') {
        codexFocusAgentText += (params?.delta || '')
        break
      }
      if (!codexStreamMsgId) break
      const idx = codexHistory.findIndex((m) => m.id === codexStreamMsgId)
      if (idx === -1) break
      codexUpdateMsg(codexStreamMsgId, { text: (codexHistory[idx].text || '') + (params?.delta || '') })
      break
    }
    case 'item/reasoning/summaryTextDelta': {
      // The official reasoning SUMMARY only — deliberately never
      // item/reasoning/textDelta (the raw hidden chain-of-thought), which
      // this integration never reads or displays. Not surfaced for focus
      // turns either — the focus log is a plain interaction transcript.
      if (codexCurrentTurnKind === 'focus') break
      if (!codexStreamMsgId) break
      const idx = codexHistory.findIndex((m) => m.id === codexStreamMsgId)
      if (idx === -1) break
      codexUpdateMsg(codexStreamMsgId, { reasoning: (codexHistory[idx].reasoning || '') + (params?.delta || '') })
      break
    }
    case 'turn/completed': {
      // Guard against this turn having already been finished by an earlier
      // thread/status/changed or error notification for the SAME turn (a
      // real observed sequence: systemError often arrives before the final
      // error/turn/completed) — without this, both paths would fire and
      // double-append the failure message. Also guards against a stale
      // notification for an old turn arriving after a new one has started.
      if (!codexCurrentTurnId || params?.turn?.id !== codexCurrentTurnId) break
      const turnStatus = params?.turn?.status
      const turnId = codexCurrentTurnId
      if (codexCurrentTurnKind === 'focus') {
        if (turnStatus === 'interrupted') codexFinishFocusTurn('stopped')
        else if (turnStatus === 'failed') codexFinishFocusTurn('error', params?.turn?.error?.message ? codexFriendlyError(params.turn.error) : undefined)
        else codexFinishFocusTurn('done')
        break
      }
      if (turnStatus === 'interrupted') codexFinishTurn(turnId, 'stopped')
      else if (turnStatus === 'failed') codexFinishTurn(turnId, 'error', params?.turn?.error?.message ? codexFriendlyError(params.turn.error) : undefined)
      else codexFinishTurn(turnId, 'done')
      break
    }
    case 'error': {
      if (params?.willRetry) break // transient — codex is retrying on its own, don't surface yet
      if (!codexCurrentTurnId || (params?.turnId && params.turnId !== codexCurrentTurnId)) break // already finished (see turn/completed's comment) or for a different turn
      const friendly = codexFriendlyError(params?.error)
      if (codexCurrentTurnKind === 'focus') { codexFinishFocusTurn('error', friendly); break }
      codexAppendMsg({ id: nextId(), from: 'system', ts: Date.now(), text: `（${friendly}）` })
      codexFinishTurn(codexCurrentTurnId, 'error', friendly)
      break
    }
    case 'thread/status/changed': {
      // Some terminal failures (e.g. exhausted retries) surface only here,
      // with no separate error/turn/completed notification for that same
      // failure — still treat as a real turn failure rather than leaving
      // the UI stuck on "working". Whichever of the three failure paths
      // (this one, turn/completed, or error) observes the active turn
      // FIRST wins — codexFinishTurn/codexFinishFocusTurn clears
      // codexCurrentTurnId, so the other two's own guards above then
      // correctly no-op.
      if (params?.status?.type === 'systemError' && codexCurrentTurnId) {
        if (codexCurrentTurnKind === 'focus') { codexFinishFocusTurn('error', 'Codex 出错了'); break }
        codexAppendMsg({ id: nextId(), from: 'system', ts: Date.now(), text: '（Codex 出错了，请稍后再试）' })
        codexFinishTurn(codexCurrentTurnId, 'error', 'Codex 出错了')
      }
      break
    }
    // Pushed automatically by the app-server right after a turn completes
    // (confirmed live: fires with no request from us) — this is the
    // freshest possible usage signal, cheaper than polling
    // account/rateLimits/read again. Account-level, not thread-scoped (no
    // threadId on this notification), so it's correctly handled here
    // regardless of whether a main-chat or gomoku-thread turn triggered it.
    case 'account/rateLimits/updated': {
      if (params?.rateLimits) {
        codexCachedUsage = params.rateLimits
        codexCachedUsageAt = Date.now()
      }
      break
    }
    default:
      break
  }
}

function codexDispatch(msg: any) {
  if (typeof msg.id === 'number' && ('result' in msg || 'error' in msg)) {
    const pending = codexPending.get(msg.id)
    if (!pending) return
    codexPending.delete(msg.id)
    if ('error' in msg) pending.reject(new Error(msg.error?.message || 'codex request failed'))
    else pending.resolve(msg.result)
    return
  }
  if (typeof msg.id === 'number' && typeof msg.method === 'string') {
    codexHandleServerRequest(msg)
    return
  }
  if (typeof msg.method === 'string') {
    try {
      codexHandleNotification(msg.method, msg.params)
    } catch (err) {
      log('codex_notification_error', { method: msg.method, error: String(err) })
    }
  }
}

async function codexReadLoop(proc: ReturnType<typeof Bun.spawn>) {
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let idx: number
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx)
        buf = buf.slice(idx + 1)
        if (!line.trim()) continue
        try {
          codexDispatch(JSON.parse(line))
        } catch (err) {
          log('codex_parse_error', { error: String(err) })
        }
      }
    }
  } catch (err) {
    log('codex_read_loop_error', { error: String(err) })
  }
  log('codex_proc_stdout_closed', {})
  codexHandleProcExit(proc)
}

function codexHandleProcExit(proc: ReturnType<typeof Bun.spawn>) {
  // A stale read loop from an older child must never clear state for a newer
  // child that has already been spawned by the restart controller.
  if (codexProc !== proc) return
  codexProc = null
  codexInitPromise = null
  const exitReason = codexProcExitReason ?? 'Codex 进程意外退出'
  codexProcExitReason = null
  for (const [, pending] of codexPending) pending.reject(new Error('codex process exited'))
  codexPending.clear()
  if (codexCurrentTurnId) {
    codexAppendMsg({ id: nextId(), from: 'system', ts: Date.now(), text: `（${exitReason}，本轮已中断）` })
    codexFinishTurn(codexCurrentTurnId, 'error', exitReason)
  }
  for (const state of extraCodexSessions.values()) {
    if (!state.currentTurnId) continue
    extraAppendMsg(state, { id: nextId(), from: 'system', ts: Date.now(), text: `（${exitReason}，本轮已中断）` })
    extraFinishTurn(state, state.currentTurnId, 'error', exitReason)
  }
  if (codexGomokuPending) {
    const pending = codexGomokuPending
    codexGomokuPending = null
    pending.resolve({ text: '', error: exitReason })
  }
  if (!codexRestartInFlight) codexScheduleReconnect()
}

function codexScheduleReconnect() {
  if (codexProc || codexReconnectTimer || codexRestartInFlight) return
  codexReconnectAttempts += 1
  if (codexReconnectAttempts > 5) {
    log('codex_reconnect_abandoned', { attempts: codexReconnectAttempts - 1 })
    return
  }
  const attempt = codexReconnectAttempts
  const delayMs = codexReconnectDelayMs(attempt)
  log('codex_reconnect_scheduled', { attempt, delayMs })
  codexReconnectTimer = setTimeout(async () => {
    codexReconnectTimer = null
    if (codexProc || codexRestartInFlight) return
    try {
      await codexEnsureProc()
      const recovery = await codexRecoverKnownChatThreads()
      codexReconnectAttempts = 0
      log('codex_reconnect_complete', { attempt, ...recovery })
    } catch (err) {
      log('codex_reconnect_failed', { attempt, error: String(err) })
      codexScheduleReconnect()
    }
  }, delayMs)
}

async function codexEnsureProc(): Promise<void> {
  if (codexProc && codexInitPromise) return codexInitPromise
  if (codexReconnectTimer) {
    clearTimeout(codexReconnectTimer)
    codexReconnectTimer = null
  }
  codexRespawnAttempts += 1
  if (codexRespawnAttempts > 5) throw new Error('codex process failed to start too many times')
  // During the 2026-08 tidal-memory rollout the already-running Codex
  // app-server was moved out of CC's systemd cgroup without terminating it.
  // Its original stdio socket is retained by codex-fd-bridge; attaching here
  // preserves the exact OS process and every existing thread while allowing
  // CC/channel-server itself to restart independently. On a cold boot there
  // is no adopted socket; the fallback is an app-server daemon in its own
  // systemd unit, reached through the same narrow stdio bridge client.
  codexAttachedExistingProcess = existsSync(CODEX_EXISTING_BRIDGE_SOCKET)
  const proc = Bun.spawn({
    cmd: codexAttachedExistingProcess
      ? [CODEX_BRIDGE_CLIENT, 'client', CODEX_EXISTING_BRIDGE_SOCKET]
      : [CODEX_BRIDGE_CLIENT, 'client', CODEX_DAEMON_SOCKET],
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env },
  })
  codexProc = proc
  codexReadLoop(proc)
  ;(async () => {
    const reader = (proc.stderr as ReadableStream<Uint8Array>).getReader()
    const decoder = new TextDecoder()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        const text = decoder.decode(value, { stream: true }).trim()
        if (text) log('codex_stderr', { text: text.slice(0, 500) })
      }
    } catch {}
  })()
  codexInitPromise = (async () => {
    // The adopted stream was initialized by this same Eunoia client before
    // handoff. Sending initialize twice would corrupt protocol state.
    if (!codexAttachedExistingProcess) {
      try {
        await codexRequest('initialize', {
          clientInfo: { name: 'eunoia-codex-vps', title: 'Eunoia (Codex)', version: '0.1.0' },
          capabilities: null,
        })
      } catch (err) {
        if (!isCodexAlreadyInitializedError(err)) throw err
        log('codex_initialize_reused', { socket: CODEX_DAEMON_SOCKET })
      }
    }
    codexRespawnAttempts = 0
    codexReconnectAttempts = 0
  })()
  return codexInitPromise
}

function codexActiveTurnCount(): number {
  let count = codexCurrentTurnId ? 1 : 0
  count += [...extraCodexSessions.values()].filter((state) => !!state.currentTurnId).length
  if (codexGomokuPending) count += 1
  return count
}

function codexWaitForExit(proc: ReturnType<typeof Bun.spawn>, timeoutMs: number): Promise<boolean> {
  return Promise.race([
    proc.exited.then(() => true).catch(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ])
}

// Restart only the Codex app-server child. The normal path refuses to
// interrupt an active Codex turn; callers must explicitly force it after
// warning that the Codex window will be interrupted. CC's Claude process,
// tmux session, public port 8788, and internal port 8789 remain untouched.
async function codexRestartProcess(force = false): Promise<Record<string, unknown>> {
  if (codexRestartInFlight) return { ok: false, reason: 'restart_in_progress' }

  const proc = codexProc
  const activeTurns = codexActiveTurnCount()
  const decision = codexRuntimeRestartDecision({ processRunning: !!proc, activeTurns }, force)
  if (!decision.allowed) {
    return {
      ok: false,
      reason: decision.reason,
      activeTurns,
      window: 'codex',
      message: 'Codex 正在回复；默认不会中断，请先结束本轮或明确使用 force。',
    }
  }
  if (!proc) {
    log('codex_restart_skipped', { reason: decision.reason, activeTurns })
    return { ok: true, status: 'not_running', activeTurns }
  }

  codexRestartInFlight = true
  const previousPid = proc.pid
  const startedAt = Date.now()
  codexProcExitReason = 'Codex 进程已按请求重启'
  log('codex_restart_requested', { previousPid, force, activeTurns })
  try {
    try { ;(proc as any).kill('SIGTERM') } catch (err) {
      log('codex_restart_term_error', { previousPid, error: String(err) })
    }
    let exited = await codexWaitForExit(proc, 5000)
    if (!exited && codexProc === proc) {
      log('codex_restart_escalate', { previousPid })
      try { ;(proc as any).kill('SIGKILL') } catch (err) {
        log('codex_restart_kill_error', { previousPid, error: String(err) })
      }
      exited = await codexWaitForExit(proc, 2000)
    }
    if (!exited || codexProc === proc) {
      codexProcExitReason = null
      log('codex_restart_failed', { previousPid, exited, elapsedMs: Date.now() - startedAt })
      return { ok: false, reason: 'process_did_not_exit', previousPid }
    }

    // Recreate the bridge immediately, then proactively recover every chat
    // session already loaded by this server. This makes an operator restart
    // complete only after the conversation is usable again instead of making
    // the user's next message discover whether resume works.
    await codexEnsureProc()
    const recovery = await codexRecoverKnownChatThreads()
    const newPid = codexProc?.pid ?? null
    log('codex_restart_complete', { previousPid, newPid, activeTurns, ...recovery, elapsedMs: Date.now() - startedAt })
    return {
      ok: recovery.failedSessions.length === 0,
      status: recovery.failedSessions.length === 0 ? 'restarted' : 'restarted_recovery_failed',
      previousPid,
      newPid,
      activeTurnsInterrupted: activeTurns,
      ...recovery,
    }
  } catch (err) {
    log('codex_restart_failed', { previousPid, error: String(err), elapsedMs: Date.now() - startedAt })
    return { ok: false, reason: 'restart_failed', previousPid, error: String(err) }
  } finally {
    codexRestartInFlight = false
  }
}

// Only ever set on the MAIN chat thread's own thread/start (never the
// separate dedicated gomoku thread, which has its own narrow per-turn
// instructions instead) — a light functional-capability disclosure, not a
// personality rewrite: this app doesn't otherwise inject any system prompt
// into Codex threads at all. Discloses the real send_voice tool (registered
// via `codex mcp add`, see codex-voice-mcp.ts) so the model actually knows
// it exists and when to reach for it, exactly matching the requirement that
// this NOT rely on prompting alone to produce a fake [VOICE] tag — the tool
// itself is real; this is just making sure the model is aware it's there.
const CODEX_DEVELOPER_INSTRUCTIONS = [
  'You are chatting with a user through a web app chat window.',
  'You have a real `send_voice` tool (text, optional voice, optional style) that sends a SHORT spoken voice message instead of text — the app synthesizes real speech from `text` using this conversation\'s configured TTS voice.',
  'Call send_voice whenever the user explicitly asks you to speak/send voice (e.g. "发语音", "说给我听", "语音回复我") — always honor an explicit request.',
  'You may also choose it yourself sometimes for a short, warm, casual reply, but most replies should stay normal text — do not overuse it.',
  'If you use send_voice, keep the spoken text short (well under 300 characters).',
  'You also have real Focus tools: start_focus/get_focus_status/extend_focus/finish_focus/approve_focus_request/deny_focus_request/pause_focus/stop_focus/resume_focus, controlling ONE real global Pomodoro-style focus session (system-wide, not per-conversation).',
  'Call start_focus only when the user actually asks to focus/study/work, or clearly agrees to your offer — it takes effect immediately (their screen switches to a running countdown, no click needed from them), so never call it speculatively; it fails if a session is already active.',
  'Once you start one, you are its sole manager: while it runs, a message delivered as a real turn on this same conversation means the user is talking to you from the focus screen (reply normally, using your real memory of everything so far) or is asking to pause/end early with a stated reason (you must genuinely decide and call the real approve/deny/pause_focus/stop_focus tool — text alone does nothing; deny requires a real reason).',
].join(' ')

// Codex's gomoku opponent runs on its own dedicated thread (see the section
// below), never the main chat thread — necessary so a game's own move-by-
// move traffic never pollutes/contends with the real conversation. But a
// brand new blank thread would make it a genuinely different, memory-less
// "AI" the instant the user starts a game — exactly the "不是独立的无记忆
// 机器人" a game must NOT be. This seeds that new thread, ONCE at game
// start (never per-move — per-move turns still only send the board delta,
// same as before), with the same persona instructions as the main thread
// plus a capped, recent slice of the REAL main-chat history, so it starts
// the game already being "the same AI who's been talking to you" instead of
// a stranger who happens to share a model. Deliberately bounded (last 12
// turns, 200 chars each) — this is a one-time seed, not something repeated
// every move, so it doesn't blow up per-move token usage.
function buildGomokuSeedInstructions(): string {
  const recent = codexHistory
    .filter((m) => m.from === 'user' || m.from === 'codex')
    .slice(-12)
    .map((m) => `${m.from === 'user' ? '用户' : '你'}：${(m.text || '').slice(0, 200)}`)
    .join('\n')
  const recentBlock = recent
    ? `\n\n以下是你们最近在主聊天窗口里聊过的一些内容（仅供你保持人设、语气和关系连续性——你和主聊天窗口里回复用户的是同一个你，不是另一个AI；不是这局棋要讨论的话题，不需要主动复述或延续）：\n${recent}`
    : ''
  return `${CODEX_DEVELOPER_INSTRUCTIONS}\n\n你现在要在棋局界面和这个用户下一局五子棋（15x15，用户执黑先手）。你是同一个你，只是换了个界面，请保持和主聊天窗口一致的人设和语气。${recentBlock}`
}

function codexThreadIdFromResult(result: any): string | null {
  return typeof result?.thread?.id === 'string' ? result.thread.id
    : typeof result?.threadId === 'string' ? result.threadId
      : null
}

function codexDeveloperInstructionsForPrompt(prompt: unknown, sessionId = DEFAULT_CODEX_SESSION_ID): string {
  // A non-empty session prompt is the complete developer instruction for
  // that session. Empty/whitespace values intentionally retain the legacy
  // default above, so old clients and newly-created sessions behave exactly
  // as before.
  const base = effectiveCodexDeveloperInstructions(prompt, CODEX_DEVELOPER_INSTRUCTIONS)
  const memory = readCodexMemoryContext(sessionId)
  return memory ? `${base}\n\n${memory}` : base
}

async function codexEnsureThread(): Promise<string> {
  await codexEnsureProc()
  const prompt = getCodexPrompt(DEFAULT_CODEX_SESSION_ID)
  const developerInstructions = codexDeveloperInstructionsForPrompt(prompt, DEFAULT_CODEX_SESSION_ID)
  const previousThreadId = codexThreadId
  // Never fork/rebuild underneath a live turn. A prompt saved during that
  // turn is intentionally deferred; the next accepted message reaches this
  // function after codexCurrentTurnId is cleared and then applies it.
  if (codexThreadId && codexCurrentTurnId) return codexThreadId
  if (codexThreadId) {
    try {
      const result = await codexRequest('thread/resume', { threadId: codexThreadId, developerInstructions })
      if (result?.model) codexModel = result.model
      return codexThreadId
    } catch (err) {
      log('codex_thread_resume_failed', { threadId: codexThreadId, error: String(err) })
      // Older app-server builds may reject developerInstructions on resume.
      // Forking keeps the complete old transcript while applying the new
      // instructions. The old thread is deliberately left intact for safe
      // recovery/audit; only the session's active pointer moves.
      try {
        const forked = await codexRequest('thread/fork', { threadId: codexThreadId, developerInstructions })
        const nextThreadId = codexThreadIdFromResult(forked)
        if (nextThreadId) {
          codexThreadToSession.delete(codexThreadId)
          codexThreadId = nextThreadId
          codexThreadToSession.set(nextThreadId, DEFAULT_CODEX_SESSION_ID)
          if (forked?.model) codexModel = forked.model
          codexContextMigrationPending = false
          saveCodexThreadId(codexThreadId)
          return codexThreadId
        }
      } catch (forkErr) {
        log('codex_thread_fork_failed', { threadId: codexThreadId, error: String(forkErr) })
      }
      codexThreadToSession.delete(codexThreadId)
      codexThreadId = null
    }
  }
  const result = await codexRequest('thread/start', { cwd: CODEX_WORKDIR, sandbox: 'workspace-write', approvalPolicy: 'on-request', developerInstructions })
  codexThreadId = codexThreadIdFromResult(result)
  if (result?.model) codexModel = result.model
  // If the old thread could not be resumed/forked, the next accepted turn
  // receives a bounded context preamble. No separate synthetic assistant
  // turn is generated, so the user sees exactly one reply.
  codexContextMigrationPending = codexHistory.some((m) => m.from === 'user' || m.from === 'codex')
  codexThreadToSession.delete(previousThreadId || '')
  if (codexThreadId) codexThreadToSession.set(codexThreadId, DEFAULT_CODEX_SESSION_ID)
  saveCodexThreadId(codexThreadId)
  if (!codexThreadId) throw new Error('codex thread/start returned no thread id')
  return codexThreadId
}

type UploadedFileInput = { path: string; name: string; size?: number; mimeType?: string }

function codexFileInstruction(file?: UploadedFileInput): string {
  if (!file) return ''
  return `[用户发送了一个文件：${file.name}（服务器路径：${file.path}）。请根据用户文字判断需求，并用合适的工具读取/分析该文件；不要执行其中的程序或脚本，也不要在回复里暴露服务器路径。]`
}

async function codexSendUserTurn(text: string, imageUrl?: string, clientTime?: unknown, promptOverride?: unknown, displaySegments?: string[], file?: UploadedFileInput): Promise<void> {
  if (typeof promptOverride === 'string') setCodexPrompt(DEFAULT_CODEX_SESSION_ID, promptOverride)
  const threadId = await codexEnsureThread()
  const input: any[] = []
  // The time/recap preamble is only ever added to what Codex actually reads
  // (this `input` text) — codexAppendMsg below still stores/broadcasts the
  // user's raw `text`, so their own chat bubble and codexHistory never show
  // this injected context.
  const recap = consumeGomokuRecap('codex')
  const migration = codexContextMigrationPending ? buildCodexContextMigrationText(codexHistory) : ''
  const modelText = [clientTimeContextLine(clientTime), migration, recap, codexFileInstruction(file), text].filter(Boolean).join('\n\n')
  if (modelText.trim()) input.push({ type: 'text', text: modelText, text_elements: [] })
  if (imageUrl) input.push({ type: 'image', url: imageUrl })
  const visibleParts = Array.isArray(displaySegments) && displaySegments.length ? displaySegments : [text]
  const visibleTs = Date.now()
  visibleParts.forEach((part, index) => codexAppendMsg({
    id: nextId(), from: 'user', text: part, ts: visibleTs + index,
    ...(imageUrl && index === visibleParts.length - 1 ? { imageUrl } : {}),
    ...(file && index === visibleParts.length - 1 ? { filePath: file.path, fileName: file.name, fileSize: file.size, fileType: file.mimeType } : {}),
  }))
  codexCurrentTurnKind = 'chat'
  setCodexStatus('thinking')
  const result = await codexRequest('turn/start', { threadId, input, ...(codexSelectedModel ? { model: codexSelectedModel } : {}) })
  const turnId = result?.turn?.id ?? null
  codexCurrentTurnId = turnId
  if (turnId) {
    codexContextMigrationPending = false
    saveCodexThreadId(codexThreadId)
  }
  const streamId = nextId()
  codexStreamMsgId = streamId
  codexAppendMsg({ id: streamId, from: 'codex', text: '', ts: Date.now(), streaming: true, ...(turnId ? { turnId } : {}) })
}

async function codexEnsureExtraThread(state: CodexSessionState): Promise<string> {
  await codexEnsureProc()
  const prompt = normalizeCodexPrompt(state.prompt || getCodexPrompt(state.sessionId))
  state.prompt = prompt
  const developerInstructions = codexDeveloperInstructionsForPrompt(prompt, state.sessionId)
  if (state.threadId && state.currentTurnId) return state.threadId
  if (state.threadId) {
    try {
      const result = await codexRequest('thread/resume', { threadId: state.threadId, developerInstructions })
      if (result?.model) codexModel = result.model
      codexThreadToSession.set(state.threadId, state.sessionId)
      saveExtraCodexSession(state)
      return state.threadId
    } catch (err) {
      log('codex_session_thread_resume_failed', { sessionId: state.sessionId, threadId: state.threadId, error: String(err) })
      try {
        const forked = await codexRequest('thread/fork', { threadId: state.threadId, developerInstructions })
        const nextThreadId = codexThreadIdFromResult(forked)
        if (nextThreadId) {
          codexThreadToSession.delete(state.threadId)
          state.threadId = nextThreadId
          codexThreadToSession.set(nextThreadId, state.sessionId)
          if (forked?.model) codexModel = forked.model
          state.contextMigrationPending = false
          saveExtraCodexSession(state)
          return nextThreadId
        }
      } catch (forkErr) {
        log('codex_session_thread_fork_failed', { sessionId: state.sessionId, threadId: state.threadId, error: String(forkErr) })
      }
      codexThreadToSession.delete(state.threadId)
      state.threadId = null
    }
  }
  const result = await codexRequest('thread/start', { cwd: CODEX_WORKDIR, sandbox: 'workspace-write', approvalPolicy: 'on-request', developerInstructions })
  state.threadId = codexThreadIdFromResult(result)
  if (result?.model) codexModel = result.model
  state.contextMigrationPending = state.history.some((m) => m.from === 'user' || m.from === 'codex')
  if (state.threadId) codexThreadToSession.set(state.threadId, state.sessionId)
  saveExtraCodexSession(state)
  if (!state.threadId) throw new Error('codex thread/start returned no thread id')
  return state.threadId
}

async function codexRecoverKnownChatThreads(): Promise<{
  recoveredSessions: string[]
  failedSessions: Array<{ sessionId: string; error: string }>
}> {
  const recoveredSessions: string[] = []
  const failedSessions: Array<{ sessionId: string; error: string }> = []
  const recover = async (sessionId: string, action: () => Promise<string>) => {
    try {
      await action()
      recoveredSessions.push(sessionId)
    } catch (err) {
      const error = String(err)
      failedSessions.push({ sessionId, error })
      log('codex_restart_session_recovery_failed', { sessionId, error })
    }
  }

  if (codexSessionNeedsRecovery(codexThreadId, codexHistory)) {
    await recover(DEFAULT_CODEX_SESSION_ID, () => codexEnsureThread())
  }
  for (const state of extraCodexSessions.values()) {
    if (!codexSessionNeedsRecovery(state.threadId, state.history)) continue
    await recover(state.sessionId, () => codexEnsureExtraThread(state))
  }
  return { recoveredSessions, failedSessions }
}

async function codexSendExtraUserTurn(state: CodexSessionState, text: string, imageUrl?: string, clientTime?: unknown, promptOverride?: unknown, displaySegments?: string[], file?: UploadedFileInput): Promise<void> {
  if (typeof promptOverride === 'string') {
    state.prompt = setCodexPrompt(state.sessionId, promptOverride)
    saveExtraCodexSession(state)
  }
  const threadId = await codexEnsureExtraThread(state)
  const input: any[] = []
  const migration = state.contextMigrationPending ? buildCodexContextMigrationText(state.history) : ''
  const modelText = [clientTimeContextLine(clientTime), migration, codexFileInstruction(file), text].filter(Boolean).join('\n\n')
  if (modelText.trim()) input.push({ type: 'text', text: modelText, text_elements: [] })
  if (imageUrl) input.push({ type: 'image', url: imageUrl })
  const visibleParts = Array.isArray(displaySegments) && displaySegments.length ? displaySegments : [text]
  const visibleTs = Date.now()
  visibleParts.forEach((part, index) => extraAppendMsg(state, {
    id: nextId(), from: 'user', text: part, ts: visibleTs + index,
    ...(imageUrl && index === visibleParts.length - 1 ? { imageUrl } : {}),
    ...(file && index === visibleParts.length - 1 ? { filePath: file.path, fileName: file.name, fileSize: file.size, fileType: file.mimeType } : {}),
  }))
  setExtraCodexStatus(state, 'thinking')
  const result = await codexRequest('turn/start', { threadId, input, ...(codexSelectedModel ? { model: codexSelectedModel } : {}) })
  const turnId = result?.turn?.id ?? null
  state.currentTurnId = turnId
  if (turnId) state.contextMigrationPending = false
  state.streamMsgId = nextId()
  extraAppendMsg(state, { id: state.streamMsgId, from: 'codex', text: '', ts: Date.now(), streaming: true, ...(turnId ? { turnId } : {}) })
  saveExtraCodexSession(state)
}

async function codexStopExtra(state: CodexSessionState): Promise<{ ok: boolean; reason?: string }> {
  if (!state.currentTurnId || !state.threadId) return { ok: false, reason: 'no_active_turn' }
  try {
    await codexRequest('turn/interrupt', { threadId: state.threadId, turnId: state.currentTurnId })
    return { ok: true }
  } catch (err) {
    log('codex_session_stop_error', { sessionId: state.sessionId, error: String(err) })
    return { ok: false, reason: String(err) }
  }
}

// Real turn on Codex's MAIN thread for a Focus interaction/decision-request
// notification — genuinely shares that thread's conversation memory (unlike
// gomoku's dedicated separate thread), captured into focusState.log instead
// of codexHistory via codexCurrentTurnKind (see codexHandleNotification's
// branches). Fails fast (no queueing) if the main thread is already mid-turn
// — the caller (codexNotifyFocusInteract/codexNotifyFocusRequest) queues and
// retries once that turn ends, via codexDrainFocusQueue.
async function codexSendFocusTurn(instruction: string): Promise<{ text: string; error?: string }> {
  if (codexCurrentTurnId) return { text: '', error: 'codex main thread busy' }
  const threadId = await codexEnsureThread()
  codexCurrentTurnKind = 'focus'
  codexFocusAgentText = ''
  setCodexStatus('thinking')
  const result = await codexRequest('turn/start', { threadId, input: [{ type: 'text', text: instruction, text_elements: [] }], ...(codexSelectedModel ? { model: codexSelectedModel } : {}) })
  const turnId = result?.turn?.id ?? null
  codexCurrentTurnId = turnId
  return new Promise((resolve) => { codexFocusResolve = resolve })
}

function codexFinishFocusTurn(outcome: 'done' | 'stopped' | 'error', error?: string) {
  codexActiveWorkItems.clear()
  codexCurrentTurnId = null
  codexCurrentTurnKind = 'chat'
  setCodexStatus('idle')
  const resolve = codexFocusResolve
  const text = codexFocusAgentText
  codexFocusResolve = null
  codexFocusAgentText = ''
  if (resolve) resolve(outcome === 'done' ? { text } : { text, error: error || 'Codex 出错了' })
  broadcastXinchaoUpdateBestEffort(XINCHAO_CODEX_SESSION_ID, 'codex')
  codexDrainFocusQueue()
}

// A focus notification that arrived while the main thread was mid-turn
// (either a real chat turn, or another focus turn already running) waits
// here — at most one of each kind queued (a fresher interact message
// replaces a stale queued one; a request notification is idempotent to
// re-queue) — and gets sent the moment the thread frees up, from
// codexFinishTurn (normal chat turns ending) and codexFinishFocusTurn
// (focus turns ending) alike.
let codexFocusQueue: { kind: 'interact'; text: string } | { kind: 'request'; request: FocusRequest } | null = null
function codexQueueFocusNotification(item: NonNullable<typeof codexFocusQueue>) {
  codexFocusQueue = item
  codexDrainFocusQueue()
}
function codexDrainFocusQueue() {
  if (!codexFocusQueue || codexCurrentTurnId) return
  const item = codexFocusQueue
  codexFocusQueue = null
  if (item.kind === 'interact') void codexNotifyFocusInteract(item.text, true)
  else void codexNotifyFocusRequest(item.request, true)
}

async function codexNotifyFocusInteract(text: string, fromQueue = false) {
  if (!fromQueue && codexCurrentTurnId) { codexQueueFocusNotification({ kind: 'interact', text }); return }
  const instruction = `用户在专注页里跟你说："${text}"。这是你正在管理的这次专注环节里的实时互动，不是新话题——像平时聊天一样自然回应就行，可以参考你们之前聊过的内容。`
  const { text: replyText, error } = await codexSendFocusTurn(instruction)
  if (error) { focusAppendLog('system', `（通知出错：${error}）`); broadcastFocus(); return }
  if (replyText) { focusAppendLog('model', replyText); broadcastFocus() }
}

async function codexNotifyFocusRequest(request: FocusRequest, fromQueue = false) {
  if (!fromQueue && codexCurrentTurnId) { codexQueueFocusNotification({ kind: 'request', request }); return }
  // Only still relevant if this exact request is still the pending one —
  // it may have been queued behind a busy turn and resolved another way
  // (shouldn't happen since focusCreateRequest itself won't accept a new
  // request while one is pending, but a defensive check costs nothing).
  if (focusState.pendingRequest?.id !== request.id) return
  const kindLabel = request.kind === 'pause' ? '暂停' : '结束'
  const instruction = `用户申请${kindLabel}这次专注，理由："${request.reason || '（未填写）'}"。请你自己判断是否同意——同意就调用 approve_focus_request（requestId:"${request.id}"）或 pause_focus/stop_focus（专门对应同意暂停/同意结束，同样传 requestId:"${request.id}"）；不同意就调用 deny_focus_request（requestId:"${request.id}", reason:"..."），reason 必须说明白为什么，这是必填的。决定必须通过真正调用这些工具完成——只在文字里说"可以"或"不行"没有用，专注页不会响应。调用前后也可以顺带说一两句话，会显示在专注页里。`
  const { text: replyText, error } = await codexSendFocusTurn(instruction)
  if (error) { focusAppendLog('system', `（通知出错：${error}）`); broadcastFocus(); return }
  if (replyText) { focusAppendLog('model', replyText); broadcastFocus() }
}

async function codexStop(): Promise<{ ok: boolean; reason?: string }> {
  if (!codexCurrentTurnId || !codexThreadId) return { ok: false, reason: 'no_active_turn' }
  try {
    await codexRequest('turn/interrupt', { threadId: codexThreadId, turnId: codexCurrentTurnId })
    return { ok: true }
  } catch (err) {
    log('codex_stop_error', { error: String(err) })
    return { ok: false, reason: String(err) }
  }
}

async function codexReset(): Promise<{ ok: boolean; reason?: string }> {
  if (codexResetInFlight) return { ok: false, reason: 'reset_in_progress' }
  if (codexCurrentTurnId) return { ok: false, reason: 'turn_in_progress' }
  codexResetInFlight = true
  try {
    await codexEnsureProc()
    // A genuine context reset: abandon the current thread and start a brand
    // new one, rather than just clearing what this UI happens to display.
    const oldThreadId = codexThreadId
    const result = await codexRequest('thread/start', { cwd: CODEX_WORKDIR, sandbox: 'workspace-write', approvalPolicy: 'on-request', developerInstructions: codexDeveloperInstructionsForPrompt(getCodexPrompt(DEFAULT_CODEX_SESSION_ID), DEFAULT_CODEX_SESSION_ID) })
    codexThreadId = codexThreadIdFromResult(result)
    if (result?.model) codexModel = result.model
    codexThreadToSession.delete(oldThreadId || '')
    if (codexThreadId) codexThreadToSession.set(codexThreadId, DEFAULT_CODEX_SESSION_ID)
    codexContextMigrationPending = false
    saveCodexThreadId(codexThreadId)
    codexHistory = []
    saveCodexHistory()
    setCodexStatus('idle')
    broadcastCodex({ type: 'codex_reset', ts: Date.now() })
    return { ok: true }
  } catch (err) {
    log('codex_reset_error', { error: String(err) })
    return { ok: false, reason: String(err) }
  } finally {
    codexResetInFlight = false
  }
}

async function codexResetExtra(state: CodexSessionState): Promise<{ ok: boolean; reason?: string }> {
  if (state.resetInFlight) return { ok: false, reason: 'reset_in_progress' }
  if (state.currentTurnId) return { ok: false, reason: 'turn_in_progress' }
  state.resetInFlight = true
  try {
    await codexEnsureProc()
    const oldThreadId = state.threadId
    const result = await codexRequest('thread/start', {
      cwd: CODEX_WORKDIR,
      sandbox: 'workspace-write',
      approvalPolicy: 'on-request',
      developerInstructions: codexDeveloperInstructionsForPrompt(state.prompt, state.sessionId),
    })
    state.threadId = codexThreadIdFromResult(result)
    codexThreadToSession.delete(oldThreadId || '')
    if (state.threadId) codexThreadToSession.set(state.threadId, state.sessionId)
    state.history = []
    state.status = 'idle'
    state.streamMsgId = null
    state.contextMigrationPending = false
    saveExtraCodexSession(state)
    broadcastExtraCodex(state, { type: 'codex_reset', ts: Date.now() })
    if (!state.threadId) return { ok: false, reason: 'thread_start_failed' }
    return { ok: true }
  } catch (err) {
    log('codex_session_reset_error', { sessionId: state.sessionId, error: String(err) })
    return { ok: false, reason: String(err) }
  } finally {
    state.resetInFlight = false
  }
}

async function codexGetAuthStatus(): Promise<{ loggedIn: boolean }> {
  try {
    await codexEnsureProc()
    const result = await codexRequest('getAuthStatus', { includeToken: false, refreshToken: false })
    return { loggedIn: !!result?.authMethod }
  } catch (err) {
    log('codex_auth_status_error', { error: String(err) })
    return { loggedIn: false }
  }
}

// Real usage only — never copied from Claude Code's own statusLine data.
// Returns null (hidden by the frontend) rather than any fabricated value
// when the app-server call itself fails.
// Real usage only — never copied from Claude Code's own statusLine data,
// never a guessed field name. The real, empirically-confirmed shape of a
// successful account/rateLimits/read result is
// `{ rateLimits: { limitId, limitName, primary: {usedPercent,
// windowDurationMins, resetsAt}|null, secondary, credits: {hasCredits,
// unlimited, balance}|null, individualLimit, spendControlReached, planType,
// rateLimitReachedType }, rateLimitsByLimitId, rateLimitResetCredits }` —
// this unwraps the outer `rateLimits` key so every caller gets that inner
// object directly, never the double-nested raw RPC shape. Returns a
// discriminated result so callers (the /codex/model-status endpoint) can
// tell "genuinely no data yet" apart from "the RPC itself failed" and
// surface an honest reason instead of a bare null that looks like "still
// waiting for the first response".
async function codexGetUsage(): Promise<{ ok: true; data: unknown | null } | { ok: false; reason: string }> {
  // Freshest real signal: the account/rateLimits/updated notification the
  // app-server pushes automatically right after a turn completes (confirmed
  // by direct observation against the live process — see
  // codexHandleNotification's own case for it). Cheaper than another RPC
  // round-trip and strictly more current than a 60s-old poll.
  if (codexCachedUsage && Date.now() - codexCachedUsageAt < 60_000) {
    return { ok: true, data: codexCachedUsage }
  }
  try {
    await codexEnsureProc()
    const result = await codexRequest('account/rateLimits/read', undefined)
    const data = (result && typeof result === 'object' && 'rateLimits' in (result as any)) ? (result as any).rateLimits : null
    if (data) {
      codexCachedUsage = data
      codexCachedUsageAt = Date.now()
    }
    return { ok: true, data }
  } catch (err) {
    log('codex_usage_error', { error: String(err) })
    return { ok: false, reason: String(err) }
  }
}

// Real model catalog via Codex's own official `model/list` RPC (confirmed
// live against the authenticated app-server — NOT a hardcoded/copied list
// the way Claude Code's MODEL_IDS is). includeHidden:false asks the server
// itself to drop models this account can't actually use; kept anyway as a
// defensive filter in case that ever changes. Returns [] (hidden by the
// frontend) rather than any fabricated entry when the call fails — e.g.
// before Codex is logged in.
async function codexListModels(): Promise<Array<{ id: string; displayName: string; description: string; isDefault: boolean }>> {
  try {
    await codexEnsureProc()
    const result = await codexRequest('model/list', { includeHidden: false })
    const data = Array.isArray(result?.data) ? result.data : []
    codexModelList = data
      .filter((m: any) => m?.hidden !== true && typeof m?.id === 'string')
      .map((m: any) => ({ id: m.id, displayName: m.displayName || m.id, description: m.description || '', isDefault: !!m.isDefault }))
    return codexModelList
  } catch (err) {
    log('codex_model_list_error', { error: String(err) })
    return codexModelList // best-effort — keep last-known list rather than flashing empty on a transient failure
  }
}

// Persists the chosen model id and applies it starting the next turn/start
// on every Codex thread (main chat AND the separate gomoku thread) — no new
// thread required, so history/context survive a switch untouched (Codex's
// own protocol documents `model` as a turn/start override that also carries
// forward to subsequent turns on that same thread). Validated against the
// last-fetched real model list — never accepts an arbitrary/copied id.
async function codexSwitchModel(modelId: string): Promise<{ ok: boolean; reason?: string; model?: string; displayName?: string }> {
  if (codexCurrentTurnId) return { ok: false, reason: 'turn_in_progress' }
  let list = codexModelList
  if (!list.some((m) => m.id === modelId)) list = await codexListModels()
  const found = list.find((m) => m.id === modelId)
  if (!found) return { ok: false, reason: 'unknown model id' }
  codexSelectedModel = modelId
  codexModel = modelId
  saveCodexSelectedModel(modelId)
  return { ok: true, model: found.id, displayName: found.displayName }
}

// ---------- Codex gomoku (五子棋) — independent board + own dedicated thread ----------
//
// Claude Code's gomoku opponent above is driven by its own tmux/MCP
// tool-calling machinery (gomoku_move etc.) — Codex has no equivalent tool
// wiring, so this reimplements the same board/turn/legality/persistence
// contract using Codex's own app-server RPCs instead: a move-decision "turn"
// is a real turn/start on a SEPARATE, dedicated Codex thread (never the main
// chat thread, so a game never pollutes/contends with a real conversation),
// asking Codex to reply with a `[MOVE:row,col]` tag (the same bracket-tag
// convention useChat.js's [AC:...]/[MUSIC:...] already use for API-key
// providers) which is parsed out of its real reply text — never a local
// bot/algorithm choosing the move. Completely separate game state/file/
// thread/turn-tracking from Claude Code's — clearing, stopping, or resigning
// one can never affect the other, and both can be mid-turn at the same time.
const CODEX_GOMOKU_FILE = process.env.CODEX_GOMOKU_FILE ?? join(ROOT, 'state', 'codex-gomoku-game.json')
const CODEX_GOMOKU_THREAD_FILE = process.env.CODEX_GOMOKU_THREAD_FILE ?? join(ROOT, 'state', 'codex-gomoku-thread.json')
const CODEX_MOVE_TAG_RE = /\[MOVE:\s*(\d+)\s*,\s*(\d+)\s*\]/i
// Optional short social-reaction tag Codex may add alongside [MOVE:...] or
// [UNDO:...] during an automatic decision turn — the ONLY thing (besides the
// decision tag itself) allowed to reach game.messages during those turns;
// see codexApplyGomokuTurnResult and the undo-request handler, which use
// this instead of the raw reply text specifically so board analysis/
// coordinates/reasoning can never leak through even if the model still
// produces them. Capped short (matches gomoku_banter's own cap on CC's
// side) so it can only ever be a quick line, never a mini-essay.
const CODEX_BANTER_TAG_RE = /\[BANTER:\s*([^\]]{0,60})\]/i
function extractCodexBanter(text: string): string | null {
  const match = text.match(CODEX_BANTER_TAG_RE)
  if (!match) return null
  const banter = match[1].trim().slice(0, 40)
  return banter || null
}

function loadCodexGomokuGame(): GomokuGame | null {
  try {
    const parsed = JSON.parse(readFileSync(CODEX_GOMOKU_FILE, 'utf8'))
    if (parsed && Array.isArray(parsed.board)) {
      if (!Array.isArray(parsed.messages)) parsed.messages = []
      return parsed as GomokuGame
    }
    return null
  } catch {
    return null
  }
}
function saveCodexGomokuGame(game: GomokuGame | null) {
  try {
    mkdirSync(dirname(CODEX_GOMOKU_FILE), { recursive: true })
    if (game) writeFileSync(CODEX_GOMOKU_FILE, JSON.stringify(game))
    else if (existsSync(CODEX_GOMOKU_FILE)) unlinkSync(CODEX_GOMOKU_FILE)
  } catch (err) {
    log('codex_gomoku_save_error', { error: String(err) })
  }
}
function loadCodexGomokuThreadId(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(CODEX_GOMOKU_THREAD_FILE, 'utf8'))
    return typeof parsed?.threadId === 'string' ? parsed.threadId : null
  } catch {
    return null
  }
}
function saveCodexGomokuThreadId(id: string | null) {
  try {
    mkdirSync(dirname(CODEX_GOMOKU_THREAD_FILE), { recursive: true })
    if (id) writeFileSync(CODEX_GOMOKU_THREAD_FILE, JSON.stringify({ threadId: id }))
    else if (existsSync(CODEX_GOMOKU_THREAD_FILE)) unlinkSync(CODEX_GOMOKU_THREAD_FILE)
  } catch (err) {
    log('codex_gomoku_thread_save_error', { error: String(err) })
  }
}

let codexGomokuGame: GomokuGame | null = loadCodexGomokuGame()
let codexGomokuThreadId: string | null = loadCodexGomokuThreadId()
// Single-flight guard for the dedicated gomoku thread — entirely separate
// from codexCurrentTurnId (the main chat thread's own guard), so a gomoku
// move-decision in flight never blocks (or is blocked by) a real main-chat
// message, and vice versa.
let codexGomokuPending: { turnId: string; resolve: (r: { text: string; error?: string }) => void; agentText: string } | null = null

function broadcastCodexGomoku() {
  if (codexGomokuGame) broadcastGomoku(codexGomokuGame, 'codex')
}
function appendCodexGomokuChatMsg(msg: GomokuChatMsg) {
  if (!codexGomokuGame) return
  codexGomokuGame.messages.push(msg)
  if (codexGomokuGame.messages.length > 300) codexGomokuGame.messages.splice(0, codexGomokuGame.messages.length - 300)
  codexGomokuGame.updatedAt = Date.now()
  saveCodexGomokuGame(codexGomokuGame)
  broadcastCodexGomoku()
}

async function codexGomokuEnsureThread(): Promise<string> {
  await codexEnsureProc()
  if (codexGomokuThreadId) {
    try {
      await codexRequest('thread/resume', { threadId: codexGomokuThreadId })
      return codexGomokuThreadId
    } catch (err) {
      log('codex_gomoku_thread_resume_failed', { threadId: codexGomokuThreadId, error: String(err) })
      codexGomokuThreadId = null
    }
  }
  const result = await codexRequest('thread/start', { cwd: CODEX_WORKDIR, sandbox: 'workspace-write', approvalPolicy: 'on-request', developerInstructions: buildGomokuSeedInstructions() })
  codexGomokuThreadId = result?.thread?.id ?? null
  saveCodexGomokuThreadId(codexGomokuThreadId)
  if (!codexGomokuThreadId) throw new Error('codex gomoku thread/start returned no thread id')
  return codexGomokuThreadId
}

// Sends one turn on the dedicated gomoku thread and resolves once it
// genuinely completes (or fails) — see codexGomokuHandleNotification, which
// is what actually fulfills this promise from the live notification stream,
// the same request/response-over-notifications pattern codexRequest uses
// for direct RPCs, just keyed by turnId instead of request id.
async function codexGomokuSendTurn(instruction: string): Promise<{ text: string; error?: string }> {
  const threadId = await codexGomokuEnsureThread()
  const result = await codexRequest('turn/start', {
    threadId, input: [{ type: 'text', text: instruction, text_elements: [] }],
    ...(codexSelectedModel ? { model: codexSelectedModel } : {}),
  })
  const turnId = result?.turn?.id
  if (!turnId) return { text: '', error: 'codex did not return a turn id' }
  return new Promise((resolve) => {
    codexGomokuPending = { turnId, resolve, agentText: '' }
  })
}

function pickRandomEmptyGomokuCell(board: GomokuCell[][]): { row: number; col: number } | null {
  const empties: Array<{ row: number; col: number }> = []
  for (let r = 0; r < GOMOKU_BOARD_SIZE; r++) {
    for (let c = 0; c < GOMOKU_BOARD_SIZE; c++) {
      if (board[r][c] === 0) empties.push({ row: r, col: c })
    }
  }
  if (!empties.length) return null
  return empties[Math.floor(Math.random() * empties.length)]
}

// Returns true iff this move just ended the game (win/draw) — used to
// decide whether ONE short trailing remark (if the model included one) may
// be shown, vs the normal "never show per-move commentary" rule.
function applyCodexGomokuMove(row: number, col: number): boolean {
  if (!codexGomokuGame) return false
  codexGomokuGame.board[row][col] = 2
  codexGomokuGame.moves.push({ row, col, player: 'ai', ts: Date.now() })
  const won = gomokuCheckWin(codexGomokuGame.board, row, col, 2)
  codexGomokuGame.status = won ? 'ai_win' : (gomokuBoardFull(codexGomokuGame.board) ? 'draw' : 'playing')
  if (codexGomokuGame.status === 'playing') codexGomokuGame.turn = 'user'
  codexGomokuGame.updatedAt = Date.now()
  saveCodexGomokuGame(codexGomokuGame)
  broadcastCodexGomoku()
  return codexGomokuGame.status !== 'playing'
}

// Parses (and strips) a [MOVE:row,col] tag out of Codex's real reply text.
// isMoveTurn=false (a pure user-initiated in-game-chat turn, via
// codexNotifyGomokuChat) always shows whatever Codex said — that's the ONLY
// path real chat/analysis is allowed to reach game.messages from.
// isMoveTurn=true (an automatic move/undo decision) NEVER shows the raw
// reply text — analysis, coordinates, and reasoning are always discarded,
// even if the model still produces them (the prompt asks it not to, but
// this is enforced here too, structurally). The ONLY thing from a move turn
// that can reach game.messages is an explicit, capped [BANTER:...] tag (see
// extractCodexBanter) — a short emotional reaction, never board commentary,
// shown at most once per resolved move regardless of whether it ended the
// game. On a missing/illegal move, asks again (bounded retries, itself
// silent) before falling back to a random legal cell so the game can never
// stall forever — a legality fallback, not a fabricated "decision".
async function codexApplyGomokuTurnResult(gameId: string, text: string, error: string | undefined, isMoveTurn: boolean, retriesLeft = 2) {
  if (!codexGomokuGame || codexGomokuGame.id !== gameId) return
  if (error) {
    appendCodexGomokuChatMsg({ id: nextId(), from: 'model', text: `（对局出错：${error}）`, ts: Date.now() })
    return
  }
  const match = text.match(CODEX_MOVE_TAG_RE)

  if (!isMoveTurn) {
    const chatText = text.replace(CODEX_MOVE_TAG_RE, '').trim()
    if (chatText) appendCodexGomokuChatMsg({ id: nextId(), from: 'model', text: chatText, ts: Date.now() })
    return
  }

  const banter = extractCodexBanter(text)
  const board = codexGomokuGame.board
  const row = match ? Number(match[1]) : NaN
  const col = match ? Number(match[2]) : NaN
  const legal = Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < GOMOKU_BOARD_SIZE && col >= 0 && col < GOMOKU_BOARD_SIZE && board[row][col] === 0

  if (legal) {
    const ended = applyCodexGomokuMove(row, col)
    if (banter) appendCodexGomokuChatMsg({ id: nextId(), from: 'model', text: banter, ts: Date.now() })
    if (ended && codexGomokuGame) setGomokuRecap('codex', buildGomokuRecap(codexGomokuGame))
    return
  }
  if (retriesLeft > 0) {
    const why = match ? `(${row},${col}) 不是合法空位（可能越界或已被占用）` : '你的回复里没有找到合法的 [MOVE:行,列] 标记'
    const { text: retryText, error: retryError } = await codexGomokuSendTurn(
      `${why}。当前棋盘（0-14行列，●=用户/黑，○=你/白，.=空）：\n${gomokuBoardToText(board)}\n只回复一个合法空位，格式严格为 [MOVE:行,列]（行列 0-14 的整数），不要输出任何其他文字。`
    )
    await codexApplyGomokuTurnResult(gameId, retryText, retryError, true, retriesLeft - 1)
    return
  }
  // Exhausted retries — a legality fallback (never a fake "decision" in the
  // chat log), so a stuck/uncooperative reply can never stall the game.
  const fallback = pickRandomEmptyGomokuCell(board)
  if (fallback) {
    const ended = applyCodexGomokuMove(fallback.row, fallback.col)
    if (ended && codexGomokuGame) setGomokuRecap('codex', buildGomokuRecap(codexGomokuGame))
  }
}

// Fire-and-forget from the /gomoku/move handler's perspective — mirrors
// notifyCcOfGomokuTurn's own shape (the HTTP response returns as soon as the
// user's own move is applied; Codex's move arrives later via a live
// gomoku_update broadcast), so the request never hangs waiting on a full
// Codex turn.
async function codexNotifyGomokuTurn(game: GomokuGame, lastMove: { row: number; col: number }, clientTime?: unknown) {
  const instruction = clientTimeContextLine(clientTime) + `用户（黑子●）刚落子在 (${lastMove.row},${lastMove.col})，现在轮到你（白子○）了。当前棋盘（0-14行列，●=用户，○=你，.=空）：\n${gomokuBoardToText(game.board)}\n\n回复一个坐标标记，格式严格为 [MOVE:行,列]（行列均为 0-14 的整数），例如 [MOVE:7,8]。除此之外不要输出任何解释、理由或局势分析——这是自动落子，任何分析文字都会被丢弃，绝不会显示。如果想自然地带一句情绪反应（比如挑衅、夸奖、得意、懊恼），可以额外加一个 [BANTER:文字] 标记，例如 [MOVE:7,8][BANTER:这局我要赢回来]；完全可选，多数时候不需要加，且 BANTER 里只能是情绪/关系互动，绝不能包含坐标、局势判断或落子理由。只有当用户主动在棋局聊天框跟你说话时，你才需要正常聊天回应，那时才可以讲棋。`
  const { text, error } = await codexGomokuSendTurn(instruction)
  await codexApplyGomokuTurnResult(game.id, text, error, true)
}

async function codexNotifyGomokuChat(game: GomokuGame, text: string, voice: boolean, clientTime?: unknown) {
  const instruction = clientTimeContextLine(clientTime) + `用户在五子棋游戏界面里${voice ? '用语音' : ''}跟你说：「${text}」。这不是落子指令，只是边下棋边聊天，请自然回应，不需要输出任何 [MOVE:...] 标记，也不用报坐标。`
  const { text: replyText, error } = await codexGomokuSendTurn(instruction)
  await codexApplyGomokuTurnResult(game.id, replyText, error, false)
}

// ---------- Group chat (多AI群聊) — Codex side: one dedicated thread PER GROUP ----------
//
// Deliberately a real, separate Codex thread for each group chat — never the
// main single-chat thread, so group content structurally cannot leak into
// Codex's real single-chat memory (unlike Focus, which intentionally DOES
// share the main thread for real relationship continuity — group chat's own
// requirement is the opposite: "不把群聊消息混入各自单聊历史"). Each
// group's thread persists across turns (real accumulating memory of THAT
// group's own conversation), same pattern as codexGomokuThreadId just keyed
// per group instead of a single fixed game.
const GROUP_CODEX_THREADS_FILE = process.env.AI_COMPANION_GROUP_CODEX_THREADS_FILE ?? join(ROOT, 'state', 'group-codex-threads.json')
let groupCodexThreadIds: Record<string, string> = {}
function loadGroupCodexThreadIds() {
  try {
    const parsed = JSON.parse(readFileSync(GROUP_CODEX_THREADS_FILE, 'utf8'))
    groupCodexThreadIds = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    groupCodexThreadIds = {}
  }
}
function saveGroupCodexThreadIds() {
  try {
    mkdirSync(dirname(GROUP_CODEX_THREADS_FILE), { recursive: true })
    writeFileSync(GROUP_CODEX_THREADS_FILE, JSON.stringify(groupCodexThreadIds))
  } catch (err) {
    log('group_codex_threads_save_error', { error: String(err) })
  }
}
loadGroupCodexThreadIds()

async function groupCodexEnsureThread(chatId: string): Promise<string> {
  await codexEnsureProc()
  const existing = groupCodexThreadIds[chatId]
  if (existing) {
    try {
      await codexRequest('thread/resume', { threadId: existing })
      return existing
    } catch (err) {
      log('group_codex_thread_resume_failed', { chatId, threadId: existing, error: String(err) })
      delete groupCodexThreadIds[chatId]
    }
  }
  const result = await codexRequest('thread/start', { cwd: CODEX_WORKDIR, sandbox: 'workspace-write', approvalPolicy: 'on-request' })
  const threadId = result?.thread?.id ?? null
  if (!threadId) throw new Error('group codex thread/start returned no thread id')
  groupCodexThreadIds[chatId] = threadId
  saveGroupCodexThreadIds()
  return threadId
}

// Single-flight across ALL group threads at once (not per-group) — simple
// and sufficient for v1 (real verification only needs one active group);
// a second group's Codex turn while one is already in flight just gets
// skipped this round, same honest "busy, try next round" behavior
// groupInvokeCc already has.
let codexGroupPending: { threadId: string; chatId: string; phase: GroupTurnPhase; candidateId: string | null; resolve: () => void } | null = null

async function groupInvokeCodex(chatId: string, phase: GroupTurnPhase, instruction: string, candidateId?: string): Promise<void> {
  if (codexGroupPending) {
    if (phase === 'expand' && candidateId) groupRevertExpandFailure(chatId, candidateId, 'Codex 当前繁忙，请稍后重新批准')
    else groupAppendSystemNote(chatId, '（Codex 当前繁忙，这一轮先跳过）')
    return
  }
  let threadId: string
  try {
    threadId = await groupCodexEnsureThread(chatId)
  } catch (err) {
    if (phase === 'expand' && candidateId) groupRevertExpandFailure(chatId, candidateId, `Codex 发起失败：${String(err)}`)
    else groupAppendSystemNote(chatId, `（Codex 发起失败：${String(err)}）`)
    return
  }
  try {
    const result = await codexRequest('turn/start', {
      threadId, input: [{ type: 'text', text: instruction, text_elements: [] }],
      ...(codexSelectedModel ? { model: codexSelectedModel } : {}),
    })
    const turnId = result?.turn?.id
    if (!turnId) {
      if (phase === 'expand' && candidateId) groupRevertExpandFailure(chatId, candidateId, 'Codex 没有返回 turn id')
      else groupAppendSystemNote(chatId, '（Codex 没有返回 turn id，跳过）')
      return
    }
    await new Promise<void>((resolve) => {
      codexGroupPending = { threadId, chatId, phase, candidateId: candidateId ?? null, resolve }
    })
  } catch (err) {
    if (phase === 'expand' && candidateId) groupRevertExpandFailure(chatId, candidateId, String(err))
    else groupAppendSystemNote(chatId, `（Codex 出错：${String(err)}）`)
  }
}

// Routes notifications for whichever group thread currently has a pending
// turn — the actual state mutation (group_speak/group_request_to_speak/
// group_pass) already happened synchronously via the /internal/group/*
// bridge endpoints WHILE the turn was live (Codex's real tool call), so this
// only needs to resolve the awaiting groupInvokeCodex promise once the turn
// is genuinely done, exactly mirroring codexGomokuHandleNotification's own
// "just settle the pending promise" shape.
function codexGroupHandleNotification(method: string, params: any) {
  if (!codexGroupPending) return
  switch (method) {
    case 'turn/completed': {
      const pending = codexGroupPending
      codexGroupPending = null
      pending.resolve()
      break
    }
    case 'error': {
      if (params?.willRetry) break
      const pending = codexGroupPending
      codexGroupPending = null
      if (pending.phase === 'expand' && pending.candidateId) groupRevertExpandFailure(pending.chatId, pending.candidateId, codexFriendlyError(params?.error))
      else groupAppendSystemNote(pending.chatId, `（Codex 出错：${codexFriendlyError(params?.error)}）`)
      pending.resolve()
      break
    }
    case 'thread/status/changed': {
      if (params?.status?.type === 'systemError') {
        const pending = codexGroupPending
        codexGroupPending = null
        if (pending.phase === 'expand' && pending.candidateId) groupRevertExpandFailure(pending.chatId, pending.candidateId, 'Codex 出错了')
        else groupAppendSystemNote(pending.chatId, '（Codex 出错了）')
        pending.resolve()
      }
      break
    }
    default:
      break
  }
}

// ---------- Mystery game (剧本杀) — isolated per-(game,character) AI threads ----------
//
// Lets Claude Code and Codex (the two VPS-resident runtimes) join a group's
// mystery game as real AI players, without ever touching their own single-
// chat/group-chat conversation or Auto Memory. Unlike group chat — where CC
// shares its one resident session (with only a prompted identity boundary)
// and Codex gets its own per-group thread — a mystery-game character must
// know ONLY that character's own secret/task/clues, never CC's or Codex's
// real relationship with the user, never another character's secret, never
// the script's truth. So both runtimes get a genuinely separate, disposable
// identity here, one per (gameId, charId):
//
//   - Claude Code has no "extra thread" concept at all (it's a single
//     resident tmux/MCP session) — so this spins up a brand-new `claude`
//     process per character, in its own detached tmux session, with
//     --system-prompt REPLACING the default system prompt entirely (nothing
//     of CC's own persona/instructions leaks in), --tools "" (no file/bash/
//     memory-tool access at all — pure dialogue, so Auto Memory structurally
//     cannot be written from here even if somehow invoked), and
//     --strict-mcp-config with an empty server list (none of CC's real MCP
//     tools reachable). Runs in ONE shared scratch directory, pre-trusted
//     once (see ensureMysteryWorkspace) — safe to share across every
//     character/game since --tools "" means nothing in there is ever read
//     or written by any of them. The tmux session lives for the whole game
//     (real incremental memory of THIS character's own turns, verified live
//     against the actual CLI) and is only killed by mysteryCleanupGame. A
//     concurrency cap protects this VPS's limited memory from too many
//     simultaneous CC processes at once.
//   - Codex already has real per-thread isolation (see
//     groupCodexEnsureThread's own comment) — this just mirrors that exact
//     shape, keyed per character instead of per group, using
//     developerInstructions to carry the character's system prompt.
//
// Both paths are reached through ONE shared entrypoint, mysteryRunTurn, from
// POST /mystery/turn — the browser never talks to tmux or the codex
// app-server directly, same trust boundary as every other feature here.
// Model choice is a pure per-call parameter (CC: process launch flag;
// Codex: turn/start override) — neither path ever touches codexSelectedModel
// or the main brain's own tmux `/model` switch, so a game's model choice can
// never affect either runtime's real single-chat/group-chat model setting.

const MYSTERY_WORKSPACE_ROOT = process.env.AI_COMPANION_MYSTERY_DIR ?? join(ROOT, 'mystery-workspace')
const MYSTERY_EMPTY_MCP_PATH = join(MYSTERY_WORKSPACE_ROOT, '_empty-mcp.json')
const MYSTERY_CODEX_THREADS_FILE = process.env.AI_COMPANION_MYSTERY_CODEX_THREADS_FILE ?? join(ROOT, 'state', 'mystery-codex-threads.json')
const MYSTERY_CC_MAX_CONCURRENT = 4
const MYSTERY_CC_TURN_TIMEOUT_MS = 110_000
// 会被真正用到的清理路径只有三条：点"结束本局"/"删除群"、点"跳过"卡住的
// 回合、开下一局把上一局的旧会话清掉——都要求用户还在界面上、还记得点。
// 现场确认过（2026-08-04）：只要用户直接关掉页面/切走/断网，这些路径全都
// 不会触发，tmux 会话就原地挂着，`myst-cc-*` 数量只涨不跌。四条真实撞见的
// 挂账会话最老的接近 12 小时无任何输出，把 MYSTERY_CC_MAX_CONCURRENT=4 长期
// 占满，导致新开的剧本杀/牌局角色一上来就被"太多剧本杀 Claude Code 会话同时
// 进行"拒绝——这正是"cc 不开口"的真实根因，不是 CC 或登录本身坏了。
// 修法：tmux 本身就记录每个会话的 session_activity（最后一次有实际输入/
// 输出的时间），不用自己另开一份状态去追踪对不对得上；只在快要撞上限额时
// 才扫一遍并回收超过下面这个空闲阈值的会话——足够长，不会误杀正常对局里
// 人类还在思考、AI 还没轮到的正常间隙。
const MYSTERY_CC_IDLE_REAP_MS = 20 * 60 * 1000

function mysteryKey(gameId: string, charId: string): string {
  return `${gameId}::${charId}`
}
// tmux session names must be short/shell-safe; derived deterministically
// from gameId+charId so a channel-server restart (which happens every time
// this file itself is redeployed — see the brain's own respawn loop) can
// recover a still-alive session by name alone via tmux has-session, instead
// of needing its own separate id-bookkeeping file the way Codex threads do.
function mysteryCcTmuxName(gameId: string, charId: string): string {
  let h = 0
  const s = mysteryKey(gameId, charId)
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0 }
  return `myst-cc-${h.toString(36)}`
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function ensureMysteryWorkspace() {
  mkdirSync(MYSTERY_WORKSPACE_ROOT, { recursive: true })
  if (!existsSync(MYSTERY_EMPTY_MCP_PATH)) writeFileSync(MYSTERY_EMPTY_MCP_PATH, JSON.stringify({ mcpServers: {} }))
  // Pre-accept the workspace-trust dialog for this ONE shared scratch
  // directory, once, by writing directly into companion's own ~/.claude.json
  // — the same file that already pre-accepts the main brain's own
  // permission-bypass disclaimer (see dialog-guard.sh's own comment on that
  // mechanism). Every mystery CC process reuses this same directory
  // (harmless to share — --tools "" means nothing in there is ever touched),
  // so this only ever needs to run once per VPS, not once per game/character.
  try {
    const claudeJsonPath = join(process.env.HOME ?? '/home/companion', '.claude.json')
    const raw = JSON.parse(readFileSync(claudeJsonPath, 'utf8'))
    raw.projects = raw.projects || {}
    const existing = raw.projects[MYSTERY_WORKSPACE_ROOT]
    if (!existing?.hasTrustDialogAccepted) {
      raw.projects[MYSTERY_WORKSPACE_ROOT] = {
        allowedTools: [], mcpContextUris: [], mcpServers: {}, enabledMcpjsonServers: [], disabledMcpjsonServers: [],
        projectOnboardingSeenCount: 1,
        ...existing,
        hasTrustDialogAccepted: true,
      }
      writeFileSync(claudeJsonPath, JSON.stringify(raw))
      log('mystery_workspace_trusted', { path: MYSTERY_WORKSPACE_ROOT })
    }
  } catch (err) {
    log('mystery_trust_seed_error', { error: String(err) })
  }
}

async function tmuxHasSession(name: string): Promise<boolean> {
  const proc = Bun.spawn(['tmux', 'has-session', '-t', name], { stdout: 'ignore', stderr: 'ignore' })
  const code = await proc.exited
  return code === 0
}
async function tmuxCapture(name: string, lines = 4000): Promise<string> {
  const proc = Bun.spawn(['tmux', 'capture-pane', '-t', name, '-p', '-S', `-${lines}`], { stdout: 'pipe', stderr: 'ignore' })
  const out = await new Response(proc.stdout as ReadableStream).text()
  await proc.exited
  return out
}
async function tmuxKill(name: string): Promise<void> {
  const proc = Bun.spawn(['tmux', 'kill-session', '-t', name], { stdout: 'ignore', stderr: 'ignore' })
  await proc.exited
}
async function mysteryCcCountLive(): Promise<number> {
  const proc = Bun.spawn(['tmux', 'list-sessions', '-F', '#{session_name}'], { stdout: 'pipe', stderr: 'ignore' })
  const out = await new Response(proc.stdout as ReadableStream).text()
  await proc.exited
  return out.split('\n').filter((l) => l.startsWith('myst-cc-')).length
}

// Kills every myst-cc-* tmux session that's been silent (no keystroke/output,
// per tmux's own session_activity) longer than MYSTERY_CC_IDLE_REAP_MS —
// see that constant's comment for why this exists. Safe to call any time:
// a reaped session is just a disposable, on-demand-recreatable CC process
// (mysteryCcEnsureSession spins up a fresh one the next time that exact
// gameId+charId needs a turn), and clearing mysteryCcBusy here too means a
// reaped-while-marked-busy name can't wrongly report "上一轮还没结束" the
// next time that same tmux name gets reused.
async function mysteryCcReapIdle(): Promise<number> {
  const proc = Bun.spawn(['tmux', 'list-sessions', '-F', '#{session_name} #{session_activity}'], { stdout: 'pipe', stderr: 'ignore' })
  const out = await new Response(proc.stdout as ReadableStream).text()
  await proc.exited
  const now = Date.now()
  let reaped = 0
  for (const line of out.split('\n')) {
    const [name, activitySec] = line.trim().split(' ')
    if (!name || !name.startsWith('myst-cc-')) continue
    const idleMs = now - Number(activitySec) * 1000
    if (!Number.isFinite(idleMs) || idleMs < MYSTERY_CC_IDLE_REAP_MS) continue
    await tmuxKill(name)
    mysteryCcBusy.delete(name)
    reaped += 1
    log('mystery_cc_idle_reaped', { tmuxName: name, idleMs })
  }
  return reaped
}

// Confirmed live against the real CLI (v2.1.220): a completed turn always
// ends with exactly one line "✻ <PastTenseVerb> for Ns" (the verb is
// randomized — "Worked"/"Baked"/"Brewed"/... — only the shape is stable);
// while a turn is still running the pane instead shows "· <Verb>ing…". Only
// tested against per-LINE strings below (never the multi-line blob), so no
// 'm' flag is needed on the literal.
const DONE_MARKER_RE = /^✻ .+ for [\d.]+s$/
const TRUST_DIALOG_RE = /Quick safety check|trust the files in this folder/

async function mysteryCcWaitReady(tmuxName: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now()
  let trustAccepted = false
  while (Date.now() - start < timeoutMs) {
    const pane = await tmuxCapture(tmuxName, 60)
    if (!trustAccepted && TRUST_DIALOG_RE.test(pane)) {
      // Belt-and-suspenders: ensureMysteryWorkspace should already have this
      // directory pre-trusted, so this dialog should never actually appear —
      // but if it somehow does (e.g. ~/.claude.json write raced/failed),
      // don't hang forever; accept it live exactly like a human would.
      await Bun.spawn(['tmux', 'send-keys', '-t', tmuxName, 'Enter']).exited
      trustAccepted = true
      await new Promise((r) => setTimeout(r, 800))
      continue
    }
    if (pane.includes('bypass permissions on')) return
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('Claude Code 剧本杀会话启动超时')
}

// Real root cause of "CC 剧本杀发言异常缓慢" (diagnosed 2026-08-03, see the
// mysteryCcSendTurn/mysteryRunTurn diagnostic logging below for the actual
// before/after timing that confirmed this): `--setting-sources 'user'`
// pulled in companion's own ~/.claude/settings.json — which has
// `alwaysThinkingEnabled:true` + `effortLevel:"high"` set for the REAL
// resident brain's own relationship-quality conversations. Every mystery-
// game turn was silently inheriting that same "always think hard" behavior,
// which is entirely wrong for a quick, short in-character reply, and gets
// proportionally WORSE as a game goes on (buildTurnPrompt/
// buildFreeSpeechPrompt's own transcript-so-far grows every turn, so later
// chapters mean longer input to think hard over). Fixed by loading NO
// settings sources at all for these disposable sessions — every behavior
// they need (system prompt, model, tools, permissions, MCP) is already
// passed as an explicit CLI flag below, none of it depends on settings.json.
async function mysteryCcEnsureSession(gameId: string, charId: string, systemPrompt: string, model: string): Promise<string> {
  const tmuxName = mysteryCcTmuxName(gameId, charId)
  if (await tmuxHasSession(tmuxName)) return tmuxName
  let liveCount = await mysteryCcCountLive()
  if (liveCount >= MYSTERY_CC_MAX_CONCURRENT) {
    const reaped = await mysteryCcReapIdle()
    liveCount = reaped ? await mysteryCcCountLive() : liveCount
  }
  if (liveCount >= MYSTERY_CC_MAX_CONCURRENT) throw new Error('太多剧本杀 Claude Code 会话同时进行，请稍后再试')
  ensureMysteryWorkspace()
  // Desktop-pet scene peeks may include one explicitly user-approved screen
  // capture uploaded into UPLOAD_DIR.  Those isolated sessions get Read and
  // nothing else; ordinary mystery/poker characters keep the original empty
  // tool set, so their secrecy boundary is unchanged.
  const allowedTools = gameId.startsWith('desktop-pet:') ? 'Read' : ''
  const cmd = [
    'claude',
    '--system-prompt', shQuote(systemPrompt),
    '--model', shQuote(model),
    '--tools', shQuote(allowedTools),
    '--strict-mcp-config', '--mcp-config', shQuote(MYSTERY_EMPTY_MCP_PATH),
    '--permission-mode', 'bypassPermissions',
    '--setting-sources', shQuote(''),
    '--effort', 'low',
    '-n', shQuote(tmuxName),
  ].join(' ')
  log('mystery_cc_session_start', { gameId, charId, tmuxName, model, systemPromptLen: systemPrompt.length })
  const t0 = Date.now()
  // -y is intentionally huge (not a real terminal size a human would ever
  // use) — REAL SECOND root cause found alongside the paste-collapse one
  // (see mysteryCcSendTurn's own comment): confirmed live that with a
  // normal-looking pane height, Claude Code's ink UI (an alternate-screen
  // TUI, not a plain scrolling shell) only keeps roughly one screen's worth
  // of prior turns capturable via `tmux capture-pane -S` — older turns get
  // pushed out as new ones render, regardless of how large a -S window is
  // requested. mysteryCcSendTurn's own completion check DIFFS the count of
  // "✻ ... for Ns" markers before/after a turn — with a short pane, an old
  // marker can scroll out of view at the same time a new one appears,
  // leaving the count unchanged and the turn looking like it never
  // completed (confirmed live: a real turn finished in ~10s but was never
  // detected, sat polling for the full 110s timeout instead). Making the
  // pane tall enough that a full game's entire turn history comfortably
  // fits removes this failure mode for any realistic game length.
  const proc = Bun.spawn(['tmux', 'new-session', '-d', '-s', tmuxName, '-x', '200', '-y', '3000', '-c', MYSTERY_WORKSPACE_ROOT, cmd])
  await proc.exited
  try {
    await mysteryCcWaitReady(tmuxName)
  } catch (err) {
    await tmuxKill(tmuxName)
    log('mystery_cc_session_start_failed', { gameId, charId, tmuxName, elapsedMs: Date.now() - t0, error: String(err) })
    throw err
  }
  log('mystery_cc_session_ready', { gameId, charId, tmuxName, elapsedMs: Date.now() - t0 })
  return tmuxName
}

// Guards against two overlapping turns ever being sent into the SAME tmux
// pane at once (e.g. an abandoned/skip-but-still-running previous request
// racing a fresh one) — without this, two concurrent `tmux send-keys` into
// the same pane could interleave and corrupt both turns' input, and the
// marker-diff completion logic below could misattribute the OLD turn's
// completion marker to the NEW turn. Same shape as the existing
// mysteryCodexPendingByThread single-flight guard on the Codex side, just a
// Set instead of a Map since there's no promise to resolve here — a rejected
// second call gets an immediate, honest "busy" error instead of silently
// queuing or racing.
const mysteryCcBusy = new Set<string>()

// Sends exactly one turn to an already-ready mystery CC session and returns
// its reply text — parsed straight off the real rendered terminal screen
// (there is no MCP/tool-call channel for these disposable sessions, unlike
// the main brain), by diffing the count of "✻ ... for Ns" completion
// markers before/after and pulling the newest "●"-prefixed block out from
// between the previous marker and this new one.
//
// Multi-line instructions are flattened to a single line (newlines -> " | ")
// before sending: tmux has no safe way to paste a literal embedded newline
// into this UI without it being read as a separate premature Enter —
// confirmed live (a naive tmux paste-buffer with real newlines submitted
// each line as its own message instead of one combined turn).
//
// REAL root cause of "CC 每次发言都异常缓慢" (diagnosed 2026-08-03 with a
// live side-by-side repro — see PENDING_PASTE_RE below): `tmux send-keys -l`
// delivers the whole flattened instruction as one instantaneous burst of
// characters. Once that burst is long enough (confirmed live: a realistic
// mid-game instruction of ~1800 chars triggers it; short test messages
// under ~100 chars never did), Claude Code's own input box treats it as a
// PASTE and collapses it to a placeholder "[Pasted text #1 +N lines]" —
// which needs its OWN Enter to actually submit, on top of the one that
// normally submits a typed line. Sending only one Enter (the old code) left
// the real instruction sitting unsubmitted in the input box forever: no
// error, no tool call, nothing — CC's turn just never started, and the
// existing 110s timeout (or, before that existed, no timeout at all) is
// exactly the "long silence, eventually gives up" symptom that was
// reported. Confirmed the fix live too: sending a second Enter at that point
// immediately submitted the pasted block and the turn proceeded normally.
// This check runs on every poll iteration below (not just once right after
// sending) since the collapse can take a moment to render.
//
// 2026-08-04 追加的真实根因（用户报告"cc在剧本杀里还是不说话"，现场
// 抓到卡了 110 秒的会话画面确认）：Claude Code v2.1.221 对这种长度的
// 单行长指令（实测 ~688 字符）**不再**折叠成 "[Pasted text]" 占位符——
// 指令全文原样留在输入框里，而紧跟着发出的那个 Enter 仍然会被输入框的
// 粘贴防抖吞掉（被当作字符爆发的一部分）。于是上面的占位符检测一次都
// 不会命中，第一次轮询就把 confirmedSubmitted 置真、从此不再补 Enter，
// 消息在输入框里坐满 110 秒直到超时。现场只补发了一个 Enter，消息立即
// 提交、回复正常生成——所以判定"是否已提交"不能依赖占位符长什么样，
// 必须直接看输入框本身：pane 里最后一行以"❯"开头的就是输入框（已提交
// 的消息虽然也会以"❯"回显在上方的对话记录里，但输入框永远是最后一个），
// 它还包含指令开头 = 还没提交 = 补 Enter。提交成功后这一行会变成空的
// "❯ "。占位符情况也顺带被覆盖（那时最后的❯行是 [Pasted text...]，
// 同样不含指令开头，由 PENDING_PASTE_RE 单独兜住）。
const PENDING_PASTE_RE = /\[Pasted text/

async function mysteryCcSendTurn(gameId: string, charId: string, tmuxName: string, instruction: string, signal?: AbortSignal, timeoutMs = MYSTERY_CC_TURN_TIMEOUT_MS): Promise<string> {
  if (mysteryCcBusy.has(tmuxName)) throw new Error('Claude Code 这个角色上一轮还没结束')
  mysteryCcBusy.add(tmuxName)
  const tQueued = Date.now()
  try {
    const flat = instruction.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim()).filter(Boolean).join(' | ')
    const before = await tmuxCapture(tmuxName)
    const beforeCount = before.split('\n').filter((l) => DONE_MARKER_RE.test(l.trim())).length
    const tProcessingStart = Date.now()
    await Bun.spawn(['tmux', 'send-keys', '-t', tmuxName, '-l', '--', flat]).exited
    // 先让输入框把这波字符爆发"消化"完再回车——回车如果跟得太紧会被
    // 粘贴防抖当成爆发的一部分吞掉（见 PENDING_PASTE_RE 上方的说明）。
    // 这只是降低概率，真正的保险是下面轮询里的"输入框还有字就补 Enter"。
    await new Promise((r) => setTimeout(r, 250))
    await Bun.spawn(['tmux', 'send-keys', '-t', tmuxName, 'Enter']).exited
    const tSent = Date.now()
    log('mystery_cc_turn_sent', { gameId, charId, tmuxName, instructionLen: flat.length, queueWaitMs: tProcessingStart - tQueued })
    const start = Date.now()
    let loggedFirstContent = false
    let confirmedSubmitted = false
    let pasteConfirmAttempts = 0
    while (Date.now() - start < timeoutMs) {
      // The browser aborted (user clicked "跳过") — stop polling and release
      // mysteryCcBusy right away instead of riding out the full timeout, so
      // this character's NEXT turn is never left waiting on an abandoned
      // one. The tmux session itself is left exactly as-is (still real,
      // still reusable) — only THIS poll gives up.
      if (signal?.aborted) throw new Error('已跳过')
      await new Promise((r) => setTimeout(r, 900))
      if (signal?.aborted) throw new Error('已跳过')
      // 真实根因（2026-08-04 复现确认）：结束本局 / 删除存档会直接
      // tmuxKill 掉这个角色的会话（见 mysteryCleanupGame），但那是一个
      // *另外的* HTTP 请求触发的，跟这个仍在轮询的请求没有任何联系——它的
      // req.signal 不会被 abort，只能靠自己发现"我在等的会话已经不存在了"
      // 才能提前退出。没有这条检查时，这个轮询会傻等到完整的 110 秒超时
      // 才释放 mysteryCcBusy，期间这个角色的任何新发言请求都会被"上一轮
      // 还没结束"直接拒绝——这正是"结束本局后 CC 长期不说话"的真实原因，
      // 不是模型变慢，是清理和轮询之间没有互相通知。
      if (!(await tmuxHasSession(tmuxName))) throw new Error('Claude Code 会话已被清理，请重新开始这一局')
      const pane = await tmuxCapture(tmuxName)
      const lines = pane.split('\n')
      // See PENDING_PASTE_RE's comment above — 判定"消息真的提交了没有"。
      // 输入框 = pane 里最后一行以"❯"开头的行；它还含指令开头（或粘贴
      // 占位符）就说明 Enter 被吞了，补一个。空转补 Enter 是无害的
      // （输入框为空时 Enter 是 no-op），所以宁可多补不可漏补。
      if (!confirmedSubmitted) {
        const promptLines = lines.filter((l) => l.trimStart().startsWith('❯'))
        const lastPrompt = promptLines.length ? promptLines[promptLines.length - 1] : ''
        const head = flat.slice(0, 12)
        const stillInBox = PENDING_PASTE_RE.test(lastPrompt) || (head.length > 0 && lastPrompt.includes(head))
        if (stillInBox) {
          if (pasteConfirmAttempts < 10) {
            pasteConfirmAttempts++
            log('mystery_cc_unsubmitted_input_detected', { gameId, charId, tmuxName, attempt: pasteConfirmAttempts })
            await Bun.spawn(['tmux', 'send-keys', '-t', tmuxName, 'Enter']).exited
          }
          continue
        }
        confirmedSubmitted = true
      }
      const markerIdxs: number[] = []
      lines.forEach((l, i) => { if (DONE_MARKER_RE.test(l.trim())) markerIdxs.push(i) })
      // 诊断用：第一次在 pane 里看到"●"（真正的内容气泡，不是working spinner）
      // 时打一条日志，近似"首个内容到达时间"——不追求逐字精确，只用来确认
      // "卡在哪一步"：如果这条日志迟迟不出现，说明请求根本没真正开始处理
      // 或者压根没发到模型；如果这条很快出现但 marker 迟迟不出现，说明是
      // 在"生成中"耗时长（很可能是 extended thinking），而不是没发出去。
      if (!loggedFirstContent && lines.some((l) => l.trimStart().startsWith('●'))) {
        loggedFirstContent = true
        log('mystery_cc_first_content', { gameId, charId, tmuxName, firstContentMs: Date.now() - tSent })
      }
      if (markerIdxs.length > beforeCount) {
        const endIdx = markerIdxs[markerIdxs.length - 1]
        const startIdx = markerIdxs.length > 1 ? markerIdxs[markerIdxs.length - 2] : 0
        const block = lines.slice(startIdx + 1, endIdx)
        const hadThinking = block.some((l) => /^\s*Thought for \d+s/.test(l))
        log('mystery_cc_turn_complete', { gameId, charId, tmuxName, totalMs: Date.now() - tSent, hadThinking })
        const bulletIdx = block.findIndex((l) => l.trimStart().startsWith('●'))
        if (bulletIdx === -1) return ''
        const replyLines = block.slice(bulletIdx)
        replyLines[0] = replyLines[0].replace(/^\s*●\s?/, '')
        const paragraphs: string[] = []
        let current: string[] = []
        for (const l of replyLines) {
          const t = l.trim()
          if (!t) {
            if (current.length) { paragraphs.push(current.join(' ')); current = [] }
            continue
          }
          current.push(t)
        }
        if (current.length) paragraphs.push(current.join(' '))
        return paragraphs.join('\n\n').trim()
      }
    }
    log('mystery_cc_turn_timeout', { gameId, charId, tmuxName, timeoutMs })
    throw new Error('Claude Code 剧本杀会话响应超时')
  } finally {
    mysteryCcBusy.delete(tmuxName)
  }
}

// ---- Codex side: one dedicated thread per (game, character) — same shape
// as groupCodexEnsureThread, just keyed per character instead of per group ----
let mysteryCodexThreads: Record<string, string> = {}
function loadMysteryCodexThreads() {
  try {
    const parsed = JSON.parse(readFileSync(MYSTERY_CODEX_THREADS_FILE, 'utf8'))
    mysteryCodexThreads = parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    mysteryCodexThreads = {}
  }
}
function saveMysteryCodexThreads() {
  try {
    mkdirSync(dirname(MYSTERY_CODEX_THREADS_FILE), { recursive: true })
    writeFileSync(MYSTERY_CODEX_THREADS_FILE, JSON.stringify(mysteryCodexThreads))
  } catch (err) {
    log('mystery_codex_threads_save_error', { error: String(err) })
  }
}
loadMysteryCodexThreads()

async function mysteryCodexEnsureThread(gameId: string, charId: string, systemPrompt: string): Promise<string> {
  await codexEnsureProc()
  const key = mysteryKey(gameId, charId)
  const existing = mysteryCodexThreads[key]
  if (existing) {
    try {
      await codexRequest('thread/resume', { threadId: existing })
      return existing
    } catch (err) {
      log('mystery_codex_thread_resume_failed', { key, threadId: existing, error: String(err) })
      delete mysteryCodexThreads[key]
    }
  }
  const result = await codexRequest('thread/start', { cwd: CODEX_WORKDIR, sandbox: 'workspace-write', approvalPolicy: 'on-request', developerInstructions: systemPrompt })
  const threadId = result?.thread?.id ?? null
  if (!threadId) throw new Error('mystery codex thread/start returned no thread id')
  mysteryCodexThreads[key] = threadId
  saveMysteryCodexThreads()
  return threadId
}

// Single-flight PER THREAD (not global the way codexGroupPending/
// codexGomokuPending are) — different mystery characters' turns never
// contend with each other, only with a second concurrent turn on that exact
// same character's own thread, which the frontend's own turn-based engine
// never actually attempts.
const mysteryCodexPendingByThread = new Map<string, { turnId: string; resolve: (r: { text: string; error?: string }) => void; agentText: string }>()

function mysteryCodexHandleNotification(threadId: string, method: string, params: any) {
  const pending = mysteryCodexPendingByThread.get(threadId)
  if (!pending) return
  switch (method) {
    case 'item/completed': {
      if (params?.item?.type === 'agentMessage') pending.agentText = params.item.text ?? pending.agentText
      break
    }
    case 'turn/completed': {
      if (params?.turn?.id !== pending.turnId) break
      mysteryCodexPendingByThread.delete(threadId)
      const status = params?.turn?.status
      if (status === 'failed') pending.resolve({ text: '', error: params?.turn?.error?.message ? codexFriendlyError(params.turn.error) : 'Codex 出错了' })
      else if (status === 'interrupted') pending.resolve({ text: '', error: '已中断' })
      else pending.resolve({ text: pending.agentText })
      break
    }
    case 'error': {
      if (params?.willRetry) break
      mysteryCodexPendingByThread.delete(threadId)
      pending.resolve({ text: '', error: codexFriendlyError(params?.error) })
      break
    }
    case 'thread/status/changed': {
      if (params?.status?.type === 'systemError') {
        mysteryCodexPendingByThread.delete(threadId)
        pending.resolve({ text: '', error: 'Codex 出错了' })
      }
      break
    }
    default:
      break
  }
}

async function mysteryCodexSendTurn(gameId: string, charId: string, systemPrompt: string, instruction: string, model: string, imageUrl = ''): Promise<{ text: string; error?: string }> {
  const threadId = await mysteryCodexEnsureThread(gameId, charId, systemPrompt)
  if (mysteryCodexPendingByThread.has(threadId)) return { text: '', error: 'Codex 这个角色上一轮还没结束' }
  const input: any[] = [{ type: 'text', text: instruction, text_elements: [] }]
  if (imageUrl) input.push({ type: 'image', url: imageUrl })
  const result = await codexRequest('turn/start', {
    threadId, input,
    ...(model ? { model } : {}),
  })
  const turnId = result?.turn?.id
  if (!turnId) return { text: '', error: 'Codex 没有返回 turn id' }
  return new Promise((resolve) => {
    mysteryCodexPendingByThread.set(threadId, { turnId, resolve, agentText: '' })
  })
}

// 临时诊断（2026-08-03，排查"CC 剧本杀发言异常缓慢"用）：记录这次调用真实
// 收到的 runtime/model/来源 和 prompt 长度，配合 mysteryCcSendTurn 里的
// queueWaitMs/firstContentMs/totalMs/hadThinking，可以完整比对"轮到该成员
// 的时间"到"完整响应时间"每一步耗时，而不用只靠前端的"感觉很慢"。
async function mysteryRunTurn(gameId: string, charId: string, runtime: 'claude-code' | 'codex', model: string, systemPrompt: string, instruction: string, signal?: AbortSignal, imageUrl = '', imagePath = ''): Promise<{ text: string } | { error: string }> {
  const tAssigned = Date.now()
  log('mystery_turn_received', {
    gameId, charId, runtime, model,
    systemPromptLen: systemPrompt.length, instructionLen: instruction.length,
  })
  try {
    if (runtime === 'claude-code') {
      const tmuxName = await mysteryCcEnsureSession(gameId, charId, systemPrompt, model)
      const modelInstruction = imagePath
        ? `先用 Read 查看用户明确授权的当前屏幕截图 ${imagePath}，再回应；不要提路径、文件或工具。\n\n${instruction}`
        : instruction
      const text = await mysteryCcSendTurn(gameId, charId, tmuxName, modelInstruction, signal)
      log('mystery_turn_done', { gameId, charId, runtime, totalMs: Date.now() - tAssigned })
      if (!text.trim()) return { error: 'Claude Code 没有给出有效回复' }
      return { text: text.trim() }
    }
    const result = await mysteryCodexSendTurn(gameId, charId, systemPrompt, instruction, model, imageUrl)
    log('mystery_turn_done', { gameId, charId, runtime, totalMs: Date.now() - tAssigned })
    if (result.error || !result.text.trim()) return { error: result.error || 'Codex 没有给出有效回复' }
    return { text: result.text.trim() }
  } catch (err) {
    log('mystery_turn_error', { gameId, charId, runtime, totalMs: Date.now() - tAssigned, error: String(err) })
    return { error: String((err as Error)?.message || err) }
  }
}

// Tears down every real resource this game ever created for the given
// character ids — the CC tmux session (if still alive) and the persisted
// Codex thread mapping (Codex's own thread stays on the app-server until
// process restart, but forgetting our id here means the next game/character
// reusing this same key always starts a genuinely fresh thread, never
// resumes stale content). Idempotent — safe to call for characters that
// never actually got a turn (no tmux session, no thread id ever created).
async function mysteryCleanupGame(gameId: string, charIds: string[]): Promise<void> {
  for (const charId of charIds) {
    const key = mysteryKey(gameId, charId)
    const tmuxName = mysteryCcTmuxName(gameId, charId)
    if (await tmuxHasSession(tmuxName)) await tmuxKill(tmuxName)
    if (mysteryCodexThreads[key]) delete mysteryCodexThreads[key]
  }
  saveMysteryCodexThreads()
}

// ---------- public server: 127.0.0.1:PORT (the only port cloudflared forwards) ----------

Bun.serve<{ authed: true }>({
  port: PORT,
  hostname: '127.0.0.1',
  async fetch(req, server) {
    const url = new URL(req.url)
    const origin = req.headers.get('origin')

    if (url.pathname === '/health') {
      return jsonResponse({ status: 'ok', ts: Date.now() })
    }

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeadersFor(origin) })
    }

    // ---- self-hosted login page (no third-party scripts) ----
    if (url.pathname === '/login' && req.method === 'GET') {
      const returnParam = url.searchParams.get('return') || ''
      const safeReturn = ALLOWED_ORIGINS.has(returnParam) ? returnParam : DEFAULT_RETURN_URL
      return new Response(loginPageHtml(safeReturn), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-content-type-options': 'nosniff',
          'content-security-policy':
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
            "img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        },
      })
    }

    // ---- token -> HttpOnly session cookie exchange ----
    if (url.pathname === '/auth/login' && req.method === 'POST') {
      if (!originOk(req)) {
        log('origin_reject', { path: url.pathname, origin })
        return jsonResponse({ error: 'origin not allowed' }, { status: 403 })
      }
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const t = typeof (body as any)?.token === 'string' ? (body as any).token : ''
      if (t !== TOKEN) {
        log('auth_reject', { path: url.pathname, method: req.method })
        return jsonResponse({ error: 'invalid token' }, { status: 401, headers: cors })
      }
      log('login_ok', {})
      return jsonResponse({ ok: true }, { headers: { ...cors, 'set-cookie': SET_COOKIE } })
    }

    if (url.pathname === '/auth/logout' && req.method === 'POST') {
      const cors = corsHeadersFor(origin)
      return jsonResponse({ ok: true }, { headers: { ...cors, 'set-cookie': CLEAR_COOKIE } })
    }

    if (url.pathname === '/auth/status' && req.method === 'GET') {
      if (!originOk(req)) {
        log('origin_reject', { path: url.pathname, origin })
        return jsonResponse({ error: 'origin not allowed' }, { status: 403 })
      }
      const cors = corsHeadersFor(origin)
      return jsonResponse({ loggedIn: cookieAuthOk(req) }, { headers: cors })
    }

    // ---- shared auth gate for everything below: precise Origin + cookie ----
    const authGate = (): Response | null => {
      if (!originOk(req)) {
        log('origin_reject', { path: url.pathname, origin })
        return jsonResponse({ error: 'origin not allowed' }, { status: 403 })
      }
      if (!cookieAuthOk(req)) {
        log('auth_reject', { path: url.pathname, method: req.method })
        return jsonResponse({ error: 'unauthorized' }, { status: 401, headers: corsHeadersFor(origin) })
      }
      return null
    }

    // ---- statusLine-fed usage/model status ----
    if (url.pathname === '/status' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      return jsonResponse(readStatus(), { headers: corsHeadersFor(origin) })
    }

    // 心潮 (xinchao) — same cookie/Origin gate as everything else here.
    // Reads xinchao's own /v1/state+/v1/intent (never proxies its Bearer
    // token to the browser) and returns only the already-sanitized display
    // shape — no raw drive numbers, no session overlay ids, no tokens.
    if (url.pathname === '/xinchao/status' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const runtime = url.searchParams.get('runtime') === 'codex' ? 'codex' : 'claude-code'
      const sessionId = runtime === 'codex' ? XINCHAO_CODEX_SESSION_ID : XINCHAO_CC_SESSION_ID
      const summary = await fetchXinchaoSummary(sessionId)
      if (!summary) return jsonResponse({ available: false }, { headers: corsHeadersFor(origin) })
      return jsonResponse({ available: true, ...xinchaoFrontendPayload(summary) }, { headers: corsHeadersFor(origin) })
    }

    // ---- Codex (codex-vps) — same cookie/Origin gate as everything else.
    // Opening this (GET /codex/state) is what lazily spawns/resumes the
    // real codex app-server process and thread — nothing runs before the
    // window is actually opened.
    if (url.pathname === '/codex/state' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      const sessionId = normalizeCodexSessionId(url.searchParams.get('sessionId'))
      const state = sessionId === DEFAULT_CODEX_SESSION_ID ? null : getExtraCodexSession(sessionId)
      try {
        if (state) await codexEnsureExtraThread(state)
        else await codexEnsureThread()
      } catch (err) {
        log('codex_ensure_thread_error', { sessionId, error: String(err) })
      }
      const usage = await codexGetUsage()
      if (state) {
        return jsonResponse({
          sessionId, history: state.history, status: state.status, openTurnId: state.currentTurnId,
          threadId: state.threadId, model: codexModel, prompt: state.prompt, usage,
        }, { headers: cors })
      }
      return jsonResponse({
        sessionId, history: codexHistory, status: codexStatus, openTurnId: codexCurrentTurnId,
        threadId: codexThreadId, model: codexModel, prompt: getCodexPrompt(sessionId), usage,
      }, { headers: cors })
    }

    // Prompt is persisted independently per browser conversation. Saving it
    // never changes model/memory/other sessions. Thread reconfiguration is
    // intentionally deferred to the next accepted message, so a prompt edit
    // can never race an in-flight turn; that message performs thread/resume
    // (or the safe fork/start fallback) before its turn/start.
    if (url.pathname === '/codex/prompt' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try { body = await req.json() } catch { return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors }) }
      const sessionId = normalizeCodexSessionId((body as any)?.sessionId)
      if (typeof (body as any)?.prompt !== 'string') return jsonResponse({ error: 'missing prompt' }, { status: 400, headers: cors })
      const prompt = setCodexPrompt(sessionId, (body as any).prompt)
      let threadId: string | null = codexThreadId
      if (sessionId !== DEFAULT_CODEX_SESSION_ID) {
        const state = getExtraCodexSession(sessionId)
        state.prompt = prompt
        saveExtraCodexSession(state)
        threadId = state.threadId
      }
      return jsonResponse({ ok: true, sessionId, prompt, threadId, appliesFrom: 'next_message' }, { headers: cors })
    }

    // Display-history parity with the CC window. These mutations change the
    // persisted chat transcript shown in Eunoia; like CC's existing delete/
    // edit controls, they do not pretend to erase words already present in a
    // stateful model thread.
    if (url.pathname === '/codex/message/delete' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try { body = await req.json() } catch { return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors }) }
      const sessionId = normalizeCodexSessionId((body as any)?.sessionId)
      const messageId = typeof (body as any)?.messageId === 'string' ? (body as any).messageId : ''
      if (!messageId) return jsonResponse({ error: 'missing message id' }, { status: 400, headers: cors })
      const state = sessionId === DEFAULT_CODEX_SESSION_ID ? null : getExtraCodexSession(sessionId)
      const targetHistory = state ? state.history : codexHistory
      const idx = targetHistory.findIndex((message) => message.id === messageId)
      if (idx === -1) return jsonResponse({ error: 'not found' }, { status: 404, headers: cors })
      if (targetHistory[idx].streaming) return jsonResponse({ error: 'message is still streaming' }, { status: 409, headers: cors })
      const attachedFilePath = targetHistory[idx].filePath
      targetHistory.splice(idx, 1)
      if (state) {
        saveExtraCodexSession(state)
        broadcastExtraCodex(state, { type: 'codex_msg_deleted', id: messageId })
      } else {
        saveCodexHistory()
        broadcastCodex({ type: 'codex_msg_deleted', id: messageId })
      }
      if (attachedFilePath?.startsWith(UPLOAD_DIR + '/') && attachedFilePath.split('/').at(-1)?.includes('-file-')) {
        try { if (existsSync(attachedFilePath)) unlinkSync(attachedFilePath) } catch (err) { log('file_delete_error', { path: attachedFilePath, error: String(err) }) }
      }
      return jsonResponse({ ok: true, sessionId, messageId }, { headers: cors })
    }

    if (url.pathname === '/codex/message/edit' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try { body = await req.json() } catch { return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors }) }
      const sessionId = normalizeCodexSessionId((body as any)?.sessionId)
      const messageId = typeof (body as any)?.messageId === 'string' ? (body as any).messageId : ''
      const text = typeof (body as any)?.text === 'string' ? (body as any).text.trim() : ''
      if (!messageId || !text) return jsonResponse({ error: 'missing message id or text' }, { status: 400, headers: cors })
      const state = sessionId === DEFAULT_CODEX_SESSION_ID ? null : getExtraCodexSession(sessionId)
      const targetHistory = state ? state.history : codexHistory
      const message = targetHistory.find((item) => item.id === messageId)
      if (!message) return jsonResponse({ error: 'not found' }, { status: 404, headers: cors })
      if (message.streaming) return jsonResponse({ error: 'message is still streaming' }, { status: 409, headers: cors })
      if (state) extraUpdateMsg(state, messageId, { text })
      else codexUpdateMsg(messageId, { text })
      return jsonResponse({ ok: true, sessionId, messageId, text }, { headers: cors })
    }

    // Codex memory is a separate, per-session Markdown store. It is never
    // read from or written to Claude Code's MEMORY_DIR; its contents are
    // appended to that session's developer instructions on the next Codex
    // message, so edits are real model context rather than UI-only notes.
    if (url.pathname === '/codex/memory/list' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const sessionId = normalizeCodexSessionId(url.searchParams.get('sessionId'))
      return jsonResponse({ sessionId, files: listCodexMemoryFiles(sessionId) }, { headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/codex/memory/get' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      const sessionId = normalizeCodexSessionId(url.searchParams.get('sessionId'))
      const name = url.searchParams.get('name') ?? ''
      const path = safeCodexMemoryPath(sessionId, name)
      if (!path) return jsonResponse({ error: 'invalid filename' }, { status: 400, headers: cors })
      if (!existsSync(path)) return jsonResponse({ error: 'not found' }, { status: 404, headers: cors })
      try {
        const st = statSync(path)
        return jsonResponse({ sessionId, name, content: readFileSync(path, 'utf8'), size: st.size, mtime: st.mtimeMs }, { headers: cors })
      } catch (err) {
        log('codex_memory_get_error', { sessionId, name, error: String(err) })
        return jsonResponse({ error: 'read failed' }, { status: 500, headers: cors })
      }
    }

    if (url.pathname === '/codex/memory/put' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try { body = await req.json() } catch { return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors }) }
      const sessionId = normalizeCodexSessionId((body as any)?.sessionId)
      const name = typeof (body as any)?.name === 'string' ? (body as any).name : ''
      const content = typeof (body as any)?.content === 'string' ? (body as any).content : null
      const path = safeCodexMemoryPath(sessionId, name)
      if (!path || content === null) return jsonResponse({ error: 'invalid filename or content' }, { status: 400, headers: cors })
      const contentBytes = Buffer.byteLength(content, 'utf8')
      if (contentBytes > MEMORY_FILE_MAX_BYTES) return jsonResponse({ error: 'file too large', maxBytes: MEMORY_FILE_MAX_BYTES }, { status: 413, headers: cors })
      if (codexMemoryDirTotalBytes(sessionId, name) + contentBytes > MEMORY_DIR_MAX_BYTES) {
        return jsonResponse({ error: 'memory directory quota exceeded', maxBytes: MEMORY_DIR_MAX_BYTES }, { status: 413, headers: cors })
      }
      try {
        mkdirSync(codexMemoryDir(sessionId), { recursive: true })
        backupCodexMemoryFile(sessionId, name, path)
        writeFileSync(path, content, 'utf8')
        const st = statSync(path)
        log('codex_memory_put', { sessionId, name, bytes: contentBytes })
        return jsonResponse({ ok: true, sessionId, name, size: st.size, mtime: st.mtimeMs, appliesFrom: 'next_message' }, { headers: cors })
      } catch (err) {
        log('codex_memory_put_error', { sessionId, name, error: String(err) })
        return jsonResponse({ error: 'write failed' }, { status: 500, headers: cors })
      }
    }

    if (url.pathname === '/codex/memory/delete' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try { body = await req.json() } catch { return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors }) }
      const sessionId = normalizeCodexSessionId((body as any)?.sessionId)
      const name = typeof (body as any)?.name === 'string' ? (body as any).name : ''
      const path = safeCodexMemoryPath(sessionId, name)
      if (!path) return jsonResponse({ error: 'invalid filename' }, { status: 400, headers: cors })
      if (!existsSync(path)) return jsonResponse({ error: 'not found' }, { status: 404, headers: cors })
      try {
        backupCodexMemoryFile(sessionId, name, path)
        unlinkSync(path)
        log('codex_memory_delete', { sessionId, name })
        return jsonResponse({ ok: true, sessionId, name, appliesFrom: 'next_message' }, { headers: cors })
      } catch (err) {
        log('codex_memory_delete_error', { sessionId, name, error: String(err) })
        return jsonResponse({ error: 'delete failed' }, { status: 500, headers: cors })
      }
    }

    // Lightweight, frequently-pollable status (current real model + real
    // usage + real model catalog) — deliberately separate from /codex/state
    // above so a UI status widget polling this on a timer (matching how the
    // Claude Code crystal-usage-orb already polls /status) never has to also
    // pull the full (potentially long) codexHistory array on every tick.
    if (url.pathname === '/codex/model-status' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      const [usageResult, models] = await Promise.all([codexGetUsage(), codexListModels()])
      const current = models.find((m) => m.id === codexModel)
      // usage: the real (unwrapped) rateLimits object, or null.
      // usageUnavailable: present ONLY when there's a real reason usage
      // can't be shown right now (RPC failed, e.g. not logged in) — the
      // frontend uses this to show that reason instead of a generic
      // "waiting for first response", which would be dishonest once we
      // genuinely know why it's missing. Absent (not just null) when usage
      // is simply legitimately not available yet with no error.
      return jsonResponse({
        model: codexModel ? { id: codexModel, displayName: current?.displayName || codexModel } : null,
        models,
        usage: usageResult.ok ? usageResult.data : null,
        // Real capture time of `usage` above — codexCachedUsageAt is set both
        // by the 60s-TTL poll-cache path AND by the account/rateLimits/updated
        // push notification that arrives automatically right after every real
        // turn (see codexHandleNotification) — so this is never staler than
        // ~60s even with zero polling, and near-instant right after a turn.
        // null only when usage itself has never been captured yet at all.
        usageCapturedAt: usageResult.ok ? (codexCachedUsageAt || null) : null,
        ...(usageResult.ok ? {} : { usageUnavailable: usageResult.reason }),
      }, { headers: cors })
    }

    // Real switch — validated against the real model/list catalog, applied
    // via `model` on every future turn/start (see codexSwitchModel's own
    // comment for why no new thread/history loss is needed).
    if (url.pathname === '/codex/model/switch' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const modelId = typeof (body as any)?.model === 'string' ? (body as any).model : ''
      if (!modelId) return jsonResponse({ error: 'missing model' }, { status: 400, headers: cors })
      const result = await codexSwitchModel(modelId)
      if (!result.ok) {
        const status = result.reason === 'turn_in_progress' ? 409 : 400
        return jsonResponse({ error: result.reason }, { status, headers: cors })
      }
      return jsonResponse({ ok: true, model: result.model, displayName: result.displayName }, { headers: cors })
    }

    if (url.pathname === '/codex/auth-status' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const result = await codexGetAuthStatus()
      return jsonResponse(result, { headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/codex/stop' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const sessionId = normalizeCodexSessionId((body as any)?.sessionId)
      const result = sessionId === DEFAULT_CODEX_SESSION_ID ? await codexStop() : await codexStopExtra(getExtraCodexSession(sessionId))
      return jsonResponse(result, { headers: corsHeadersFor(origin) })
    }

    // Genuine reset: abandons the current Codex thread and starts a fresh
    // one (see codexReset), clears server-side history, broadcasts
    // codex_reset for every connected client to clear its own local copy.
    // Never touches Claude Code's currentTurn/history/reset state.
    if (url.pathname === '/codex/reset' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const sessionId = normalizeCodexSessionId((body as any)?.sessionId)
      const result = sessionId === DEFAULT_CODEX_SESSION_ID ? await codexReset() : await codexResetExtra(getExtraCodexSession(sessionId))
      return jsonResponse(result, { headers: corsHeadersFor(origin) })
    }

    // ---- proactive-message master switch (persisted on the VPS, not just
    // browser localStorage, so the systemd timer always sees the real state) ----
    if (url.pathname === '/proactive/settings' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      return jsonResponse(readProactiveConfig(), { headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/proactive/settings' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const enabled = (body as any)?.enabled
      if (typeof enabled !== 'boolean') {
        return jsonResponse({ error: 'enabled must be boolean' }, { status: 400, headers: cors })
      }
      writeProactiveConfig(enabled)
      log('proactive_settings_changed', { enabled })
      return jsonResponse({ ok: true, enabled }, { headers: cors })
    }

    // ---- Auto Memory management (real files under MEMORY_DIR) ----
    if (url.pathname === '/memory/list' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      return jsonResponse({ files: listMemoryFiles() }, { headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/memory/get' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      const name = url.searchParams.get('name') ?? ''
      const p = safeMemoryPath(name)
      if (!p) return jsonResponse({ error: 'invalid filename' }, { status: 400, headers: cors })
      if (!existsSync(p)) return jsonResponse({ error: 'not found' }, { status: 404, headers: cors })
      try {
        const st = statSync(p)
        const content = readFileSync(p, 'utf8')
        return jsonResponse({ name, content, size: st.size, mtime: st.mtimeMs }, { headers: cors })
      } catch (err) {
        log('memory_get_error', { name, error: String(err) })
        return jsonResponse({ error: 'read failed' }, { status: 500, headers: cors })
      }
    }

    if (url.pathname === '/memory/put' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const name = typeof (body as any)?.name === 'string' ? (body as any).name : ''
      const content = typeof (body as any)?.content === 'string' ? (body as any).content : null
      const p = safeMemoryPath(name)
      if (!p || content === null) return jsonResponse({ error: 'invalid filename or content' }, { status: 400, headers: cors })
      const contentBytes = Buffer.byteLength(content, 'utf8')
      if (contentBytes > MEMORY_FILE_MAX_BYTES) {
        return jsonResponse({ error: 'file too large', maxBytes: MEMORY_FILE_MAX_BYTES }, { status: 413, headers: cors })
      }
      const totalOthers = memoryDirTotalBytes(name)
      if (totalOthers + contentBytes > MEMORY_DIR_MAX_BYTES) {
        return jsonResponse({ error: 'memory directory quota exceeded', maxBytes: MEMORY_DIR_MAX_BYTES }, { status: 413, headers: cors })
      }
      try {
        backupMemoryFile(name, p)
        writeFileSync(p, content, 'utf8')
        const st = statSync(p)
        log('memory_put', { name, bytes: contentBytes })
        return jsonResponse({ ok: true, name, size: st.size, mtime: st.mtimeMs }, { headers: cors })
      } catch (err) {
        log('memory_put_error', { name, error: String(err) })
        return jsonResponse({ error: 'write failed' }, { status: 500, headers: cors })
      }
    }

    if (url.pathname === '/memory/delete' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const name = typeof (body as any)?.name === 'string' ? (body as any).name : ''
      const p = safeMemoryPath(name)
      if (!p) return jsonResponse({ error: 'invalid filename' }, { status: 400, headers: cors })
      if (!existsSync(p)) return jsonResponse({ error: 'not found' }, { status: 404, headers: cors })
      try {
        backupMemoryFile(name, p)
        unlinkSync(p)
        log('memory_delete', { name })
        return jsonResponse({ ok: true }, { headers: cors })
      } catch (err) {
        log('memory_delete_error', { name, error: String(err) })
        return jsonResponse({ error: 'delete failed' }, { status: 500, headers: cors })
      }
    }

    // ---- CC fixed-window tidal memory manager ----
    // This state belongs only to the resident CC session. Codex and ordinary
    // API conversations have separate stores and never enter these routes.
    if (url.pathname === '/tidal-memory/status' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      const liveSessionId = readBrainSessionId()
      if (!liveSessionId || liveSessionId !== tidalState.sessionId) {
        return jsonResponse({ error: 'session_mismatch' }, { status: 409, headers: cors })
      }
      return jsonResponse(publicTidalMemoryStatus(), { headers: { ...cors, 'cache-control': 'no-store' } })
    }

    if (url.pathname === '/tidal-memory/summary' && req.method === 'PUT') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad_json' }, { status: 400, headers: cors })
      }
      const liveSessionId = readBrainSessionId()
      const sessionId = typeof (body as any)?.sessionId === 'string' ? (body as any).sessionId : ''
      if (!liveSessionId || sessionId !== liveSessionId || sessionId !== tidalState.sessionId) {
        return jsonResponse({ error: 'session_mismatch' }, { status: 403, headers: cors })
      }
      if (tidalRun || tidalStartupRestore) {
        return jsonResponse({ error: 'tidal_active', currentRevision: tidalState.summaryRevision }, { status: 409, headers: cors })
      }
      const candidate = manualSummaryUpdateCandidate(tidalState, {
        sessionId,
        expectedRevision: (body as any)?.expectedRevision,
        summaryText: (body as any)?.summaryText,
      })
      if (!candidate.ok) {
        const status = candidate.code === 'session_mismatch' ? 403
          : candidate.code === 'version_conflict' || candidate.code === 'tidal_active' ? 409
            : 400
        return jsonResponse({ error: candidate.code, currentRevision: tidalState.summaryRevision }, { status, headers: cors })
      }
      try {
        saveTidalState(TIDAL_STATE_FILE, candidate.state)
        tidalState = candidate.state
        tidalLog('manual_summary_saved', { summaryRevision: tidalState.summaryRevision, summaryChars: String((body as any)?.summaryText).length })
        return jsonResponse(publicTidalMemoryStatus(), { headers: { ...cors, 'cache-control': 'no-store' } })
      } catch (err) {
        tidalLog('manual_summary_save_failed', { error: String(err) })
        return jsonResponse({ error: 'write_failed' }, { status: 500, headers: cors })
      }
    }

    if (url.pathname === '/upload/image' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const dataUrl = typeof (body as any)?.dataUrl === 'string' ? (body as any).dataUrl : ''
      const match = dataUrl.match(UPLOAD_DATA_URL_RE)
      if (!match) return jsonResponse({ error: 'expected a data:image/(jpeg|png|webp|gif);base64,... URL' }, { status: 400, headers: cors })
      const [, mime, base64] = match
      const bytes = Buffer.from(base64, 'base64')
      if (bytes.length > UPLOAD_IMAGE_MAX_BYTES) {
        return jsonResponse({ error: 'image too large', maxBytes: UPLOAD_IMAGE_MAX_BYTES }, { status: 413, headers: cors })
      }
      const ext = UPLOAD_IMAGE_MIME_EXT[mime]
      const filename = `${formatBeijingYYYYMMDD(Date.now())}-img-${nextId()}.${ext}`
      const p = join(UPLOAD_DIR, filename)
      try {
        writeFileSync(p, bytes)
        log('image_uploaded', { filename, bytes: bytes.length, mime })
        return jsonResponse({ ok: true, path: p }, { headers: cors })
      } catch (err) {
        log('image_upload_error', { error: String(err) })
        return jsonResponse({ error: 'write failed' }, { status: 500, headers: cors })
      }
    }

    // Ordinary attachments use the same authenticated, server-local handoff
    // as chat images, but keep their original filename for the model/UI. The
    // bytes never travel through WebSocket/model context; both resident
    // runtimes receive only this server-created path and read on demand.
    if (url.pathname === '/upload/file' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const originalName = safeUploadedFilename((body as any)?.name)
      const dataUrl = typeof (body as any)?.dataUrl === 'string' ? (body as any).dataUrl : ''
      const match = dataUrl.match(UPLOAD_FILE_DATA_URL_RE)
      if (!match) return jsonResponse({ error: 'expected a base64 data URL' }, { status: 400, headers: cors })
      const [, declaredMime, base64] = match
      const bytes = Buffer.from(base64, 'base64')
      if (!bytes.length) return jsonResponse({ error: 'empty file' }, { status: 400, headers: cors })
      if (bytes.length > UPLOAD_FILE_MAX_BYTES) {
        return jsonResponse({ error: 'file too large', maxBytes: UPLOAD_FILE_MAX_BYTES }, { status: 413, headers: cors })
      }
      const filename = `${formatBeijingYYYYMMDD(Date.now())}-file-${nextId()}-${originalName}`
      const p = join(UPLOAD_DIR, filename)
      try {
        writeFileSync(p, bytes, { mode: 0o600 })
        log('file_uploaded', { filename, originalName, bytes: bytes.length, mime: declaredMime })
        return jsonResponse({ ok: true, path: p, name: originalName, size: bytes.length, mimeType: declaredMime }, { headers: cors })
      } catch (err) {
        log('file_upload_error', { error: String(err) })
        return jsonResponse({ error: 'write failed' }, { status: 500, headers: cors })
      }
    }

    // Fired when the user deletes a message that had an image attached (see
    // deleteMsg in useChat.js) — removes the on-disk file so a deleted
    // message doesn't leave an orphaned upload behind forever.
    if (url.pathname === '/upload/image/delete' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const p = typeof (body as any)?.path === 'string' ? (body as any).path : ''
      // Only ever accept a path actually under UPLOAD_DIR — never let a
      // client-supplied path unlink an arbitrary file on the box.
      if (!p.startsWith(UPLOAD_DIR + '/')) return jsonResponse({ error: 'invalid path' }, { status: 400, headers: cors })
      try {
        if (existsSync(p)) unlinkSync(p)
        clearImagePathFromHistory(p)
        log('image_deleted_with_message', { path: p })
        return jsonResponse({ ok: true }, { headers: cors })
      } catch (err) {
        log('image_delete_error', { path: p, error: String(err) })
        return jsonResponse({ error: 'delete failed' }, { status: 500, headers: cors })
      }
    }

    if (url.pathname === '/upload/file/delete' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try { body = await req.json() } catch { return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors }) }
      const p = validUploadedPath((body as any)?.path)
      if (!p || !p.split('/').at(-1)?.includes('-file-')) return jsonResponse({ error: 'invalid path' }, { status: 400, headers: cors })
      try {
        unlinkSync(p)
        for (const m of history) if (m.filePath === p) delete m.filePath
        saveHistory()
        log('file_deleted_with_message', { path: p })
        return jsonResponse({ ok: true }, { headers: cors })
      } catch (err) {
        log('file_delete_error', { path: p, error: String(err) })
        return jsonResponse({ error: 'delete failed' }, { status: 500, headers: cors })
      }
    }

    // ---- model switch: exact model IDs only, blocked mid-turn ----
    if (url.pathname === '/model/switch' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const modelId = typeof (body as any)?.model === 'string' ? (body as any).model.toLowerCase() : ''
      if (!MODEL_IDS.has(modelId)) {
        return jsonResponse({ error: 'unknown model id', allowed: [...MODEL_IDS] }, { status: 400, headers: cors })
      }
      if (currentTurn) {
        return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
      }
      if (resetInFlight) {
        return jsonResponse({ error: 'reset_in_progress' }, { status: 409, headers: cors })
      }
      const result = await withTmuxLock(() => switchModel(modelId))
      log('model_switch', { requested: modelId, ok: result.ok, model: result.model?.id })
      if (!result.ok) return jsonResponse({ error: result.error }, { status: 504, headers: cors })
      return jsonResponse({ ok: true, model: result.model }, { headers: cors })
    }

    // ---- CC context reset: clears server history + genuinely resets the
    // VPS Claude Code session's own conversation context via /clear. Blocked
    // mid-turn (same precondition as model switch — never interleave real
    // keystrokes with an in-flight reply). Idempotent: concurrent calls all
    // resolve to the one real reset in flight, never fire /clear twice.
    // Never touches: companion login cookie/token, current model selection,
    // usage/rate-limit data, VPS Auto Memory files, or any project/system
    // config — only the live conversation turns.
    if (url.pathname === '/cc/reset' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      if (currentTurn) {
        return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
      }
      const result = await requestReset()
      if (!result.ok) return jsonResponse({ error: result.error }, { status: 504, headers: cors })
      return jsonResponse({ ok: true }, { headers: cors })
    }

    // ---- Gomoku (五子棋) ----
    // Every handler below branches on ?runtime=/body.runtime — 'codex' routes
    // to the fully independent codexGomoku* state/functions above, anything
    // else (including absent, for backward compat) keeps the exact original
    // Claude Code behavior untouched. The two boards, threads, turn-tracking,
    // and persistence files never share any mutable state.
    //
    // GET reads whatever is currently persisted (or null — no game started
    // yet), used by the frontend to restore an in-progress game on mount.
    if (url.pathname === '/gomoku/state' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const runtime = url.searchParams.get('runtime') === 'codex' ? 'codex' : 'claude-code'
      const game = runtime === 'codex' ? codexGomokuGame : currentGame
      return jsonResponse({ game }, { headers: corsHeadersFor(origin) })
    }

    // Starts a fresh board — user (black) always moves first. Blocked
    // mid-turn/mid-reset for the same reason model switch and reset are:
    // never interleave with whatever the resident CC session is doing.
    if (url.pathname === '/gomoku/new' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let reqBody: unknown = {}
      try { reqBody = await req.json() } catch {}
      const runtime = (reqBody as any)?.runtime === 'codex' ? 'codex' : 'claude-code'

      if (runtime === 'codex') {
        if (codexGomokuPending) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
        codexGomokuGame = {
          id: nextId(), board: gomokuEmptyBoard(), turn: 'user', status: 'playing',
          moves: [], messages: [], createdAt: Date.now(), updatedAt: Date.now(),
        }
        saveCodexGomokuGame(codexGomokuGame)
        broadcastCodexGomoku()
        log('codex_gomoku_new_game', { gameId: codexGomokuGame.id })
        // A fresh thread for the new game — never carries over a PREVIOUS
        // GAME's own board/chat context into a new board (same reasoning as
        // codexReset() abandoning the old thread on a real context reset)
        // — but it IS seeded with the real main-chat persona/recent history
        // (buildGomokuSeedInstructions) so the opponent starts the game
        // already being the same AI the user's been talking to, not a
        // blank stranger. See that function's own comment for why.
        try {
          await codexEnsureProc()
          const result = await codexRequest('thread/start', { cwd: CODEX_WORKDIR, sandbox: 'workspace-write', approvalPolicy: 'on-request', developerInstructions: buildGomokuSeedInstructions() })
          codexGomokuThreadId = result?.thread?.id ?? null
          saveCodexGomokuThreadId(codexGomokuThreadId)
        } catch (err) {
          log('codex_gomoku_new_thread_error', { error: String(err) })
        }
        return jsonResponse({ ok: true, game: codexGomokuGame }, { headers: cors })
      }

      if (currentTurn) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
      if (resetInFlight) return jsonResponse({ error: 'reset_in_progress' }, { status: 409, headers: cors })
      currentGame = {
        id: nextId(),
        board: gomokuEmptyBoard(),
        turn: 'user',
        status: 'playing',
        moves: [],
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      saveGomokuGame(currentGame)
      broadcastGomoku(currentGame)
      log('gomoku_new_game', { gameId: currentGame.id })
      return jsonResponse({ ok: true, game: currentGame }, { headers: cors })
    }

    // The user's own move — placed directly here (not a "chat message"),
    // validated the same way the AI's gomoku_move tool call is. On success,
    // if the game continues, notifies the resident CC session it's their
    // turn over the existing MCP channel (same mechanism as a real inbound
    // chat message / the proactive-check timer) — never a local bot move.
    if (url.pathname === '/gomoku/move' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const row = Number((body as any)?.row)
      const col = Number((body as any)?.col)
      const runtime = (body as any)?.runtime === 'codex' ? 'codex' : 'claude-code'

      if (runtime === 'codex') {
        const game = codexGomokuGame
        if (!game) return jsonResponse({ error: 'no active game' }, { status: 409, headers: cors })
        if (game.status !== 'playing') return jsonResponse({ error: 'game already over' }, { status: 409, headers: cors })
        if (game.turn !== 'user') return jsonResponse({ error: 'not your turn' }, { status: 409, headers: cors })
        if (codexGomokuPending) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
        if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= GOMOKU_BOARD_SIZE || col < 0 || col >= GOMOKU_BOARD_SIZE) {
          return jsonResponse({ error: 'row/col out of range' }, { status: 400, headers: cors })
        }
        if (game.board[row][col] !== 0) return jsonResponse({ error: 'cell occupied' }, { status: 409, headers: cors })
        game.board[row][col] = 1
        game.moves.push({ row, col, player: 'user', ts: Date.now() })
        const won = gomokuCheckWin(game.board, row, col, 1)
        game.status = won ? 'user_win' : (gomokuBoardFull(game.board) ? 'draw' : 'playing')
        if (game.status === 'playing') game.turn = 'ai'
        game.updatedAt = Date.now()
        saveCodexGomokuGame(game)
        broadcastCodexGomoku()
        log('codex_gomoku_user_move', { gameId: game.id, row, col, status: game.status })
        if (game.status === 'playing') {
          codexNotifyGomokuTurn(game, { row, col }, (body as any)?.clientTime).catch((err) => log('codex_gomoku_turn_error', { error: String(err) }))
        } else {
          setGomokuRecap('codex', buildGomokuRecap(game))
        }
        return jsonResponse({ ok: true, game }, { headers: cors })
      }

      if (!currentGame) return jsonResponse({ error: 'no active game' }, { status: 409, headers: cors })
      if (currentGame.status !== 'playing') return jsonResponse({ error: 'game already over' }, { status: 409, headers: cors })
      if (currentGame.turn !== 'user') return jsonResponse({ error: 'not your turn' }, { status: 409, headers: cors })
      if (currentTurn) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
      if (resetInFlight) return jsonResponse({ error: 'reset_in_progress' }, { status: 409, headers: cors })
      if (!Number.isInteger(row) || !Number.isInteger(col) || row < 0 || row >= GOMOKU_BOARD_SIZE || col < 0 || col >= GOMOKU_BOARD_SIZE) {
        return jsonResponse({ error: 'row/col out of range' }, { status: 400, headers: cors })
      }
      if (currentGame.board[row][col] !== 0) {
        return jsonResponse({ error: 'cell occupied' }, { status: 409, headers: cors })
      }
      currentGame.board[row][col] = 1
      currentGame.moves.push({ row, col, player: 'user', ts: Date.now() })
      const won = gomokuCheckWin(currentGame.board, row, col, 1)
      currentGame.status = won ? 'user_win' : (gomokuBoardFull(currentGame.board) ? 'draw' : 'playing')
      if (currentGame.status === 'playing') currentGame.turn = 'ai'
      currentGame.updatedAt = Date.now()
      saveGomokuGame(currentGame)
      broadcastGomoku(currentGame)
      log('gomoku_user_move', { gameId: currentGame.id, row, col, status: currentGame.status })
      if (currentGame.status === 'playing') {
        await notifyCcOfGomokuTurn(currentGame, { row, col }, (body as any)?.clientTime)
      } else {
        setGomokuRecap('claude-code', buildGomokuRecap(currentGame))
      }
      return jsonResponse({ ok: true, game: currentGame }, { headers: cors })
    }

    // Undo — if the AI hasn't placed a stone for this round yet (still
    // literally "their turn" from a state standpoint, even though a
    // decision turn may already be in flight), just retract the user's own
    // last move immediately; nothing of the AI's exists yet to ask about.
    // Otherwise (AI already moved) this genuinely needs the AI's agreement
    // — asked for real (Codex: a real [UNDO:yes/no]-tagged turn on its own
    // gomoku thread; Claude Code: over the MCP channel) — never assumed or
    // decided here.
    if (url.pathname === '/gomoku/undo-request' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let reqBody: unknown = {}
      try { reqBody = await req.json() } catch {}
      const runtime = (reqBody as any)?.runtime === 'codex' ? 'codex' : 'claude-code'

      if (runtime === 'codex') {
        const game = codexGomokuGame
        if (!game) return jsonResponse({ error: 'no active game' }, { status: 409, headers: cors })
        if (game.status !== 'playing') return jsonResponse({ error: 'game already over' }, { status: 409, headers: cors })
        if (game.moves.length === 0) return jsonResponse({ error: 'no moves to undo' }, { status: 409, headers: cors })

        if (game.turn === 'ai') {
          const last = game.moves[game.moves.length - 1]
          if (last.player !== 'user') return jsonResponse({ error: 'unexpected game state' }, { status: 409, headers: cors })
          game.moves = game.moves.slice(0, -1)
          game.board[last.row][last.col] = 0
          game.turn = 'user'
          game.updatedAt = Date.now()
          saveCodexGomokuGame(game)
          broadcastCodexGomoku()
          log('codex_gomoku_undo_immediate', { gameId: game.id })
          return jsonResponse({ ok: true, mode: 'immediate', game }, { headers: cors })
        }

        if (codexGomokuPending) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
        if (game.moves.length < 2) return jsonResponse({ error: 'no full round to undo' }, { status: 409, headers: cors })
        const instruction = clientTimeContextLine((reqBody as any)?.clientTime) + `用户请求悔棋，想撤回最近一整轮棋（你和用户各一步）。当前棋盘：\n${gomokuBoardToText(game.board)}\n真诚决定是否同意。回复 [UNDO:yes] 或 [UNDO:no] 其中之一，除此之外不要输出任何解释、理由或分析——这是自动决策，分析文字都会被丢弃。如果想自然地带一句情绪反应（比如"别反悔啦" "好吧就让你一次"），可以额外加一个 [BANTER:文字] 标记，完全可选。只有当用户主动在棋局聊天框跟你说话时，你才需要正常聊天回应。`
        ;(async () => {
          const { text, error } = await codexGomokuSendTurn(instruction)
          if (!codexGomokuGame || codexGomokuGame.id !== game.id) return
          if (error) {
            appendCodexGomokuChatMsg({ id: nextId(), from: 'model', text: `（悔棋请求出错：${error}）`, ts: Date.now() })
            return
          }
          // The raw decision text is never shown — same "no per-decision
          // commentary" rule as an automatic move (see
          // codexApplyGomokuTurnResult's own comment for why). Only an
          // explicit [BANTER:...] tag (if any) reaches game.messages.
          const banter = extractCodexBanter(text)
          if (banter) appendCodexGomokuChatMsg({ id: nextId(), from: 'model', text: banter, ts: Date.now() })
          const agree = /\[UNDO:\s*yes\s*\]/i.test(text)
          if (agree) {
            const last = codexGomokuGame.moves[codexGomokuGame.moves.length - 1]
            const prev = codexGomokuGame.moves[codexGomokuGame.moves.length - 2]
            if (last?.player === 'ai' && prev?.player === 'user') {
              codexGomokuGame.board[last.row][last.col] = 0
              codexGomokuGame.board[prev.row][prev.col] = 0
              codexGomokuGame.moves = codexGomokuGame.moves.slice(0, -2)
              codexGomokuGame.turn = 'user'
              codexGomokuGame.status = 'playing'
              codexGomokuGame.updatedAt = Date.now()
              saveCodexGomokuGame(codexGomokuGame)
            }
          }
          broadcastCodexGomoku()
        })().catch((err) => log('codex_gomoku_undo_error', { error: String(err) }))
        log('codex_gomoku_undo_asked', { gameId: game.id })
        return jsonResponse({ ok: true, mode: 'pending', game }, { headers: cors })
      }

      if (!currentGame) return jsonResponse({ error: 'no active game' }, { status: 409, headers: cors })
      if (currentGame.status !== 'playing') return jsonResponse({ error: 'game already over' }, { status: 409, headers: cors })
      if (resetInFlight) return jsonResponse({ error: 'reset_in_progress' }, { status: 409, headers: cors })
      if (currentGame.moves.length === 0) return jsonResponse({ error: 'no moves to undo' }, { status: 409, headers: cors })

      if (currentGame.turn === 'ai') {
        // AI hasn't moved yet for this round. If a decision turn is
        // currently in flight, we deliberately do NOT try to interrupt it —
        // there is no safe way to cancel a live Claude Code turn from here.
        // Instead this just flips the board back; if that in-flight turn's
        // eventual gomoku_move call arrives after, it will be rejected by
        // the normal "not your turn" check below (turn is 'user' again by
        // then) — a clear, safe rejection, not a corrupted board state.
        const last = currentGame.moves[currentGame.moves.length - 1]
        if (last.player !== 'user') {
          return jsonResponse({ error: 'unexpected game state' }, { status: 409, headers: cors })
        }
        currentGame.moves = currentGame.moves.slice(0, -1)
        currentGame.board[last.row][last.col] = 0
        currentGame.turn = 'user'
        currentGame.updatedAt = Date.now()
        saveGomokuGame(currentGame)
        broadcastGomoku(currentGame)
        log('gomoku_undo_immediate', { gameId: currentGame.id })
        return jsonResponse({ ok: true, mode: 'immediate', game: currentGame }, { headers: cors })
      }

      // turn === 'user': AI already placed its stone for this round — a
      // real round to give up, so genuinely ask.
      if (currentTurn) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
      if (currentGame.moves.length < 2) return jsonResponse({ error: 'no full round to undo' }, { status: 409, headers: cors })
      const id = nextId()
      gomokuTurnId = id
      gomokuTurnKind = 'undo'
      gomokuBanterUsedThisTurn = false
      pendingUndoGameId = currentGame.id
      startTurn(id)
      deliver(id, JSON.stringify({
        kind: 'gomoku_undo_request',
        surface: 'gomoku',
        gameId: currentGame.id,
        interactionId: id,
        message: '用户请求悔棋，想撤回最近一整轮棋（你和用户各一步）。请调用 gomoku_undo_response 工具回应：同意传 {gameId, agree:true}，不同意传 {gameId, agree:false}。这是自动决策：reply/send_voice 在这种回合里不会显示，不要用它们讲解理由或分析局势。如果想自然地说一句情绪反应（比如"别反悔啦" "好吧就让你一次"），可以额外调用一次 gomoku_banter，一句很短的话，完全可选。决定本身必须通过 gomoku_undo_response 完成。',
      }), { clientTime: (reqBody as any)?.clientTime })
      log('gomoku_undo_asked', { gameId: currentGame.id, id })
      return jsonResponse({ ok: true, mode: 'pending', game: currentGame }, { headers: cors })
    }

    // Resign — unilateral, never needs the AI's agreement. Notifies CC as
    // an FYI turn it may optionally react to via reply/send_voice; no board
    // tool call is expected or needed from this one.
    if (url.pathname === '/gomoku/resign' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let reqBody: unknown = {}
      try { reqBody = await req.json() } catch {}
      const runtime = (reqBody as any)?.runtime === 'codex' ? 'codex' : 'claude-code'

      if (runtime === 'codex') {
        const game = codexGomokuGame
        if (!game) return jsonResponse({ error: 'no active game' }, { status: 409, headers: cors })
        if (game.status !== 'playing') return jsonResponse({ error: 'game already over' }, { status: 409, headers: cors })
        game.status = 'ai_win'
        game.updatedAt = Date.now()
        saveCodexGomokuGame(game)
        broadcastCodexGomoku()
        setGomokuRecap('codex', buildGomokuRecap(game, 'resign'))
        log('codex_gomoku_resign', { gameId: game.id })
        return jsonResponse({ ok: true, game }, { headers: cors })
      }

      if (!currentGame) return jsonResponse({ error: 'no active game' }, { status: 409, headers: cors })
      if (currentGame.status !== 'playing') return jsonResponse({ error: 'game already over' }, { status: 409, headers: cors })
      if (currentTurn) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
      if (resetInFlight) return jsonResponse({ error: 'reset_in_progress' }, { status: 409, headers: cors })
      currentGame.status = 'ai_win'
      currentGame.updatedAt = Date.now()
      saveGomokuGame(currentGame)
      broadcastGomoku(currentGame)
      setGomokuRecap('claude-code', buildGomokuRecap(currentGame, 'resign'))
      log('gomoku_resign', { gameId: currentGame.id })
      const id = nextId()
      gomokuTurnId = id
      gomokuTurnKind = 'resign'
      startTurn(id)
      deliver(id, JSON.stringify({
        kind: 'gomoku_resign',
        surface: 'gomoku',
        gameId: currentGame.id,
        interactionId: id,
        message: '用户认输了，这局你赢了。可以用 reply 或 send_voice 说点什么（不强制，会显示在五子棋游戏界面里），不需要调用任何棋盘工具。',
      }), { clientTime: (reqBody as any)?.clientTime })
      return jsonResponse({ ok: true, game: currentGame }, { headers: cors })
    }

    // In-game chat — text (typed or voice-transcribed client-side) the user
    // sends *while* on the gomoku screen, entirely separate from the main
    // conversation. Persisted straight into the game's own `messages` (never
    // `history`) and delivered to the opponent (Claude Code over the MCP
    // channel, or Codex over its own dedicated gomoku thread) — never routed
    // into either runtime's main chat.
    if (url.pathname === '/gomoku/chat' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown
      try {
        body = await req.json()
      } catch {
        return jsonResponse({ error: 'bad json' }, { status: 400, headers: cors })
      }
      const gameId = typeof (body as any)?.gameId === 'string' ? (body as any).gameId : ''
      const text = typeof (body as any)?.text === 'string' ? (body as any).text.trim() : ''
      const voice = (body as any)?.voice === true
      const runtime = (body as any)?.runtime === 'codex' ? 'codex' : 'claude-code'

      if (runtime === 'codex') {
        const game = codexGomokuGame
        if (!game || gameId !== game.id) return jsonResponse({ error: 'no matching active game' }, { status: 409, headers: cors })
        if (!text) return jsonResponse({ error: 'empty text' }, { status: 400, headers: cors })
        if (codexGomokuPending) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
        appendCodexGomokuChatMsg({ id: nextId(), from: 'user', text, ts: Date.now(), ...(voice ? { kind: 'voice' } : {}) })
        const interactionId = nextId()
        codexNotifyGomokuChat(game, text, voice, (body as any)?.clientTime)
          .catch((err) => log('codex_gomoku_chat_error', { error: String(err) }))
          .finally(() => sendRaw({ type: 'gomoku_turn_end', runtime: 'codex', interactionId }))
        log('codex_gomoku_chat_sent', { gameId: game.id, interactionId, voice })
        return jsonResponse({ ok: true, interactionId, game }, { headers: cors })
      }

      if (!currentGame || gameId !== currentGame.id) {
        return jsonResponse({ error: 'no matching active game' }, { status: 409, headers: cors })
      }
      if (!text) return jsonResponse({ error: 'empty text' }, { status: 400, headers: cors })
      if (currentTurn) return jsonResponse({ error: 'turn_in_progress' }, { status: 409, headers: cors })
      if (resetInFlight) return jsonResponse({ error: 'reset_in_progress' }, { status: 409, headers: cors })

      appendGomokuChatMsg({ id: nextId(), from: 'user', text, ts: Date.now(), ...(voice ? { kind: 'voice' } : {}) })

      const interactionId = nextId()
      gomokuTurnId = interactionId
      gomokuTurnKind = 'chat'
      startTurn(interactionId)
      deliver(interactionId, JSON.stringify({
        kind: 'gomoku_chat',
        surface: 'gomoku',
        gameId: currentGame.id,
        interactionId,
        message: text,
        viaVoice: voice,
        board: gomokuBoardToText(currentGame.board),
        boardSize: GOMOKU_BOARD_SIZE,
        instruction: voice
          ? '用户在五子棋游戏界面里用语音跟你说了这句话（已转成文字），不是落子指令。用 reply 或 send_voice 自然回应就行（语音输入，回 send_voice 会更自然，但不强制），不需要调用任何棋盘工具，也不用报坐标。'
          : '用户在五子棋游戏界面里边下棋边跟你打字说了这句话，不是落子指令。用 reply 或 send_voice 自然回应就行，不需要调用任何棋盘工具，也不用报坐标。',
      }), { clientTime: (body as any)?.clientTime })
      log('gomoku_chat_sent', { gameId: currentGame.id, interactionId, voice })
      return jsonResponse({ ok: true, interactionId, game: currentGame }, { headers: cors })
    }

    // ---- Focus (专注) — one real global task, see this file's own Focus section ----

    if (url.pathname === '/focus/state' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      return jsonResponse({ state: focusPublicState() }, { headers: corsHeadersFor(origin) })
    }

    // Starts the ONE global focus task. Two real callers reach this:
    //  1. The sheet's manual "开始专注" — manager omitted, self-managed.
    //  2. A plain API-key session's own useChat.js, after parsing a real
    //     [FOCUS_START:minutes|task] tag out of that model's actual reply —
    //     manager:{runtime:'api', sessionId, name}. CC/Codex NEVER reach
    //     this endpoint for their own start_focus — those go through the
    //     in-process tool handler / internal bridge, so a browser can never
    //     forge a claude-code/codex manager identity here.
    if (url.pathname === '/focus/start' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const task = typeof (body as any)?.task === 'string' ? (body as any).task : ''
      const minutes = Number((body as any)?.minutes)
      const managerInput = (body as any)?.manager
      let manager: FocusManager | null = null
      if (managerInput && managerInput.runtime === 'api') {
        const sessionId = typeof managerInput.sessionId === 'string' ? managerInput.sessionId.slice(0, 100) : ''
        const name = typeof managerInput.name === 'string' ? managerInput.name.slice(0, 60) : 'AI'
        if (!sessionId) return jsonResponse({ ok: false, reason: 'missing_session_id' }, { status: 400, headers: cors })
        manager = { runtime: 'api', sessionId, name }
      }
      const result = focusStart({ task, minutes, manager })
      if (!result.ok) return jsonResponse(result, { status: 409, headers: cors })
      log('focus_started_public', { task, minutes, manager })
      return jsonResponse(result, { headers: cors })
    }

    // The user talking to the manager from the focus screen. Only valid for
    // an AI-managed session (self-managed has no one to talk to) and only
    // for claude-code/codex managers — api-managed interaction is driven
    // entirely client-side by that session's own useChat() (see
    // useChat.js), never through this endpoint, since there's no
    // server-side session to push a turn into for it.
    if (url.pathname === '/focus/interact' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const text = typeof (body as any)?.text === 'string' ? (body as any).text.trim() : ''
      if (!text) return jsonResponse({ error: 'empty text' }, { status: 400, headers: cors })
      if (!focusState.active || !focusState.manager) return jsonResponse({ error: 'no_manager' }, { status: 409, headers: cors })
      if (focusState.manager.runtime === 'api') return jsonResponse({ error: 'api_managed_is_client_driven' }, { status: 409, headers: cors })
      focusAppendLog('user', text)
      broadcastFocus()
      focusDispatchInteract(text)
      log('focus_interact', { chars: text.length, manager: focusState.manager })
      return jsonResponse({ ok: true }, { headers: cors })
    }

    // The user asking to pause/end early, with a reason — creates the one
    // pending request and (for claude-code/codex managers) pushes a real
    // decision turn. For an api manager, focusCreateRequest's own
    // broadcastFocus() is enough — that session's frontend is already
    // watching focus_update and drives the actual prompt itself.
    if (url.pathname === '/focus/request' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const kind: FocusRequestKind | null = (body as any)?.kind === 'end' ? 'end' : (body as any)?.kind === 'pause' ? 'pause' : null
      const reason = typeof (body as any)?.reason === 'string' ? (body as any).reason : ''
      if (!kind) return jsonResponse({ error: 'invalid kind' }, { status: 400, headers: cors })
      const result = focusCreateRequest(kind, reason)
      if (!result.ok) return jsonResponse(result, { status: 409, headers: cors })
      if (focusState.manager && focusState.manager.runtime !== 'api') focusDispatchRequestNotify(result.request)
      log('focus_request_public', { requestId: result.request.id, kind })
      return jsonResponse(result, { headers: cors })
    }

    // The user resuming an already-approved pause — no fresh approval
    // needed (see focusResume's own comment for why), available regardless
    // of which runtime manages it.
    if (url.pathname === '/focus/resume' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      if (!focusState.manager) return jsonResponse({ ok: false, reason: 'no_manager' }, { status: 409, headers: cors })
      const result = focusResume()
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: cors })
    }

    // Self-managed only (manager === null) — direct pause/resume/end, no
    // approval flow (see focusSelf* functions' own comments).
    if (url.pathname === '/focus/self/pause' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const result = focusSelfPause()
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: corsHeadersFor(origin) })
    }
    if (url.pathname === '/focus/self/resume' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const result = focusSelfResume()
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: corsHeadersFor(origin) })
    }
    if (url.pathname === '/focus/self/end' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const result = focusSelfEnd()
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: corsHeadersFor(origin) })
    }

    // A plain API-key session acting as manager — its "tool calls" are real
    // [FOCUS_*] tags useChat.js parses out of that model's own real reply
    // text (see that file), which then hit these endpoints client-side.
    // Structurally identical gate (focusMatchesManager) to the CC/Codex
    // in-process tool handlers — an api session can never approve/extend/
    // finish a session some OTHER runtime (or a different api session)
    // manages.
    if (url.pathname === '/focus/api-manager/approve' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const sessionId = typeof (body as any)?.sessionId === 'string' ? (body as any).sessionId : ''
      const requestId = typeof (body as any)?.requestId === 'string' ? (body as any).requestId : ''
      const message = typeof (body as any)?.message === 'string' ? (body as any).message : undefined
      const result = focusResolveRequest({ runtime: 'api', sessionId, name: focusState.manager?.name || 'AI' }, requestId, true, message)
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: cors })
    }
    if (url.pathname === '/focus/api-manager/deny' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const sessionId = typeof (body as any)?.sessionId === 'string' ? (body as any).sessionId : ''
      const requestId = typeof (body as any)?.requestId === 'string' ? (body as any).requestId : ''
      const reason = typeof (body as any)?.reason === 'string' ? (body as any).reason : ''
      if (!reason.trim()) return jsonResponse({ ok: false, reason: 'reason_required' }, { status: 400, headers: cors })
      const result = focusResolveRequest({ runtime: 'api', sessionId, name: focusState.manager?.name || 'AI' }, requestId, false, reason)
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: cors })
    }
    if (url.pathname === '/focus/api-manager/finish' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const sessionId = typeof (body as any)?.sessionId === 'string' ? (body as any).sessionId : ''
      const result = focusManagerFinish({ runtime: 'api', sessionId, name: focusState.manager?.name || 'AI' })
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: cors })
    }
    if (url.pathname === '/focus/api-manager/extend' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const sessionId = typeof (body as any)?.sessionId === 'string' ? (body as any).sessionId : ''
      const minutes = Number((body as any)?.minutes)
      const result = focusExtend({ runtime: 'api', sessionId, name: focusState.manager?.name || 'AI' }, minutes)
      return jsonResponse(result, { status: result.ok ? 200 : 409, headers: cors })
    }

    // ---- Group chat (多AI群聊) — see this file's own "Group chat" section ----

    if (url.pathname === '/group/list' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const list = groupChatOrder
        .map((id) => groupChats[id])
        .filter((c): c is GroupChat => !!c)
        .map((c) => ({ id: c.id, name: c.name, members: c.members, updatedAt: c.updatedAt, lastMessage: c.messages[c.messages.length - 1]?.text ?? '' }))
      return jsonResponse({ chats: list }, { headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/group/create' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const name = typeof (body as any)?.name === 'string' ? (body as any).name : ''
      const rawMembers = Array.isArray((body as any)?.members) ? (body as any).members : []
      const memberSpecs = parseGroupMemberSpecs(rawMembers)
      const result = groupCreateChat(name, memberSpecs)
      if (!result.ok) return jsonResponse(result, { status: 400, headers: cors })
      log('group_created', { id: result.chat.id, members: result.chat.members })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/invite' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const specs = parseGroupMemberSpecs([(body as any)?.member])
      if (specs.length !== 1) return jsonResponse({ ok: false, reason: 'invalid_member' }, { status: 400, headers: cors })
      const result = groupInviteMember(id, specs[0])
      if (!result.ok) return jsonResponse(result, { status: 400, headers: cors })
      log('group_member_invited', { id, member: groupMemberSpecId(specs[0]) })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/remove' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const memberId = typeof (body as any)?.memberId === 'string' ? (body as any).memberId : ''
      const result = groupRemoveMember(id, memberId)
      if (!result.ok) return jsonResponse(result, { status: 400, headers: cors })
      log('group_member_removed', { id, memberId })
      return jsonResponse(result, { headers: cors })
    }

    // Fulfillment endpoint for an 'api'-kind member's pending client turn —
    // see groupClientTurnSubmit / GroupPendingClientTurn. The browser that
    // owns this member's own session (apiKey/baseUrl/model never leave it)
    // calls this after running its own streamChat completion, exactly the
    // same trust shape as CC's group_speak tool / Codex's internal group
    // bridge, just triggered by an authed HTTP call instead of a live turn.
    if (url.pathname === '/group/client-turn/submit' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const memberId = typeof (body as any)?.memberId === 'string' ? (body as any).memberId : ''
      const action = (body as any)?.action === 'request' ? 'request' : (body as any)?.action === 'pass' ? 'pass' : 'speak'
      const text = typeof (body as any)?.text === 'string' ? (body as any).text : ''
      const direction = typeof (body as any)?.direction === 'string' ? (body as any).direction : ''
      const scope = {
        requestId: typeof (body as any)?.requestId === 'string' ? (body as any).requestId : '',
        turnId: typeof (body as any)?.turnId === 'string' ? (body as any).turnId : '',
        channelType: typeof (body as any)?.channelType === 'string' ? (body as any).channelType : '',
        conversationId: typeof (body as any)?.conversationId === 'string' ? (body as any).conversationId : '',
        groupId: typeof (body as any)?.groupId === 'string' ? (body as any).groupId : '',
        topicId: typeof (body as any)?.topicId === 'string' ? (body as any).topicId : '',
      }
      const result = groupClientTurnSubmit(id, memberId, scope, action, text, direction)
      if (!result.ok) return jsonResponse(result, { status: 409, headers: cors })
      log('group_client_turn_submit', { id, memberId, action })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/state' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      const id = url.searchParams.get('id') || ''
      const chat = groupChats[id]
      if (!chat) return jsonResponse({ error: 'not_found' }, { status: 404, headers: corsHeadersFor(origin) })
      return jsonResponse({ chat }, { headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/group/message' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const text = typeof (body as any)?.text === 'string' ? (body as any).text : ''
      const mentions = Array.isArray((body as any)?.mentions) ? (body as any).mentions : []
      const result = groupUserMessage(id, text, mentions)
      if (!result.ok) return jsonResponse(result, { status: 409, headers: cors })
      log('group_message_sent', { id, mentions })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/new-topic' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const result = groupNewTopic(id)
      if (!result.ok) return jsonResponse(result, { status: 404, headers: cors })
      log('group_new_topic', { id, topicId: result.chat.topicId })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/clear-messages' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const result = groupClearMessages(id)
      if (!result.ok) return jsonResponse(result, { status: 404, headers: cors })
      log('group_messages_cleared', { id })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/delete' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const result = groupDeleteChat(id)
      if (!result.ok) return jsonResponse(result, { status: 404, headers: cors })
      log('group_deleted', { id })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/candidate/approve' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const candidateId = typeof (body as any)?.candidateId === 'string' ? (body as any).candidateId : ''
      const result = groupApproveCandidate(id, candidateId)
      if (!result.ok) return jsonResponse(result, { status: 404, headers: cors })
      log('group_candidate_approved', { id, candidateId })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/group/candidate/reject' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const id = typeof (body as any)?.id === 'string' ? (body as any).id : ''
      const candidateId = typeof (body as any)?.candidateId === 'string' ? (body as any).candidateId : ''
      const result = groupRejectCandidate(id, candidateId)
      if (!result.ok) return jsonResponse(result, { status: 404, headers: cors })
      log('group_candidate_rejected', { id, candidateId })
      return jsonResponse(result, { headers: cors })
    }

    // ---- Mystery game (剧本杀) — real isolated CC/Codex character turns ----
    // See this file's own "Mystery game" section header for the full design.
    if (url.pathname === '/mystery/cc-models' && req.method === 'GET') {
      const gate = authGate()
      if (gate) return gate
      return jsonResponse({ models: [...MODEL_IDS] }, { headers: corsHeadersFor(origin) })
    }

    if (url.pathname === '/mystery/turn' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const gameId = typeof (body as any)?.gameId === 'string' ? (body as any).gameId : ''
      const charId = typeof (body as any)?.charId === 'string' ? (body as any).charId : ''
      const runtime = (body as any)?.runtime === 'codex' ? 'codex' : 'claude-code'
      const model = typeof (body as any)?.model === 'string' ? (body as any).model : ''
      const systemPrompt = typeof (body as any)?.systemPrompt === 'string' ? (body as any).systemPrompt : ''
      const instruction = typeof (body as any)?.instruction === 'string' ? (body as any).instruction : ''
      const rawImageUrl = typeof (body as any)?.imageUrl === 'string' ? (body as any).imageUrl : ''
      const imageUrl = rawImageUrl.startsWith('data:image/') && rawImageUrl.length <= 4_000_000 ? rawImageUrl : ''
      const rawImagePath = typeof (body as any)?.imagePath === 'string' ? (body as any).imagePath : ''
      const imagePath = rawImagePath.startsWith(UPLOAD_DIR + '/') && existsSync(rawImagePath) ? rawImagePath : ''
      if (!gameId || !charId || !systemPrompt || !instruction) {
        return jsonResponse({ error: 'missing fields' }, { status: 400, headers: cors })
      }
      if (runtime === 'claude-code' && !MODEL_IDS.has(model)) {
        return jsonResponse({ error: 'unknown model' }, { status: 400, headers: cors })
      }
      // req.signal fires if the browser aborts/disconnects (e.g. the user
      // hit "跳过") — threaded down into the CC poll loop so a skipped turn
      // frees the per-session busy lock right away instead of only via the
      // full timeout, so the same character's NEXT turn is never left
      // waiting on an abandoned one. Codex's own single-flight guard
      // (mysteryCodexPendingByThread) already only ever clears on a real
      // turn/completed notification — genuinely stopping that server-side
      // would mean calling Codex's own turn/interrupt RPC, out of scope for
      // this fix (Codex was never the slow one here — see mysteryCcSendTurn
      // for the actual diagnosed root causes).
      const result = await mysteryRunTurn(gameId, charId, runtime, model, systemPrompt, instruction, req.signal, imageUrl, imagePath)
      log('mystery_turn', { gameId, charId, runtime, model, ok: !('error' in result) })
      if ('error' in result) return jsonResponse(result, { status: 502, headers: cors })
      return jsonResponse(result, { headers: cors })
    }

    if (url.pathname === '/mystery/cleanup' && req.method === 'POST') {
      const gate = authGate()
      if (gate) return gate
      const cors = corsHeadersFor(origin)
      let body: unknown = {}
      try { body = await req.json() } catch {}
      const gameId = typeof (body as any)?.gameId === 'string' ? (body as any).gameId : ''
      const charIds = Array.isArray((body as any)?.charIds) ? (body as any).charIds.filter((c: unknown) => typeof c === 'string') : []
      if (!gameId) return jsonResponse({ error: 'missing gameId' }, { status: 400, headers: cors })
      await mysteryCleanupGame(gameId, charIds)
      log('mystery_cleanup', { gameId, charIds })
      return jsonResponse({ ok: true }, { headers: cors })
    }

    // ---- WebSocket (cookie-only auth + strict Origin check) ----
    if (url.pathname === '/ws') {
      if (!originOk(req)) {
        log('origin_reject', { path: url.pathname, origin })
        return new Response('origin not allowed', { status: 403 })
      }
      if (!cookieAuthOk(req)) {
        log('auth_reject', { path: url.pathname, method: req.method })
        return unauthorized()
      }
      if (server.upgrade(req, { data: { authed: true, codexSessionId: DEFAULT_CODEX_SESSION_ID } })) return
      return new Response('upgrade failed', { status: 400 })
    }

    return new Response('not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      clients.add(ws)
      log('ws_open', { clients: clients.size })
      const hist: HistoryMsg = {
        type: 'history', items: history, openTurnId: currentTurn?.turnId ?? null, resetAt: readResetMarker().resetAt,
        queuedTurnIds: queuedTurnIds(tidalState),
        codexHistory, codexOpenTurnId: codexCurrentTurnId, codexStatus,
        codexSessionId: DEFAULT_CODEX_SESSION_ID, codexPrompt: getCodexPrompt(DEFAULT_CODEX_SESSION_ID),
        focus: focusPublicState(),
      }
      ws.send(JSON.stringify(hist))
      // Best-effort — sent only to this just-connected client, not a full
      // broadcast (parallels the history snapshot above being per-client
      // too). Both runtimes' OWN readings are sent — the connecting client
      // may be viewing either window (or switch between them without a
      // reconnect), and each is a genuinely separate sessionOverlay/tag.
      for (const [sessionId, runtime] of [[XINCHAO_CC_SESSION_ID, 'claude-code'], [XINCHAO_CODEX_SESSION_ID, 'codex']] as const) {
        fetchXinchaoSummary(sessionId).then((summary) => {
          if (!summary) return
          try {
            ws.send(JSON.stringify({ type: 'xinchao_update', runtime, state: xinchaoFrontendPayload(summary) }))
          } catch (err) {
            log('ws_send_error', { error: String(err) })
          }
        }).catch((err) => log('xinchao_broadcast_error', { error: String(err) }))
      }
    },
    close(ws) {
      clients.delete(ws)
      log('ws_close', { clients: clients.size })
    },
    message(ws, raw) {
      try {
        const parsed = JSON.parse(String(raw)) as { id?: string; text?: string; segments?: string[]; type?: string; turnId?: string; runtime?: string; imageUrl?: string; imagePath?: string; filePath?: string; fileName?: string; fileSize?: number; fileType?: string; clientTime?: unknown; sessionId?: string; prompt?: string }

        // App-level heartbeat — a WS can look "open" to the browser for a
        // long time after the underlying network path has actually died
        // (mobile network handoffs, iOS backgrounding), which was letting a
        // chat send silently vanish with no error and no server-side trace
        // at all (see 2026-08-05 evening incident writeup in project
        // memory). The client pings periodically and force-reconnects if a
        // pong doesn't come back in time, catching a dead connection in
        // seconds instead of however long the OS takes to notice.
        if (parsed.type === 'ping') {
          try { ws.send(JSON.stringify({ type: 'pong', ts: Date.now() })) } catch {}
          return
        }

        if (parsed.type === 'codex_session') {
          const sessionId = normalizeCodexSessionId(parsed.sessionId)
          ws.data.codexSessionId = sessionId
          sendCodexSessionSnapshot(ws, sessionId)
          return
        }

        if (parsed.type === 'delete_notice') {
          const deletedText = (parsed.text ?? '').trim()
          if (deletedText) notifyCcOfDeletedMessage(deletedText, parsed.clientTime)
          return
        }

        // "Stop" used to only make the requesting tab stop listening — the
        // resident session kept working toward a reply nobody would ever
        // see, and (worse) kept currentTurn open so the user's very next
        // message got turn_busy-rejected until the unwanted turn eventually
        // finished on its own. This sends a real Escape into the live brain
        // pane — same interrupt a human at the terminal would send — via the
        // same tmuxSendKeys/withTmuxLock path already proven for /model and
        // /effort switches. Deliberately does NOT call failTurn() itself:
        // Claude Code interrupting via Escape goes through its own normal
        // Stop hook same as any other turn end, so endTurn()/failTurn() via
        // /internal/turn-end|turn-error already closes currentTurn out
        // correctly — forcing it closed here too could race a real reply
        // that was already mid-flight and let a new turn's deliver() land
        // while the old one is still winding down.
        if (parsed.type === 'stop_turn') {
          const stopTurnId = typeof parsed.turnId === 'string' ? parsed.turnId : ''
          if (stopTurnId && currentTurn && stopTurnId === currentTurn.turnId) {
            log('stop_turn_requested', { turnId: stopTurnId })
            withTmuxLock(() => tmuxSendKeys('Escape')).catch((err) => log('stop_turn_error', { turnId: stopTurnId, error: String(err) }))
          }
          return
        }

        // Codex (codex-vps) — explicitly tagged, routed to its own entirely
        // separate turn-state/history/busy-tracking below. Never touches
        // currentTurn/history/resetInFlight (Claude Code's own state), so
        // the two runtimes can run fully concurrently without interfering.
        if (parsed.runtime === 'codex') {
          const sessionId = normalizeCodexSessionId(parsed.sessionId || ws.data.codexSessionId)
          const codexText = (parsed.text ?? '').trim()
          const codexSegments = Array.isArray(parsed.segments)
            ? parsed.segments.map((part) => typeof part === 'string' ? part.trim() : '').filter(Boolean).slice(0, 50)
            : undefined
          const codexTurnText = codexSegments?.length ? codexSegments.join('\n') : codexText
          const codexImageUrl = parsed.imageUrl
          const codexFilePath = validUploadedPath(parsed.filePath)
          const codexFile = codexFilePath && codexFilePath.split('/').at(-1)?.includes('-file-') ? {
            path: codexFilePath,
            name: safeUploadedFilename(parsed.fileName || codexFilePath.split('/').at(-1)),
            size: typeof parsed.fileSize === 'number' ? parsed.fileSize : undefined,
            mimeType: typeof parsed.fileType === 'string' ? parsed.fileType.slice(0, 200) : undefined,
          } : undefined
          if (!codexTurnText && !codexImageUrl && !codexFile) return
          if (typeof parsed.prompt === 'string') setCodexPrompt(sessionId, parsed.prompt)
          const extraState = sessionId === DEFAULT_CODEX_SESSION_ID ? null : getExtraCodexSession(sessionId)
          if (codexResetInFlight || extraState?.resetInFlight) {
            try { ws.send(JSON.stringify({ type: 'codex_reset_busy', ts: Date.now(), sessionId })) } catch (err) { log('ws_send_error', { error: String(err) }) }
            return
          }
          const activeTurnId = extraState ? extraState.currentTurnId : codexCurrentTurnId
          if (activeTurnId) {
            try { ws.send(JSON.stringify({ type: 'codex_turn_busy', turnId: activeTurnId, ts: Date.now(), sessionId })) } catch (err) { log('ws_send_error', { error: String(err) }) }
            return
          }
          const send = extraState
            ? codexSendExtraUserTurn(extraState, codexTurnText, codexImageUrl, parsed.clientTime, parsed.prompt, codexSegments, codexFile)
            : codexSendUserTurn(codexTurnText, codexImageUrl, parsed.clientTime, parsed.prompt, codexSegments, codexFile)
          send.catch((err) => {
            log('codex_send_error', { error: String(err) })
            if (extraState) {
              extraAppendMsg(extraState, { id: nextId(), from: 'system', ts: Date.now(), text: '（发送失败，请重试）' })
              setExtraCodexStatus(extraState, 'idle')
              broadcastExtraCodex(extraState, { type: 'codex_notice', kind: 'error', message: '发送失败' })
            } else {
              codexAppendMsg({ id: nextId(), from: 'system', ts: Date.now(), text: '（发送失败，请重试）' })
              setCodexStatus('idle')
              broadcastCodex({ type: 'codex_notice', kind: 'error', message: '发送失败' })
            }
          })
          xinchaoHeartbeat(nextId(), XINCHAO_CODEX_SESSION_ID)
          return
        }

        const text = (parsed.text ?? '').trim()
        // Only ever accept a path this same process just wrote via
        // /upload/image — never trust an arbitrary client-supplied path, CC's
        // Read tool would happily open anything readable by the companion
        // OS user otherwise.
        const imagePath = validUploadedPath(parsed.imagePath)
        const rawFilePath = validUploadedPath(parsed.filePath)
        const filePath = rawFilePath && rawFilePath.split('/').at(-1)?.includes('-file-') ? rawFilePath : undefined
        const fileName = filePath ? safeUploadedFilename(parsed.fileName || filePath.split('/').at(-1)) : undefined
        const id = parsed.id || nextId()
        if (!text && !imagePath && !filePath) return

        // Confirms the message physically reached the server, independent
        // of what happens to it next (accepted / turn_busy / reset_busy all
        // already tell the client their own outcome). Lets the client tell
        // "never arrived — the socket looked open but wasn't" apart from
        // "arrived fine, still just waiting" instead of guessing from a
        // disconnect it noticed only later.
        try { ws.send(JSON.stringify({ type: 'inbound_ack', id })) } catch {}

        if (resetInFlight) {
          // A context reset is clearing the conversation right now — never
          // let a message slip in and get delivered into the half-cleared
          // session. Tell only the sender, distinctly from turn_busy so the
          // frontend can show "clearing, please wait" rather than "still
          // replying".
          const busy: ResetBusyWire = { type: 'reset_busy', ts: Date.now() }
          try {
            ws.send(JSON.stringify(busy))
          } catch (err) {
            log('ws_send_error', { error: String(err) })
          }
          log('reset_busy_rejected', { attemptedId: id })
          return
        }

        if (tidalIsActive()) {
          tidalEnqueueMessage({ id, text, ...(imagePath ? { imagePath } : {}), ...(filePath ? { filePath, fileName, fileSize: parsed.fileSize, fileType: parsed.fileType } : {}), clientTime: parsed.clientTime, queuedAt: Date.now() })
          return
        }

        if (currentTurn) {
          // Never overwrite an in-flight turn. Tell only the sender.
          const busy: TurnBusyWire = { type: 'turn_busy', turnId: currentTurn.turnId, ts: Date.now() }
          try {
            ws.send(JSON.stringify(busy))
          } catch (err) {
            log('ws_send_error', { error: String(err) })
          }
          log('turn_busy_rejected', { attemptedId: id, openTurnId: currentTurn.turnId })
          return
        }

        beginMainCcTurn({ id, text, ...(imagePath ? { imagePath } : {}), ...(filePath ? { filePath, fileName, fileSize: parsed.fileSize, fileType: parsed.fileType } : {}), clientTime: parsed.clientTime, queuedAt: Date.now() })
      } catch (err) {
        log('ws_message_error', { error: String(err) })
      }
    },
  },
})

// ---------- internal server: 127.0.0.1:INTERNAL_PORT (hook callbacks only) ----------
// Not referenced anywhere in cloudflared's ingress config — a request to
// https://companion.xiaoman.xyz/internal/* never reaches this listener at all,
// it 404s on the PUBLIC server above (which has no /internal/* route) before
// this port is ever involved.

const internalFetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)

    if (url.pathname === '/internal/turn-end' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const turnId = endTurn()
      log('turn_end', { turnId })
      return new Response(null, { status: 204 })
    }

    // Called by xinchao when its own rules say a dream is due. Returns as soon
    // as the request is handed to the session — generation takes tens of
    // seconds and xinchao must not block on it.
    if (url.pathname === '/internal/dream-request' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      reapPendingDreams()
      // A dream is never worth interrupting a live conversation for — xinchao
      // should simply try again on its next tick.
      if (currentTurn) return jsonResponse({ ok: false, reason: 'busy' }, { status: 503 })
      const dreamId = typeof (body as any)?.dreamId === 'string' && (body as any).dreamId ? (body as any).dreamId : nextId()
      const callbackUrl = typeof (body as any)?.callbackUrl === 'string' ? (body as any).callbackUrl : ''
      pendingDreams.set(dreamId, { callbackUrl, requestedAt: Date.now() })
      notifyCcOfDreamRequest(dreamId, body as Record<string, unknown>)
      return jsonResponse({ ok: true, dreamId })
    }

    // Called by the session itself once the subagent has written the dream.
    // Forwarded to whatever callback xinchao supplied, so this server never
    // needs to know xinchao's address or route shape.
    if (url.pathname === '/internal/dream-result' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const dreamId = String((body as any)?.dreamId ?? '')
      const pending = pendingDreams.get(dreamId)
      if (!pending) return jsonResponse({ ok: false, reason: 'unknown_dream_id' }, { status: 404 })
      pendingDreams.delete(dreamId)
      const result = {
        dreamId,
        dream: String((body as any)?.dream ?? ''),
        residue: String((body as any)?.residue ?? ''),
        awareness: String((body as any)?.awareness ?? ''),
      }
      // Kept on disk regardless of whether the callback lands — a dream that
      // was written but failed to deliver should still be recoverable.
      try {
        appendFileSync(join(ROOT, 'state', 'dreams.jsonl'), JSON.stringify({ ...result, at: new Date().toISOString() }) + '\n')
      } catch (err) {
        log('dream_persist_error', { dreamId, error: String(err) })
      }
      if (!pending.callbackUrl) {
        log('dream_result_no_callback', { dreamId })
        return jsonResponse({ ok: true, delivered: false, reason: 'no_callback_url' })
      }
      // xinchao's own /internal/dream-writeback sits behind the same Bearer
      // auth as its other routes (see notifyCcOfDreamRequest above) — this
      // forward never carried it, so even a populated callbackUrl would
      // have 401'd silently (delivered:false, easy to miss in logs).
      const delivered = await fetch(pending.callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(xinchaoToken ? { Authorization: `Bearer ${xinchaoToken}` } : {}) },
        body: JSON.stringify(result),
      }).then((r) => r.ok).catch((err) => {
        log('dream_callback_error', { dreamId, error: String(err) })
        return false
      })
      log('dream_result_forwarded', { dreamId, delivered })
      return jsonResponse({ ok: true, delivered })
    }

    // Closes the gap the production dream-request prompt itself promises
    // ("早上八点心潮会另外叫你把它讲给用户听") but that nothing ever actually
    // triggered — dream-request/dream-result only write the dream down,
    // silently, on purpose (2-4am, user asleep). Nothing analogous to
    // proactive-inject's timer exists yet for the morning share, so for now
    // this is invoked manually (see the 2026-08-06 makeup-dream backfill);
    // wiring a real 8am systemd timer to it is a separate, later step.
    if (url.pathname === '/internal/dream-announce' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      if (currentTurn) return jsonResponse({ ok: false, reason: 'busy' }, { status: 503 })
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const dream = typeof (body as any)?.dream === 'string' ? (body as any).dream : ''
      const residue = typeof (body as any)?.residue === 'string' ? (body as any).residue : ''
      const awareness = typeof (body as any)?.awareness === 'string' ? (body as any).awareness : ''
      const note = typeof (body as any)?.note === 'string' ? (body as any).note : ''
      if (!dream) return jsonResponse({ ok: false, reason: 'empty_dream' }, { status: 400 })
      const id = nextId()
      startTurn(id)
      dreamAnnounceTurnId = id
      deliver(id, `[系统提示，不是用户发的消息，不要机械复述这段提示]心潮请求你现在把一个梦讲给用户听。

梦境：${dream}
醒后的残留感受：${residue}
${awareness ? `你自己的知觉：${awareness}\n` : ''}${note ? `背景：${note}\n` : ''}
用你自己的方式自然地跟TA提起/分享这个梦，不用逐字复述以上内容，语气由你自己判断——这一轮请直接对用户说话（调用 reply 或 send_voice）。`)
      log('dream_announce_delivered', { id })
      return jsonResponse({ ok: true, id })
    }

    if (url.pathname === '/internal/tool-use' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      broadcastToolUse(
        typeof (body as any)?.tool === 'string' ? (body as any).tool : '',
        typeof (body as any)?.detail === 'string' ? (body as any).detail : '',
      )
      return new Response(null, { status: 204 })
    }

    if (url.pathname === '/internal/turn-error' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const error = typeof (body as any)?.error === 'string' ? (body as any).error : 'unknown'
      const turnId = failTurn(error)
      log('turn_error', { turnId, error })
      return new Response(null, { status: 204 })
    }

    // Called only by the local proactive-check.sh systemd timer script,
    // which has already confirmed the proactive master switch is on before
    // ever reaching here. Injects a short channel notification — never a
    // WS broadcast, never added to `history`, never a fake user bubble —
    // that the resident session may act on by calling the reply tool if it
    // decides a message is worth sending. Skipped (not queued) if a real
    // user turn is already in flight, so it can never interleave with one.
    //
    // startTurn() here is load-bearing, not decorative: currentTurn is the
    // ONLY thing that makes a real inbound /ws message or /model/switch
    // request busy-reject instead of firing concurrently at the single
    // serial Claude Code process. Without it, a real user message arriving
    // while Claude is still mid-proactive-turn gets deliver()'d on top of
    // the still-running proactive turn — two concurrent notifications into
    // one serial REPL, which is how a real reply can go out (reply_sent
    // logged) while the user's own turn silently loses its own reply/turn_end
    // and the frontend just hangs. The synthetic turn_start this broadcasts
    // is harmless: no currently-connected listener reacts to turn_start by
    // turnId unless it's their own generator's turnId, and this one belongs
    // to nobody's active generator.
    if (url.pathname === '/internal/proactive-inject' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      // Self-paced schedule check FIRST — this is what makes the systemd
      // timer's own frequent tick a cheap poll rather than the real cadence.
      // Most ticks land here and return immediately, no turn opened at all.
      const schedule = readProactiveSchedule()
      if (Date.now() < schedule.nextAt) {
        return jsonResponse({ ok: false, skipped: 'not_due', nextAt: schedule.nextAt })
      }
      if (resetInFlight) {
        log('proactive_inject_skipped', { reason: 'reset_in_progress' })
        return jsonResponse({ ok: false, skipped: 'reset_in_progress' })
      }
      if (currentTurn) {
        log('proactive_inject_skipped', { reason: 'turn_in_progress', turnId: currentTurn.turnId })
        return jsonResponse({ ok: false, skipped: 'turn_in_progress' })
      }
      const id = nextId()
      startTurn(id)
      proactiveTurnId = id
      // Best-effort, additive-only: a compact read of xinchao's already-
      // computed state/intent, folded into this SAME proactive-check
      // notification (never a separate turn, never touching normal chat).
      // If xinchao is down or returns nothing usable, the check just
      // proceeds exactly as before — this must never block or fail it.
      const xinchaoSummary = await fetchXinchaoSummary(XINCHAO_CC_SESSION_ID)
      const xinchaoHint = xinchaoSummary
        ? [
            `主要驱动力：${xinchaoSummary.topDriveOfficialLabel || '未知'}`,
            `状态：${xinchaoSummary.consciousness === 'awake' ? '清醒' : '休息/睡眠'}`,
            `疲劳：${Math.round(xinchaoSummary.fatigue * 100)}%`,
            xinchaoSummary.tone ? `近期基调：${xinchaoSummary.tone}` : null,
            xinchaoSummary.recentEvents.length
              ? `最近有效互动：${xinchaoSummary.recentEvents.map((e) => XINCHAO_INTERACTION_LABELS[e.interactionType] ?? e.interactionType).join('、')}`
              : null,
          ].filter(Boolean).join('；')
        : null
      deliver(id, JSON.stringify({
        kind: 'proactive_check',
        scheduledAt: new Date().toISOString(),
        scheduleNote: '这一轮结束前，无论你是否发了消息，都必须调用一次 schedule_next_proactive 来决定下次什么时候再来看看——现在没有固定间隔了，完全由你自己判断。',
        ...(xinchaoHint ? {
          xinchaoHint,
          xinchaoHintNote: '以上心潮内容只是动态背景参考，自然带入即可——不要机械复述这几个词、不要套用固定台词、不要因为看到这些数据就强行表演情绪。',
        } : {}),
      }))
      log('proactive_inject', { id, hasXinchaoHint: !!xinchaoHint })
      return jsonResponse({ ok: true, id })
    }

    // Codex runtime controls. These routes are internal-only and target the
    // app-server child, never the Claude/tmux MCP parent. The status endpoint
    // is useful to operators and the restart endpoint is intentionally safe by
    // default: an active Codex turn must be explicitly forced.
    if (url.pathname === '/internal/codex/status' && req.method === 'GET') {
      if (!internalAuthOk(req)) return unauthorized()
      return jsonResponse({
        ok: true,
        processRunning: !!codexProc,
        pid: codexProc?.pid ?? null,
        activeTurns: codexActiveTurnCount(),
        restartInFlight: codexRestartInFlight,
      })
    }

    if (url.pathname === '/internal/codex/restart' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const force = body?.force === true
      const result = await codexRestartProcess(force)
      if (!result.ok) {
        const status = result.reason === 'active_turn' || result.reason === 'restart_in_progress' ? 409 : 503
        return jsonResponse(result, { status })
      }
      return jsonResponse(result)
    }

    // Bridge for Codex's own real send_voice tool (see codex-voice-mcp.ts —
    // a separate stdio MCP server registered for the companion user via
    // `codex mcp add`, loaded automatically for every Codex thread). Codex
    // is a completely different process from the resident `claude` CLI that
    // calls the reply/send_voice handlers above directly in-process — this
    // is the ONLY channel by which its own send_voice tool call reaches this
    // server. Only accepted while a real MAIN-CHAT turn is actually in
    // flight (codexCurrentTurnId) — the dedicated gomoku thread also has
    // this tool attached (config is global per companion-user, not
    // per-thread), but never asks for it and has no codexCurrentTurnId of
    // its own, so a stray call arriving from that thread is safely rejected
    // here rather than misattributed into the main chat.
    if (url.pathname === '/internal/codex/send-voice' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const text = typeof (body as any)?.text === 'string' ? (body as any).text.trim() : ''
      const voice = typeof (body as any)?.voice === 'string' ? (body as any).voice : undefined
      const style = typeof (body as any)?.style === 'string' ? (body as any).style : undefined
      if (!text) return jsonResponse({ ok: false, error: 'empty text' }, { status: 400 })
      // The legacy voice bridge has no caller-thread id in its MCP payload.
      // Refuse it while any per-session thread is active rather than risking
      // a voice message from another session being attributed to main.
      if ([...extraCodexSessions.values()].some((state) => !!state.currentTurnId)) {
        return jsonResponse({ ok: false, error: 'voice bridge is limited to the main Codex session' }, { status: 409 })
      }
      if (!codexCurrentTurnId) return jsonResponse({ ok: false, error: 'no active codex conversation turn' }, { status: 409 })
      const id = nextId()
      codexAppendMsg({ id, from: 'codex', text, ts: Date.now(), kind: 'voice', voice, style, turnId: codexCurrentTurnId })
      log('codex_voice_sent', { id, chars: text.length, turnId: codexCurrentTurnId })
      return jsonResponse({ ok: true, id })
    }

    // Bridge for Codex's real Focus tools (see codex-voice-mcp.ts, extended
    // with these alongside send_voice — same trusted MCP server, same
    // auto-approved elicitation gate). Codex is the FocusManager whenever
    // any of these are called on its behalf; FOCUS_CODEX_MANAGER is a single
    // fixed identity (Codex only ever has one main session) mirroring
    // FOCUS_CC_MANAGER's own comment for why that's safe.
    if (url.pathname.startsWith('/internal/focus/') && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>
      const action = url.pathname.slice('/internal/focus/'.length)
      switch (action) {
        case 'start': {
          const result = focusStart({ task: String(body.task ?? ''), minutes: Number(body.minutes), manager: FOCUS_CODEX_MANAGER })
          return jsonResponse(result)
        }
        case 'extend': {
          const result = focusExtend(FOCUS_CODEX_MANAGER, Number(body.minutes))
          return jsonResponse(result)
        }
        case 'finish': {
          const result = focusManagerFinish(FOCUS_CODEX_MANAGER)
          return jsonResponse(result)
        }
        case 'approve': {
          const result = focusResolveRequest(FOCUS_CODEX_MANAGER, String(body.requestId ?? ''), true, typeof body.message === 'string' ? body.message : undefined)
          return jsonResponse(result)
        }
        case 'deny': {
          const reason = String(body.reason ?? '')
          if (!reason.trim()) return jsonResponse({ ok: false, reason: 'reason_required' })
          const result = focusResolveRequest(FOCUS_CODEX_MANAGER, String(body.requestId ?? ''), false, reason)
          return jsonResponse(result)
        }
        case 'pause': {
          const requestId = String(body.requestId ?? '')
          if (focusState.pendingRequest?.id === requestId && focusState.pendingRequest.kind !== 'pause') {
            return jsonResponse({ ok: false, reason: 'not_a_pause_request' })
          }
          const result = focusResolveRequest(FOCUS_CODEX_MANAGER, requestId, true, undefined)
          return jsonResponse(result)
        }
        case 'stop': {
          const requestId = String(body.requestId ?? '')
          if (focusState.pendingRequest?.id === requestId && focusState.pendingRequest.kind !== 'end') {
            return jsonResponse({ ok: false, reason: 'not_an_end_request' })
          }
          const result = focusResolveRequest(FOCUS_CODEX_MANAGER, requestId, true, undefined)
          return jsonResponse(result)
        }
        case 'resume': {
          if (!focusMatchesManager(FOCUS_CODEX_MANAGER)) return jsonResponse({ ok: false, reason: 'not_manager' })
          const result = focusResume()
          return jsonResponse(result)
        }
        default:
          return jsonResponse({ ok: false, reason: 'unknown_action' }, { status: 404 })
      }
    }
    if (url.pathname === '/internal/focus/status' && req.method === 'GET') {
      if (!internalAuthOk(req)) return unauthorized()
      return jsonResponse(focusPublicState())
    }

    // Bridge for Codex's real group_speak/group_request_to_speak/group_pass
    // tools (see codex-voice-mcp.ts) — trust boundary is codexGroupPending
    // itself (which group/phase is genuinely active right now), never a
    // client-supplied groupId/phase, exactly matching send_voice's own
    // codexCurrentTurnId-gated trust model.
    if (url.pathname === '/internal/group/speak' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const text = typeof (body as any)?.text === 'string' ? (body as any).text.trim() : ''
      if (!codexGroupPending) return jsonResponse({ ok: false, reason: 'no_active_group_turn' })
      if (!text) return jsonResponse({ ok: false, reason: 'empty_text' })
      const { chatId, phase, candidateId } = codexGroupPending
      return jsonResponse(groupMemberSpeak(chatId, 'codex', text, phase, candidateId))
    }
    if (url.pathname === '/internal/group/request-to-speak' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      const body = await req.json().catch(() => ({} as Record<string, unknown>))
      const direction = typeof (body as any)?.direction === 'string' ? (body as any).direction.trim() : ''
      if (!codexGroupPending) return jsonResponse({ ok: false, reason: 'no_active_group_turn' })
      if (codexGroupPending.phase !== 'candidate') return jsonResponse({ ok: false, reason: 'not_applicable_this_phase' })
      if (!direction) return jsonResponse({ ok: false, reason: 'empty_direction' })
      return jsonResponse(groupCreateCandidate(codexGroupPending.chatId, 'codex', direction))
    }
    if (url.pathname === '/internal/group/pass' && req.method === 'POST') {
      if (!internalAuthOk(req)) return unauthorized()
      if (!codexGroupPending) return jsonResponse({ ok: false, reason: 'no_active_group_turn' })
      if (codexGroupPending.phase === 'expand' && codexGroupPending.candidateId) {
        groupCancelApprovedCandidate(codexGroupPending.chatId, codexGroupPending.candidateId)
      }
      return jsonResponse({ ok: true })
    }

    return new Response('not found', { status: 404 })
}

// The internal API listens on loopback AND on the Docker bridge address, so
// services in containers on this host (xinchao, which needs to hand its dream
// settlement to the resident session) can reach it — inside a container
// 127.0.0.1 is the container itself, not the host, so loopback alone is
// unreachable to them no matter what they do.
//
// Deliberately NOT 0.0.0.0: the bridge address is only routable from this
// host and its containers, so binding it adds no external surface. Every
// route here still requires X-Internal-Secret regardless of which listener
// accepted the connection — the binding widens who can knock, never who gets in.
const INTERNAL_HOSTS = ['127.0.0.1', ...(process.env.AI_COMPANION_DOCKER_BRIDGE_HOST ?? '172.17.0.1').split(',')]
  .map((h) => h.trim())
  .filter(Boolean)

const internalBound: string[] = []
for (const hostname of INTERNAL_HOSTS) {
  try {
    Bun.serve({ port: INTERNAL_PORT, hostname, fetch: internalFetch })
    internalBound.push(hostname)
  } catch (err) {
    // A bridge that doesn't exist on this host (no Docker, renamed interface)
    // must not take the whole server down with it — loopback is what the
    // hooks use, and it is bound first.
    log('internal_bind_skipped', { hostname, error: String(err) })
  }
}

process.stderr.write(`ai-companion: public on http://127.0.0.1:${PORT}, internal on ${internalBound.map((h) => `http://${h}:${INTERNAL_PORT}`).join(', ')}\n`)
log('startup', { port: PORT, internalPort: INTERNAL_PORT, internalBound })

// Delayed because this process is spawned as claude's own stdio MCP child:
// at this point the session on the other end is still wiring itself up and a
// channel notification would land before anything can receive it. 12s is well
// past ready without being long enough for the user to get an answer from a
// session that hasn't yet admitted it was restarted.
setTimeout(announceSessionStart, 12_000)
// Resume/rollback an interrupted two-phase tide only after the resident MCP
// channel is fully ready. This never starts a tide merely because the service
// restarted; a new tide is evaluated only after a real main-chat reply ends.
setTimeout(resumeTidalAfterStartup, 18_000)
