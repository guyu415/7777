#!/usr/bin/env bun
/**
 * Stable stdio MCP proxy for the resident Claude Code process.
 *
 * Claude owns this small process for the lifetime of the resident session.
 * The large channel-server.ts runs as its child and may be reloaded with
 * SIGHUP without closing Claude's stdio pipes or resuming the whole session.
 * The proxy replays the MCP initialize handshake into the replacement child,
 * then releases any client messages that arrived during the short reload.
 *
 * stdout is MCP JSON-RPC only. Operational messages go to stderr/the log.
 */

import { appendFileSync, chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname } from 'path'

type RpcMessage = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

const ROOT = dirname(new URL(import.meta.url).pathname)
const LOG_FILE = process.env.AI_COMPANION_CHANNEL_PROXY_LOG ?? `${ROOT}/logs/channel-proxy.log`
const PID_FILE = process.env.AI_COMPANION_CHANNEL_PROXY_PID_FILE ?? `${ROOT}/state/channel-proxy.pid`
const STATUS_FILE = process.env.AI_COMPANION_CHANNEL_PROXY_STATUS_FILE ?? `${ROOT}/state/channel-proxy-status.json`
const HEALTH_URL = process.env.AI_COMPANION_CHANNEL_HEALTH_URL ?? 'http://127.0.0.1:8788/health'
const SAFE_WAIT_MS = Number(process.env.AI_COMPANION_CHANNEL_RELOAD_SAFE_WAIT_MS ?? 10 * 60_000)
const command = parseCommand(process.env.AI_COMPANION_CHANNEL_COMMAND)

let child: ReturnType<typeof Bun.spawn> | null = null
let childGeneration = 0
let childStdoutGeneration = 0
let shuttingDown = false
let reloadRequested = false
let reloadInFlight = false
let replayId: string | null = null
let replayTimer: ReturnType<typeof setTimeout> | null = null
let initializeRequest: RpcMessage | null = null
let initializedNotification: RpcMessage | null = null
let inputBuffer = ''
let queuedClientLines: string[] = []
const pendingClientRequests = new Set<string>()

function parseCommand(raw: string | undefined): string[] {
  if (!raw) return ['bun', 'run', `${ROOT}/channel-server.ts`]
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((v) => typeof v === 'string' && v.length > 0)) return parsed
  } catch {}
  throw new Error('AI_COMPANION_CHANNEL_COMMAND must be a non-empty JSON string array')
}

function log(event: string, detail: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...detail }) + '\n'
  try { appendFileSync(LOG_FILE, line) } catch {}
  if (process.env.AI_COMPANION_CHANNEL_PROXY_DEBUG === '1') {
    process.stderr.write(`channel-proxy: ${event}${Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ''}\n`)
  }
}

function writeStatus(phase: string, detail: Record<string, unknown> = {}) {
  const value = {
    pid: process.pid,
    childPid: child?.pid ?? null,
    generation: childGeneration,
    phase,
    reloadRequested,
    reloadInFlight,
    initialized: !!initializeRequest,
    pendingRequests: pendingClientRequests.size,
    updatedAt: Date.now(),
    ...detail,
  }
  const tmp = `${STATUS_FILE}.tmp.${process.pid}`
  try {
    writeFileSync(tmp, JSON.stringify(value) + '\n', { mode: 0o600 })
    renameSync(tmp, STATUS_FILE)
  } catch {}
}

function idKey(id: unknown): string | null {
  return typeof id === 'string' || typeof id === 'number' ? JSON.stringify(id) : null
}

function parseRpc(line: string): RpcMessage | null {
  try {
    const parsed = JSON.parse(line)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as RpcMessage : null
  } catch {
    return null
  }
}

function childWrite(line: string) {
  const proc = child
  if (!proc) {
    queuedClientLines.push(line)
    return
  }
  try {
    ;(proc.stdin as any).write(line + '\n')
    ;(proc.stdin as any).flush?.()
  } catch (error) {
    queuedClientLines.push(line)
    log('child_stdin_write_failed', { error: String(error) })
  }
}

function forwardClientLine(line: string) {
  const msg = parseRpc(line)
  if (msg?.method === 'initialize' && idKey(msg.id)) {
    initializeRequest = structuredClone(msg)
    writeStatus(reloadInFlight ? 'reinitializing' : 'ready')
  }
  if (msg?.method === 'notifications/initialized') initializedNotification = structuredClone(msg)

  if (reloadInFlight || !child) {
    queuedClientLines.push(line)
    return
  }
  const key = msg?.method ? idKey(msg.id) : null
  if (key) pendingClientRequests.add(key)
  childWrite(line)
}

function finishReload() {
  if (replayTimer) clearTimeout(replayTimer)
  replayTimer = null
  replayId = null
  reloadInFlight = false
  reloadRequested = false
  const queued = queuedClientLines
  queuedClientLines = []
  for (const line of queued) forwardClientLine(line)
  writeStatus('ready', { lastReloadAt: Date.now() })
  log('reload_ready', { generation: childGeneration, childPid: child?.pid ?? null, releasedMessages: queued.length })
}

function handleChildLine(line: string, generation: number) {
  if (generation !== childStdoutGeneration) return
  const msg = parseRpc(line)
  const key = idKey(msg?.id)
  if (replayId && key === JSON.stringify(replayId)) {
    childWrite(JSON.stringify(initializedNotification ?? { jsonrpc: '2.0', method: 'notifications/initialized' }))
    finishReload()
    return
  }
  if (key && !msg?.method) pendingClientRequests.delete(key)
  process.stdout.write(line + '\n')
}

async function consumeChildStdout(proc: ReturnType<typeof Bun.spawn>, generation: number) {
  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trimEnd()
        buffer = buffer.slice(newline + 1)
        if (line) handleChildLine(line, generation)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) handleChildLine(buffer.trimEnd(), generation)
  } catch (error) {
    if (!shuttingDown) log('child_stdout_failed', { generation, error: String(error) })
  }
}

function beginReplay() {
  if (!initializeRequest) {
    finishReload()
    return
  }
  replayId = `channel-proxy-reinit-${process.pid}-${childGeneration}`
  const replay = structuredClone(initializeRequest)
  replay.id = replayId
  childWrite(JSON.stringify(replay))
  replayTimer = setTimeout(() => {
    log('replay_timeout', { generation: childGeneration })
    writeStatus('replay_timeout')
    void restartChild('replay_timeout', true)
  }, 15_000)
}

function spawnChild(replaying: boolean) {
  childGeneration += 1
  childStdoutGeneration = childGeneration
  const proc = Bun.spawn(command, {
    cwd: ROOT,
    env: process.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  child = proc
  log('child_started', { generation: childGeneration, childPid: proc.pid, replaying })
  writeStatus(replaying ? 'reinitializing' : 'ready')
  void consumeChildStdout(proc, childGeneration)
  void proc.exited.then((code) => childExited(proc, childGeneration, code))
  if (replaying) beginReplay()
  else if (queuedClientLines.length) {
    const queued = queuedClientLines
    queuedClientLines = []
    for (const line of queued) forwardClientLine(line)
  }
}

async function childExited(proc: ReturnType<typeof Bun.spawn>, generation: number, code: number) {
  if (child !== proc) return
  child = null
  log('child_exited', { generation, code, planned: reloadInFlight || shuttingDown })
  if (shuttingDown) return
  if (reloadInFlight) return
  reloadInFlight = true
  writeStatus('recovering', { exitCode: code })
  await Bun.sleep(1_000)
  spawnChild(!!initializeRequest)
}

async function backendReloadSafe(): Promise<boolean> {
  if (pendingClientRequests.size > 0) return false
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_500)
  try {
    const response = await fetch(HEALTH_URL, { signal: controller.signal })
    if (!response.ok) return false
    const body = await response.json() as { reloadSafe?: unknown }
    return body.reloadSafe === true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function waitUntilSafe(): Promise<boolean> {
  const deadline = Date.now() + SAFE_WAIT_MS
  let safeReads = 0
  while (!shuttingDown && Date.now() < deadline) {
    if (await backendReloadSafe()) {
      safeReads += 1
      if (safeReads >= 2) return true
    } else {
      safeReads = 0
    }
    await Bun.sleep(1_000)
  }
  return false
}

async function restartChild(reason: string, force = false) {
  if (shuttingDown) return
  if (reloadInFlight && reason !== 'replay_timeout') return
  reloadRequested = true
  writeStatus(force ? 'restarting' : 'waiting_safe', { reason })
  log('reload_requested', { reason, force })
  if (!force && !(await waitUntilSafe())) {
    reloadRequested = false
    writeStatus('ready', { reloadSkipped: 'safe_wait_timeout' })
    log('reload_skipped', { reason: 'safe_wait_timeout' })
    return
  }

  reloadInFlight = true
  const old = child
  if (old) {
    try { old.kill('SIGTERM') } catch {}
    const exited = await Promise.race([old.exited.then(() => true), Bun.sleep(5_000).then(() => false)])
    if (!exited) {
      try { old.kill('SIGKILL') } catch {}
      await Promise.race([old.exited, Bun.sleep(2_000)])
    }
    if (child === old) child = null
  }
  spawnChild(!!initializeRequest)
}

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  reloadRequested = false
  writeStatus('stopping', { signal })
  log('stopping', { signal })
  const proc = child
  if (proc) {
    try { proc.kill('SIGINT') } catch {}
    await Promise.race([proc.exited, Bun.sleep(3_000)])
    try { proc.kill('SIGKILL') } catch {}
  }
  try {
    if (readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) unlinkSync(PID_FILE)
  } catch {}
  process.exit(0)
}

mkdirSync(dirname(LOG_FILE), { recursive: true })
mkdirSync(dirname(PID_FILE), { recursive: true })
writeFileSync(PID_FILE, `${process.pid}\n`, { mode: 0o600 })
try { chmodSync(PID_FILE, 0o600) } catch {}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk: string) => {
  inputBuffer += chunk
  let newline = inputBuffer.indexOf('\n')
  while (newline >= 0) {
    const line = inputBuffer.slice(0, newline).trimEnd()
    inputBuffer = inputBuffer.slice(newline + 1)
    if (line) forwardClientLine(line)
    newline = inputBuffer.indexOf('\n')
  }
})
process.stdin.on('end', () => void shutdown('stdin_end'))
process.on('SIGHUP', () => {
  if (reloadRequested || reloadInFlight) {
    log('reload_already_pending')
    return
  }
  void restartChild('sighup')
})
process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

log('proxy_started', { pid: process.pid, command })
spawnChild(false)
