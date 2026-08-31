// Codex's real tools that need a bridge back to channel-server.ts — a
// SEPARATE, dedicated stdio MCP server registered for the companion user via
// `codex mcp add codex-voice -- bun run /opt/ai-companion/codex-voice-mcp.ts`
// (see deploy notes), loaded automatically by `codex app-server` for every
// thread it spawns. This is NOT the "ai-companion" MCP server (that one is
// Claude Code's own — a completely different process, spawned by the
// resident `claude` CLI over its own stdio, exposing reply/send_voice/
// gomoku_*/focus_* directly in-process). Codex is a separate process
// entirely; this script is the only bridge by which its tool calls reach
// channel-server.ts at all — kept under the original `codex-voice` server
// name (already trusted/auto-approved there, see channel-server.ts's
// codexIsTrustedMcpToolElicitation) rather than registering a second server,
// even though it now covers more than voice.
//
// send_voice: the actual voice message (text/voice/style) is delivered to
// the browser as a real codex_msg with kind:'voice' by channel-server.ts
// itself, via the internal-only HTTP bridge below — keeping the
// browser-facing wire path, dedup, and persistence exactly the same as every
// other Codex message.
//
// play_music_on_phone: resolves a NetEase catalog item and delivers a real
// app-opening card. Audio remains inside the official phone app.
//
// start_focus/get_focus_status/extend_focus/finish_focus/
// approve_focus_request/deny_focus_request/pause_focus/stop_focus/
// resume_focus: real control over the single GLOBAL Focus (专注) task — see
// channel-server.ts's own Focus section for the full state machine. Every
// one of these is a genuine mutation (or read) of that one shared state,
// never a local simulation.
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = '/opt/ai-companion'
const INTERNAL_PORT = Number(process.env.AI_COMPANION_INTERNAL_PORT ?? 8789)
const INTERNAL_SECRET_FILE = process.env.AI_COMPANION_INTERNAL_SECRET_FILE ?? join(ROOT, 'config', 'internal.secret')

let internalSecret = ''
try {
  internalSecret = readFileSync(INTERNAL_SECRET_FILE, 'utf8').trim()
} catch (err) {
  process.stderr.write(`codex-voice-mcp: FATAL - could not read internal secret at ${INTERNAL_SECRET_FILE}: ${err}\n`)
  process.exit(1)
}

async function callInternal(path: string, opts: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${INTERNAL_PORT}${path}`, {
    method: opts.method ?? 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  })
  const body = await res.json().catch(() => ({}) as Record<string, unknown>)
  return { ok: res.ok, status: res.status, body }
}

const mcp = new Server(
  { name: 'codex-voice', version: '0.2.0' },
  { capabilities: { tools: {} } },
)

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'send_voice',
      description:
        'Send a SHORT voice message instead of text — use this when the user explicitly asks you to speak/send voice ' +
        '(e.g. "发语音", "说给我听", "语音回复我"), or occasionally yourself for a short warm/casual reply. Most turns ' +
        'should still just be normal text. The app synthesizes real speech from `text` using this conversation\'s ' +
        'configured voice; if synthesis is unavailable, it degrades to showing `text` as a normal message with a ' +
        'clear status note — never silently. Keep text SHORT (well under 300 characters).',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string', maxLength: 300 },
          voice: { type: 'string', description: 'optional TTS voice id override; omit to use the conversation default' },
          style: { type: 'string', description: 'optional style/emotion hint; not all voices support this' },
        },
        required: ['text'],
      },
    },
    {
      name: 'play_music_on_phone',
      description:
        'Find a song and send a REAL visible “在网易云播放” card. Use only when the user explicitly asks to ' +
        'play/hear/pick/change a song. The button opens the official NetEase Cloud Music app on their phone, so ' +
        'full/member playback uses their logged-in mobile account and no audio passes through the overseas VPS. ' +
        'Do not say it is already playing; say it is ready to tap. This tool itself posts the visible reply, so ' +
        'do not duplicate it with a normal text answer.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', maxLength: 100, description: 'song title' },
          artist: { type: 'string', maxLength: 100, description: 'optional artist for exact matching' },
          text: { type: 'string', maxLength: 300, description: 'optional short message shown above the play button' },
        },
        required: ['title'],
      },
    },
    {
      name: 'get_music_context',
      description:
        'Read the song and estimated current lyric from the user\'s NetEase phone-play card. Use when the user ' +
        'asks about what is playing or the current lyric. The returned position is estimated, not native iOS playback telemetry.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'start_focus',
      description:
        'Genuinely start a focus/Pomodoro session for the user RIGHT NOW — a real global action, not a suggestion: ' +
        'their app immediately switches to a full-screen countdown, already running, no click needed from them. ' +
        'Only call this when the user has actually asked to focus/study/work (or clearly agreed to your offer) — ' +
        'never start one unprompted. Fails if a focus session is already active (anyone\'s — call get_focus_status ' +
        'first if unsure). You become its sole manager: only you can extend/finish it or approve/deny the user\'s ' +
        'later pause/end requests. While it runs, the user may talk to you from the focus screen (delivered as a ' +
        'real turn on this same conversation) and may ask to pause or end early (you must decide via the real ' +
        'approve/deny/pause_focus/stop_focus tools, not just in words).',
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
        'Read the current real global focus state — active or not, task, minutes, status (running/paused), who (if ' +
        'anyone) manages it, and any pending pause/end request. Use this before start_focus, or anytime to check on ' +
        'a session you manage.',
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
        'early instead, that comes to you as a request to approve/deny — use approve_focus_request/stop_focus/' +
        'deny_focus_request for that, never this.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'approve_focus_request',
      description:
        'Approve the user\'s currently pending pause OR end request (whichever kind it is — check get_focus_status ' +
        'if unsure). Only works on the exact pending requestId. Generic — pause_focus/stop_focus do the same thing ' +
        'but validate the kind for you if you\'d rather be explicit about which one you\'re approving.',
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
        'real remaining time.',
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
        'use pause_focus for that). Ends the session now as an early end (never counted as a full completion).',
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
        'Post a real message to the multi-AI group chat you are currently being asked about. Only valid when you ' +
        'actually have permission to speak right now (you were @-mentioned, you still have free credits this ' +
        'topic, or your earlier group_request_to_speak direction was just approved) — if your free credits are ' +
        'exhausted and this is a plain turn, this fails; use group_request_to_speak instead.',
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
        '@-mentioned: instead of speaking directly, give a VERY short direction (about 4-12 Chinese characters) ' +
        'describing roughly what you want to say — NOT the actual content. The user sees this and decides whether ' +
        'to let you expand on it in a later real turn.',
      inputSchema: {
        type: 'object',
        properties: { direction: { type: 'string', maxLength: 24 } },
        required: ['direction'],
      },
    },
    {
      name: 'group_pass',
      description: 'Stay quiet this round in the group chat — a genuine, common, expected choice when you have nothing worth adding.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}))

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'send_voice': {
        const text = String(args.text ?? '').trim()
        const voice = typeof args.voice === 'string' ? args.voice : undefined
        const style = typeof args.style === 'string' ? args.style : undefined
        if (!text) return { content: [{ type: 'text', text: 'text is required and was empty' }], isError: true }
        const { ok, body, status } = await callInternal('/internal/codex/send-voice', { body: { text, voice, style } })
        if (!ok || !body?.ok) return { content: [{ type: 'text', text: `failed to deliver voice message: ${body?.error ?? status}` }], isError: true }
        return { content: [{ type: 'text', text: `sent (${body.id ?? 'ok'})` }] }
      }
      case 'play_music_on_phone': {
        const title = String(args.title ?? '').trim()
        const artist = typeof args.artist === 'string' ? args.artist.trim() : undefined
        const text = typeof args.text === 'string' ? args.text.trim() : undefined
        if (!title) return { content: [{ type: 'text', text: 'title is required and was empty' }], isError: true }
        const { ok, body, status } = await callInternal('/internal/codex/play-music-on-phone', { body: { title, artist, text } })
        if (!ok || !body?.ok) return { content: [{ type: 'text', text: `failed to deliver NetEase action: ${body?.error ?? status}` }], isError: true }
        return { content: [{ type: 'text', text: `sent NetEase phone action (${body.id ?? 'ok'})` }] }
      }
      case 'get_music_context': {
        const { ok, body, status } = await callInternal('/internal/codex/music-context', { method: 'GET' })
        if (!ok) return { content: [{ type: 'text', text: `failed to read music context: ${status}` }], isError: true }
        return { content: [{ type: 'text', text: JSON.stringify(body) }] }
      }
      case 'get_focus_status': {
        const { ok, body, status } = await callInternal('/internal/focus/status', { method: 'GET' })
        if (!ok) return { content: [{ type: 'text', text: `failed: ${status}` }], isError: true }
        return { content: [{ type: 'text', text: JSON.stringify(body) }] }
      }
      case 'start_focus': {
        const task = String(args.task ?? '')
        const minutes = Number(args.minutes)
        const { body } = await callInternal('/internal/focus/start', { body: { task, minutes } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: `started — task:"${body.state?.task}" minutes:${body.state?.minutes}` }] }
      }
      case 'extend_focus': {
        const { body } = await callInternal('/internal/focus/extend', { body: { minutes: Number(args.minutes) } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'extended' }] }
      }
      case 'finish_focus': {
        const { body } = await callInternal('/internal/focus/finish', { body: {} })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'finished — counted as a real completion' }] }
      }
      case 'approve_focus_request': {
        const requestId = String(args.requestId ?? '')
        const message = typeof args.message === 'string' ? args.message : undefined
        const { body } = await callInternal('/internal/focus/approve', { body: { requestId, message } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'approved' }] }
      }
      case 'deny_focus_request': {
        const requestId = String(args.requestId ?? '')
        const reason = String(args.reason ?? '')
        if (!reason.trim()) return { content: [{ type: 'text', text: 'reason is required' }], isError: true }
        const { body } = await callInternal('/internal/focus/deny', { body: { requestId, reason } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'denied' }] }
      }
      case 'pause_focus': {
        const requestId = String(args.requestId ?? '')
        const { body } = await callInternal('/internal/focus/pause', { body: { requestId } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'paused' }] }
      }
      case 'stop_focus': {
        const requestId = String(args.requestId ?? '')
        const { body } = await callInternal('/internal/focus/stop', { body: { requestId } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'stopped' }] }
      }
      case 'resume_focus': {
        const { body } = await callInternal('/internal/focus/resume', { body: {} })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'resumed' }] }
      }
      case 'group_speak': {
        const text = String(args.text ?? '').trim()
        if (!text) return { content: [{ type: 'text', text: 'empty text' }], isError: true }
        const { body } = await callInternal('/internal/group/speak', { body: { text } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: `sent (${body.id})` }] }
      }
      case 'group_request_to_speak': {
        const direction = String(args.direction ?? '').trim()
        if (!direction) return { content: [{ type: 'text', text: 'empty direction' }], isError: true }
        const { body } = await callInternal('/internal/group/request-to-speak', { body: { direction } })
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: `candidate created (${body.candidate?.id})` }] }
      }
      case 'group_pass': {
        const { body } = await callInternal('/internal/group/pass')
        if (!body?.ok) return { content: [{ type: 'text', text: `failed: ${body?.reason}` }], isError: true }
        return { content: [{ type: 'text', text: 'ok, staying quiet' }] }
      }
      default:
        return { content: [{ type: 'text', text: `unknown tool: ${req.params.name}` }], isError: true }
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `${req.params.name}: failed — ${String(err)}` }], isError: true }
  }
})

await mcp.connect(new StdioServerTransport())
