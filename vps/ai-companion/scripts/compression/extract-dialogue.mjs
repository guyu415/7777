#!/usr/bin/env bun
// Extracts clean dialogue (no tool calls, no thinking, no slash-command noise)
// from the resident brain session's own Claude Code transcript JSONL.
//
// Source of truth for what counts as "real dialogue":
//   - the user's real side arrives as an MCP channel notification wrapped in
//     `<channel source="ai-companion" ... user="user" ...>...</channel>`,
//     built by deliver() in channel-server.ts as
//     clientTimeContextLine + contextPrefix? + deliverText. We strip the
//     time-context line and recognize the few known synthetic prefixes
//     (session-restart announcement, image-upload note) that are NOT
//     something the user actually typed.
//   - the companion's real side is never the assistant's plain trailing
//     text (that's an invisible turn-closer, see channel-server.ts's own
//     instructions) — it is the `text` input of a `reply` / `send_voice`
//     tool_use call, exactly what actually reached the user.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/opt/ai-companion'
const HOME = '/home/companion'
const TRANSCRIPT_DIR = join(HOME, '.claude', 'projects', '-opt-ai-companion')
const SESSION_ID_FILE = join(ROOT, 'state', 'brain-session-id')
const OUT_DIR = join(ROOT, 'compression')

// No fixed persona name exists anywhere in this project's code or config
// (channel-server.ts deliberately injects no persona/name override — see its
// own comments) — a name here would just be invented, so the AI side is
// labeled generically. Do not hardcode a name pulled from some other
// document (briefing-design.md is a DIFFERENT AI/human pair's own reference
// doc, not this deployment's identity — that mistake shipped once already).
const CHARACTER_NAME = 'AI'

function stripTimeContext(text) {
  return text.replace(/^\s*\[此刻用户设备本地时间：.*?\]\n\n/, '')
}

function classifyUserChannelContent(raw) {
  let text = stripTimeContext(raw.replace(/^\s+/, ''))
  if (text.startsWith('[系统提示，不是用户发的消息')) return null // synthetic announcement, not real speech (covers the "，不要回复"/"，不需要回复" variants too)
  const imgMatch = text.match(/^\[用户发送了一张图片[^\]]*\]\n?\n?/)
  if (imgMatch) {
    const rest = text.slice(imgMatch[0].length).trim()
    return rest ? `[发了一张图片] ${rest}` : '[发了一张图片]'
  }
  // Gomoku/other structured instructions — not conversational text, skip.
  if (/^用户请求悔棋|^用户在五子棋游戏界面里|落子在 \(\d/.test(text)) return null
  text = text.trim()
  return text ? text : null
}

function extractChannelUserText(rawContent) {
  const m = rawContent.match(/<channel[^>]*user="user"[^>]*>([\s\S]*?)<\/channel>/)
  if (!m) return null
  return classifyUserChannelContent(m[1])
}

function main() {
  // Normally resolves the CURRENT session via state/brain-session-id. The
  // PreCompact hook instead passes the exact transcript_path it got from
  // Claude Code itself — more precise (no race with brain-session-id
  // changing) and it's the only way to see the full PRE-compaction history,
  // since PreCompact fires before compaction rewrites anything.
  const explicitTranscriptPath = process.argv[2]
  const transcriptPath = explicitTranscriptPath || join(TRANSCRIPT_DIR, `${readFileSync(SESSION_ID_FILE, 'utf8').trim()}.jsonl`)
  const sessionId = explicitTranscriptPath
    ? explicitTranscriptPath.split('/').pop().replace(/\.jsonl$/, '')
    : readFileSync(SESSION_ID_FILE, 'utf8').trim()
  if (!existsSync(transcriptPath)) {
    console.error(`transcript not found: ${transcriptPath}`)
    process.exit(1)
  }

  const lines = readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean)
  const turns = []
  let earliestTs = null
  let latestTs = null

  for (const line of lines) {
    let d
    try { d = JSON.parse(line) } catch { continue }
    if (d.type !== 'user' && d.type !== 'assistant') continue
    const ts = d.timestamp ? new Date(d.timestamp) : null
    if (ts) {
      if (!earliestTs || ts < earliestTs) earliestTs = ts
      if (!latestTs || ts > latestTs) latestTs = ts
    }

    const msg = d.message
    if (!msg) continue

    if (d.type === 'user') {
      const content = msg.content
      const raw = typeof content === 'string' ? content : null
      if (!raw) continue
      // isMeta is true for BOTH real channel-injected chat AND slash-command
      // noise (/model, caveats) — isMeta alone can't distinguish them, only
      // the content shape can.
      if (raw.startsWith('<local-command-caveat>') || raw.startsWith('<command-name>') || raw.startsWith('<local-command-stdout>')) continue
      if (!raw.includes('<channel')) continue
      const text = extractChannelUserText(raw)
      if (text) turns.push({ from: 'user', text, ts })
      continue
    }

    if (d.type === 'assistant') {
      const content = msg.content
      if (!Array.isArray(content)) continue
      for (const block of content) {
        if (block.type !== 'tool_use') continue
        if (!/__reply$|__send_voice$/.test(block.name || '')) continue
        const text = block.input && typeof block.input.text === 'string' ? block.input.text.trim() : ''
        if (text) turns.push({ from: 'cc', text, ts })
      }
    }
  }

  const lines_out = []
  lines_out.push(`# 对话原文提取 — session ${sessionId}`)
  lines_out.push('')
  lines_out.push(`提取时间：${new Date().toISOString()}`)
  lines_out.push(`会话时间范围：${earliestTs?.toISOString() ?? '?'} ~ ${latestTs?.toISOString() ?? '?'}`)
  lines_out.push(`原始 transcript：${transcriptPath}`)
  lines_out.push(`提取出的对话轮数：${turns.length}`)
  lines_out.push('')
  lines_out.push('---')
  lines_out.push('')

  for (const t of turns) {
    const speaker = t.from === 'user' ? '用户' : CHARACTER_NAME
    const tsLabel = t.ts ? t.ts.toISOString().replace('T', ' ').slice(0, 19) : ''
    lines_out.push(`**[${tsLabel}] ${speaker}：** ${t.text}`)
    lines_out.push('')
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const outPath = join(OUT_DIR, `dialogue-${sessionId.slice(0, 8)}-${stamp}.md`)
  const latestPath = join(OUT_DIR, 'latest-dialogue.md')
  const latestJsonPath = join(OUT_DIR, 'latest-dialogue.json')
  const outContent = lines_out.join('\n')
  writeFileSync(outPath, outContent)
  writeFileSync(latestPath, outContent)
  writeFileSync(latestJsonPath, JSON.stringify({
    sessionId, transcriptPath, earliestTs: earliestTs?.toISOString() ?? null, latestTs: latestTs?.toISOString() ?? null,
    turns: turns.map((t) => ({ from: t.from, text: t.text, ts: t.ts ? t.ts.toISOString() : null })),
  }, null, 2))

  console.log(JSON.stringify({ ok: true, outPath, latestPath, latestJsonPath, turns: turns.length, chars: outContent.length }))
}

main()
