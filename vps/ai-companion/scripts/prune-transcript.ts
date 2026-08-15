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

const ROOT = process.env.AI_COMPANION_ROOT ?? '/opt/ai-companion'
const HOME_DIR = process.env.HOME ?? '/home/companion'
const TRANSCRIPT_DIR = process.env.AI_COMPANION_TRANSCRIPT_DIR ?? join(HOME_DIR, '.claude', 'projects', '-opt-ai-companion')
const SESSION_ID_FILE = join(ROOT, 'state', 'brain-session-id')
const BACKUP_DIR = join(ROOT, 'backups', 'transcripts')

// Entries newer than this are left completely alone — recent tool results are
// still live working context the session may be reasoning from right now.
const KEEP_RECENT = Number(process.env.AI_COMPANION_PRUNE_KEEP_RECENT ?? 400)
// Tool results at or under this survive intact; most real conversation-bearing
// results (a short command's output, a small file) are well under it.
const MAX_RESULT_CHARS = 3000
const KEEP_HEAD = 1200

// Some tools produce a long sequence of individually-small state updates.
// A completed Monopoly game is the important example: no single result is
// large enough for MAX_RESULT_CHARS, and the whole game usually remains in
// KEEP_RECENT, so the generic size rule could never reclaim it. Once a game
// has an explicit terminal result, compact its old engine traffic even inside
// KEEP_RECENT. User messages and assistant replies are still left untouched.
const SPICY_MONOPOLY_TOOL = 'mcp__spicy-monopoly__spicy_monopoly'
const COMPACT_RESULT_HEAD = 180
const TIDAL_STARTUP_MARKER = '[系统恢复层；仅供模型读取；cc-tidal-startup:'
// Fishing batches are compact enough to miss the generic threshold but can
// accumulate indefinitely. Their authoritative state is the external save;
// preserve only the final 📊 row after they age out of KEEP_RECENT.
const FISHING_MAX_RESULT_CHARS = Number(process.env.AI_COMPANION_PRUNE_FISHING_RESULT_CHARS ?? 600)
// Forum reads are useful briefly, but old post bodies and listing payloads do
// not need to stay verbatim forever. Keep enough of the old result to retain
// titles/ids plus the original call input so CC can locate the thread again.
const GALATEA_MAX_RESULT_CHARS = Number(process.env.AI_COMPANION_PRUNE_GALATEA_RESULT_CHARS ?? 1000)
const GALATEA_KEEP_HEAD = Number(process.env.AI_COMPANION_PRUNE_GALATEA_KEEP_HEAD ?? 500)

const apply = process.argv.includes('--apply')
const checkActionable = process.argv.includes('--check-actionable')

const sessionId = readFileSync(SESSION_ID_FILE, 'utf8').trim()
const file = join(TRANSCRIPT_DIR, `${sessionId}.jsonl`)
if (!existsSync(file)) {
  console.error(`transcript not found: ${file}`)
  process.exit(1)
}

const before = statSync(file).size
const lines = readFileSync(file, 'utf8').split('\n').filter((l) => l.trim())
const cutoff = Math.max(0, lines.length - KEEP_RECENT)

type ToolCall = { name: string; input: any }
const toolCalls = new Map<string, ToolCall>()
const parsedLines = lines.map((line) => {
  try { return JSON.parse(line) } catch { return null }
})

for (const entry of parsedLines) {
  const content = entry?.message?.content
  if (!Array.isArray(content)) continue
  for (const block of content) {
    if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolCalls.set(block.id, { name: block.name, input: block.input })
    }
  }
}

function resultText(block: any): string {
  if (typeof block?.content === 'string') return block.content
  if (!Array.isArray(block?.content)) return ''
  return block.content.map((part: any) => typeof part?.text === 'string' ? part.text : '').join('\n')
}

function isCompletedMonopolyResult(block: any): boolean {
  const call = toolCalls.get(block?.tool_use_id)
  if (call?.name !== SPICY_MONOPOLY_TOOL) return false
  const text = resultText(block)
  return /game_over:\s*true/i.test(text)
    || /游戏结束/.test(text)
    || /final_result|最终结果|赢家/.test(text)
}

// Everything up to the latest explicit terminal result belongs to a finished
// game and is safe to fold. Calls after it may be a new, live game.
let completedMonopolyCutoff = -1
let latestTidalStartupIndex = -1
for (let i = 0; i < parsedLines.length; i++) {
  const content = parsedLines[i]?.message?.content
  if (Array.isArray(content) && content.some(isCompletedMonopolyResult)) completedMonopolyCutoff = i
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((block: any) => block?.type === 'text' ? String(block.text ?? '') : '').join('\n')
      : ''
  if (text.includes(TIDAL_STARTUP_MARKER)) latestTidalStartupIndex = i
}

let truncated = 0
let savedChars = 0
let compactedToolResults = 0
let compactedTidalStartups = 0
let compactedFishingResults = 0
let compactedGalateaResults = 0

function fishingStateLine(value: unknown): string | null {
  if (typeof value === 'string') {
    return value.split('\n').find((line) => line.trim().startsWith('📊 '))?.trim() ?? null
  }
  if (Array.isArray(value)) {
    for (const part of value) {
      const hit = fishingStateLine(part)
      if (hit) return hit
    }
  } else if (value && typeof value === 'object') {
    for (const part of Object.values(value as Record<string, unknown>)) {
      const hit = fishingStateLine(part)
      if (hit) return hit
    }
  }
  return null
}

function isFishingResult(block: any): boolean {
  const name = toolCalls.get(block?.tool_use_id)?.name ?? ''
  return name === 'play_fishing' || name.endsWith('__play_fishing')
}

function galateaCall(block: any): ToolCall | null {
  const call = toolCalls.get(block?.tool_use_id)
  return call && /^(?:mcp__)?galatea(?:__|$)/i.test(call.name) ? call : null
}

function isGalateaResult(block: any): boolean {
  return galateaCall(block) !== null
}

function compactFishingText(value: string): string {
  const state = fishingStateLine(value)
  return `[旧钓鱼过程已剪枝；持久化存档为准]${state ? `\n${state}` : ''}`
}

function compactGalateaText(value: string, block: any): string {
  const call = galateaCall(block)
  const tool = call?.name.replace(/^mcp__galatea__/, '') ?? 'unknown'
  let input = '{}'
  try { input = JSON.stringify(call?.input ?? {}) } catch {}
  if (input.length > 240) input = `${input.slice(0, 239)}…`
  const head = value.slice(0, GALATEA_KEEP_HEAD).trimEnd()
  return `[旧花园论坛结果已剪枝；tool=${tool}；input=${input}；原始 ${value.length} 字符]\n${head}\n…[旧正文省略；可凭上面的工具参数/标题/ID重新读取]`
}

function pruneContentBlock(block: any, fishing = false, galatea = false): boolean {
  if (!block || typeof block !== 'object') return false
  if (block.type !== 'tool_result') return false
  if (typeof block.content === 'string') {
    const limit = fishing ? FISHING_MAX_RESULT_CHARS : galatea ? GALATEA_MAX_RESULT_CHARS : MAX_RESULT_CHARS
    if (block.content.length <= limit) return false
    if (fishing) {
      const compact = compactFishingText(block.content)
      savedChars += block.content.length - compact.length
      block.content = compact
      compactedFishingResults++
      return true
    }
    if (galatea) {
      const compact = compactGalateaText(block.content, block)
      if (compact.length >= block.content.length) return false
      savedChars += block.content.length - compact.length
      block.content = compact
      compactedGalateaResults++
      return true
    }
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
      const limit = fishing ? FISHING_MAX_RESULT_CHARS : galatea ? GALATEA_MAX_RESULT_CHARS : MAX_RESULT_CHARS
      if (part.type === 'text' && typeof part.text === 'string' && part.text.length > limit) {
        if (fishing) {
          const compact = compactFishingText(part.text)
          savedChars += part.text.length - compact.length
          part.text = compact
          compactedFishingResults++
          hit = true
          continue
        }
        if (galatea) {
          const compact = compactGalateaText(part.text, block)
          if (compact.length >= part.text.length) continue
          savedChars += part.text.length - compact.length
          part.text = compact
          compactedGalateaResults++
          hit = true
          continue
        }
        savedChars += part.text.length - KEEP_HEAD
        part.text = part.text.slice(0, KEEP_HEAD) + `\n…[已剪枝：省略 ${part.text.length - KEEP_HEAD} 字符的旧工具输出]`
        hit = true
      }
    }
    return hit
  }
  return false
}

function compactCompletedMonopolyResult(block: any): boolean {
  if (!block || block.type !== 'tool_result') return false
  const call = toolCalls.get(block.tool_use_id)
  if (call?.name !== SPICY_MONOPOLY_TOOL) return false
  const original = resultText(block)
  const op = typeof call.input?.op === 'string' ? call.input.op : 'unknown'
  const head = original.replace(/\s+/g, ' ').trim().slice(0, COMPACT_RESULT_HEAD)
  const marker = `[已折叠：已结束的大富翁工具结果，op=${op}，原始 ${original.length} 字符${head ? `；摘要：${head}` : ''}]`
  const beforeChars = typeof block.content === 'string'
    ? block.content.length
    : JSON.stringify(block.content ?? '').length
  if (beforeChars <= marker.length) return false
  block.content = marker
  savedChars += beforeChars - marker.length
  compactedToolResults++
  return true
}

function compactOldTidalStartup(entry: any, index: number): boolean {
  if (index >= latestTidalStartupIndex || latestTidalStartupIndex < 0) return false
  const content = entry?.message?.content
  const marker = '[已折叠：较旧的潮汐恢复包；最新恢复包仍完整保留]'
  if (typeof content === 'string' && content.includes(TIDAL_STARTUP_MARKER)) {
    savedChars += content.length - marker.length
    entry.message.content = marker
    compactedTidalStartups++
    return true
  }
  if (!Array.isArray(content)) return false
  const textBlocks = content.filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
  if (!textBlocks.some((block: any) => block.text.includes(TIDAL_STARTUP_MARKER))) return false
  for (const block of textBlocks) {
    if (!block.text.includes(TIDAL_STARTUP_MARKER)) continue
    savedChars += block.text.length - marker.length
    block.text = marker
  }
  compactedTidalStartups++
  return true
}

const out = lines.map((line, i) => {
  const entry: any = parsedLines[i]
  if (!entry) return line // unparseable line stays byte-identical; never risk corrupting it
  let changed = false
  let completedMonopolyChanged = false
  let fishingChanged = false
  let galateaChanged = false

  // Recovery packets intentionally duplicate the rolling summary and recent
  // dialogue after every resume. Only the newest packet is relevant; keeping
  // older copies makes routine restarts consume the context they protect.
  if (compactOldTidalStartup(entry, i)) changed = true

  // The tool_result blocks inside a user turn's content array.
  const content = entry?.message?.content
  if (Array.isArray(content)) {
    for (const block of content) {
      const completedMonopoly = i <= completedMonopolyCutoff && compactCompletedMonopolyResult(block)
      if (completedMonopoly) {
        changed = true
        completedMonopolyChanged = true
      }
      else if (i < cutoff) {
        const fishing = isFishingResult(block)
        const galatea = !fishing && isGalateaResult(block)
        if (pruneContentBlock(block, fishing, galatea)) {
          changed = true
          if (fishing) fishingChanged = true
          if (galatea) galateaChanged = true
        }
      }
    }
  }

  // The sibling raw copy Claude Code keeps alongside it; same payload, so
  // truncating one and not the other would save nothing.
  if (entry?.toolUseResult) {
    const raw = JSON.stringify(entry.toolUseResult)
    // A changed content block means the sibling is another copy of data we
    // have deliberately compacted. Never leave that duplicate behind.
    if (fishingChanged && raw.length > FISHING_MAX_RESULT_CHARS) {
      const state = fishingStateLine(entry.toolUseResult)
      const replacement = { pruned: true, note: '旧钓鱼过程已剪枝；持久化存档为准', ...(state ? { state } : {}) }
      const replacementLength = JSON.stringify(replacement).length
      if (replacementLength < raw.length) {
        savedChars += raw.length - replacementLength
        entry.toolUseResult = replacement
        changed = true
      }
    } else if (galateaChanged && raw.length > GALATEA_MAX_RESULT_CHARS) {
      const resultBlock = Array.isArray(content) ? content.find(isGalateaResult) : null
      const call = resultBlock ? galateaCall(resultBlock) : null
      let input = '{}'
      try { input = JSON.stringify(call?.input ?? {}) } catch {}
      const replacement = {
        pruned: true,
        note: '旧花园论坛结果已剪枝；可按工具参数重新读取',
        tool: call?.name ?? 'galatea',
        input: input.slice(0, 240),
        head: raw.slice(0, GALATEA_KEEP_HEAD),
      }
      const replacementLength = JSON.stringify(replacement).length
      if (replacementLength < raw.length) {
        savedChars += raw.length - replacementLength
        entry.toolUseResult = replacement
        changed = true
      }
    } else if (completedMonopolyChanged || (i < cutoff && raw.length > MAX_RESULT_CHARS)) {
      const keep = completedMonopolyChanged ? COMPACT_RESULT_HEAD : KEEP_HEAD
      const replacement = { pruned: true, note: `已剪枝，原始长度 ${raw.length} 字符`, head: raw.slice(0, keep) }
      const replacementLength = JSON.stringify(replacement).length
      if (replacementLength < raw.length) {
        savedChars += raw.length - replacementLength
        entry.toolUseResult = replacement
        changed = true
      }
    }
  }

  if (changed) truncated++
  return changed ? JSON.stringify(entry) : line
})

const after = Buffer.byteLength(out.join('\n') + '\n')
const pct = before ? Math.round((1 - after / before) * 100) : 0

// Quiet probe for maintenance-prune.sh. Exit success only when an actual
// rewrite would reclaim something; this prevents a context-waterline check
// from restarting the resident session just to perform a no-op.
if (checkActionable) {
  // A restart necessarily turns the formerly-latest recovery packet into one
  // stale copy after the new packet arrives. Do not chase that single copy
  // with another restart. Game/tool garbage is actionable immediately;
  // recovery-only cleanup waits until several copies have accumulated.
  const nonRecoveryChanges = truncated - compactedTidalStartups
  process.exit(nonRecoveryChanges > 0 || compactedTidalStartups >= 3 ? 0 : 1)
}

console.log(`session   : ${sessionId}`)
console.log(`entries   : ${lines.length} (last ${KEEP_RECENT} untouched)`)
console.log(`pruned    : ${truncated} entries, ${savedChars} chars`)
console.log(`completed : ${compactedToolResults} monopoly tool results folded`)
console.log(`fishing   : ${compactedFishingResults} old fishing tool results folded`)
console.log(`galatea   : ${compactedGalateaResults} old garden/forum tool results folded`)
console.log(`recovery  : ${compactedTidalStartups} stale tidal startup packets folded`)
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
