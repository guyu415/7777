#!/usr/bin/env bun
/**
 * Shrinks the resident brain session's transcript so it can keep being
 * --resume'd indefinitely.
 *
 * Why this is needed: the brain now lives in ONE session id forever, so its
 * .jsonl only ever grows. The bulk of that growth is not conversation — it is
 * tool results (file reads, greps, ps dumps) that were useful for one turn and
 * are dead weight after. Left alone the file eventually gets too big to load
 * and resume starts failing, which is exactly the amnesia this whole change
 * was meant to prevent.
 *
 * What it will NOT touch, ever:
 *   - user messages and assistant messages (text and thinking)
 *   - anything in the most recent KEEP_RECENT entries
 *   - the structural fields resume relies on (uuid/parentUuid/type/sessionId)
 * Only oversized tool RESULT payloads are truncated, in place, with a marker
 * saying so — nothing is deleted, so the parent/child chain stays intact.
 *
 * Usage:
 *   bun scripts/prune-transcript.ts            # dry run, prints what it would do
 *   bun scripts/prune-transcript.ts --apply    # backs up, then rewrites
 */

import { readFileSync, writeFileSync, copyFileSync, statSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const ROOT = '/opt/ai-companion'
const HOME = process.env.HOME ?? '/home/companion'
const TRANSCRIPT_DIR = join(HOME, '.claude', 'projects', '-opt-ai-companion')
const SESSION_ID_FILE = join(ROOT, 'state', 'brain-session-id')
const BACKUP_DIR = join(ROOT, 'backups', 'transcripts')

// Entries newer than this are left completely alone — recent tool results are
// still live working context the session may be reasoning from right now.
const KEEP_RECENT = 400
// Tool results at or under this survive intact; most real conversation-bearing
// results (a short command's output, a small file) are well under it.
const MAX_RESULT_CHARS = 3000
const KEEP_HEAD = 1200

const apply = process.argv.includes('--apply')

const sessionId = readFileSync(SESSION_ID_FILE, 'utf8').trim()
const file = join(TRANSCRIPT_DIR, `${sessionId}.jsonl`)
if (!existsSync(file)) {
  console.error(`transcript not found: ${file}`)
  process.exit(1)
}

const before = statSync(file).size
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
const cutoff = Math.max(0, lines.length - KEEP_RECENT)

let truncated = 0
let savedChars = 0

function pruneContentBlock(block: any): boolean {
  if (!block || typeof block !== 'object') return false
  if (block.type !== 'tool_result') return false
  if (typeof block.content === 'string') {
    if (block.content.length <= MAX_RESULT_CHARS) return false
    savedChars += block.content.length - KEEP_HEAD
    block.content = block.content.slice(0, KEEP_HEAD) + `\n…[已剪枝：省略 ${block.content.length - KEEP_HEAD} 字符的旧工具输出]`
    return true
  }
  if (Array.isArray(block.content)) {
    let hit = false
    // Rewritten in place rather than spliced out: dropping an element would
    // renumber the array a later block might refer to. A text block is legal
    // anywhere an image block was, so the swap is structurally invisible.
    for (let i = 0; i < block.content.length; i++) {
      const part = block.content[i]
      if (!part || typeof part !== 'object') continue
      // Images are the single densest thing in a transcript — one screenshot
      // outweighs hours of conversation — and unlike text they cannot be
      // truncated, since half a base64 payload is not a smaller image, it is
      // a corrupt one. So the whole block is replaced by a note. The original
      // file is still on disk under uploads/ and can simply be read again.
      if (part.type === 'image' && part.source) {
        const size = JSON.stringify(part.source).length
        if (size > MAX_RESULT_CHARS) {
          savedChars += size
          block.content[i] = { type: 'text', text: `[已剪枝：一张图片（原始数据约 ${Math.round(size / 1024)}KB）。原图仍在服务器的 uploads/ 目录，需要时可以重新读取。]` }
          hit = true
        }
        continue
      }
      if (part.type === 'text' && typeof part.text === 'string' && part.text.length > MAX_RESULT_CHARS) {
        savedChars += part.text.length - KEEP_HEAD
        part.text = part.text.slice(0, KEEP_HEAD) + `\n…[已剪枝：省略 ${part.text.length - KEEP_HEAD} 字符的旧工具输出]`
        hit = true
      }
    }
    return hit
  }
  return false
}

const out = lines.map((line, i) => {
  if (i >= cutoff) return line
  let entry: any
  try {
    entry = JSON.parse(line)
  } catch {
    return line // unparseable line stays byte-identical; never risk corrupting it
  }
  let changed = false

  // The tool_result blocks inside a user turn's content array.
  const content = entry?.message?.content
  if (Array.isArray(content)) {
    for (const block of content) if (pruneContentBlock(block)) changed = true
  }

  // The sibling raw copy Claude Code keeps alongside it; same payload, so
  // truncating one and not the other would save nothing.
  if (entry?.toolUseResult) {
    const raw = JSON.stringify(entry.toolUseResult)
    if (raw.length > MAX_RESULT_CHARS) {
      savedChars += raw.length - KEEP_HEAD
      entry.toolUseResult = { pruned: true, note: `已剪枝，原始长度 ${raw.length} 字符`, head: raw.slice(0, KEEP_HEAD) }
      changed = true
    }
  }

  if (changed) truncated++
  return changed ? JSON.stringify(entry) : line
})

const after = Buffer.byteLength(out.join('\n') + '\n')
const pct = before ? Math.round((1 - after / before) * 100) : 0

console.log(`session   : ${sessionId}`)
console.log(`entries   : ${lines.length} (last ${KEEP_RECENT} untouched)`)
console.log(`pruned    : ${truncated} entries, ${savedChars} chars`)
console.log(`size      : ${(before / 1024 / 1024).toFixed(2)}MB -> ${(after / 1024 / 1024).toFixed(2)}MB (-${pct}%)`)

if (!apply) {
  console.log('\ndry run — nothing written. re-run with --apply to commit.')
  process.exit(0)
}

// Resume reads this file at spawn; a half-written file is a dead companion.
// Back up first, write to a temp path, then swap.
mkdirSync(BACKUP_DIR, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const backup = join(BACKUP_DIR, `${sessionId}.${stamp}.jsonl`)
copyFileSync(file, backup)
const tmp = `${file}.pruning`
writeFileSync(tmp, out.join('\n') + '\n')
writeFileSync(file, readFileSync(tmp))
console.log(`\napplied. backup: ${backup}`)
