#!/usr/bin/env bun
/**
 * Read-only MCP search over the resident Claude Code companion's transcripts.
 * One invocation returns exactly one matched dialogue round.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const TRANSCRIPT_DIR = process.env.CC_HISTORY_DIR
  ?? '/home/companion/.claude/projects/-opt-ai-companion'
const MAX_SIDE_CHARS = 12_000
const MAX_RESULT_CHARS = 48_000

export type DialogueTurn = {
  sessionId: string
  turnId: string
  timestamp: string | null
  user: string
  cc: string[]
}

let cache: { signature: string; turns: DialogueTurn[] } | null = null

function stripTimeContext(text: string): string {
  return text.replace(/^\s*\[此刻用户设备本地时间：.*?\]\n\n/, '')
}

function extractRealUserText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  if (raw.startsWith('<local-command-caveat>') || raw.startsWith('<command-name>') || raw.startsWith('<local-command-stdout>')) return null

  const match = raw.match(/<channel[^>]*source="ai-companion"[^>]*user="user"[^>]*>([\s\S]*?)<\/channel>/)
  if (!match) return null

  let text = stripTimeContext(match[1].replace(/^\s+/, ''))
  // Generated continuity/control packets are not human speech. Excluding the
  // recovery layer also prevents keyword hits against a summary paraphrase.
  if (text.startsWith('[系统提示，不是用户发的消息')
    || text.startsWith('[系统恢复层；')
    || text.startsWith('[系统恢复层，')
    || text.startsWith('[系统内部潮汐维护')) return null

  const image = text.match(/^\[用户发送了一张图片[^\]]*\]\n?\n?/)
  if (image) {
    const rest = text.slice(image[0].length).trim()
    return rest ? `[发了一张图片] ${rest}` : '[发了一张图片]'
  }

  if (/^用户请求悔棋|^用户在五子棋游戏界面里|落子在 \(\d/.test(text)) return null
  text = text.trim()
  return text || null
}

function extractCcReplies(content: unknown): string[] {
  if (!Array.isArray(content)) return []
  const replies: string[] = []
  for (const block of content) {
    if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue
    if (!/__reply$|__send_voice$/.test(String(block.name ?? ''))) continue
    const text = typeof block.input?.text === 'string' ? block.input.text.trim() : ''
    if (text) replies.push(text)
  }
  return replies
}

function transcriptFiles() {
  return readdirSync(TRANSCRIPT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => {
      const path = join(TRANSCRIPT_DIR, entry.name)
      const stat = statSync(path)
      return { path, sessionId: entry.name.slice(0, -6), size: stat.size, mtimeMs: stat.mtimeMs }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function parseTranscript(path: string, fallbackSessionId: string): DialogueTurn[] {
  const turns: DialogueTurn[] = []
  let current: DialogueTurn | null = null
  const flush = () => {
    if (current) turns.push(current)
    current = null
  }

  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue
    let row: any
    try { row = JSON.parse(line) } catch { continue }

    if (row?.type === 'user') {
      const user = extractRealUserText(row?.message?.content)
      if (!user) continue
      flush()
      current = {
        sessionId: String(row.sessionId || fallbackSessionId),
        turnId: String(row.uuid || `${fallbackSessionId}:${turns.length}`),
        timestamp: typeof row.timestamp === 'string' ? row.timestamp : null,
        user,
        cc: [],
      }
    } else if (row?.type === 'assistant' && current) {
      current.cc.push(...extractCcReplies(row?.message?.content))
    }
  }
  flush()
  return turns
}

function loadTurns(): DialogueTurn[] {
  const files = transcriptFiles()
  const signature = files.map((f) => `${f.path}:${f.size}:${f.mtimeMs}`).join('|')
  if (cache?.signature === signature) return cache.turns
  const turns = files.flatMap((file) => parseTranscript(file.path, file.sessionId))
  cache = { signature, turns }
  return turns
}

export function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function cjkBigrams(value: string): string[] {
  const compact = normalized(value).replace(/[\s\p{P}\p{S}]+/gu, '')
  const out: string[] = []
  for (let i = 0; i < compact.length - 1; i++) out.push(compact.slice(i, i + 2))
  return [...new Set(out)]
}

export function matchScore(turn: DialogueTurn, rawQuery: string): number | null {
  const query = normalized(rawQuery)
  if (!query) return 0
  const sides = [turn.user, ...turn.cc].map(normalized)
  const literal = sides.filter((text) => text.includes(query))
  if (literal.length) {
    const exact = sides.some((text) => text === query)
    const shortest = Math.min(...literal.map((text) => text.length))
    return (exact ? 1_000_000 : 500_000) + Math.max(0, 100_000 - shortest)
  }

  const words = query.split(' ').filter(Boolean)
  const joined = sides.join('\n')
  if (words.length >= 2 && words.every((word) => joined.includes(word))) {
    return 100_000 + words.reduce((sum, word) => sum + word.length, 0)
  }

  // Chinese recollections are often paraphrases without spaces. A conservative
  // bigram overlap gives CC a useful "这件事大概说过" path without pretending
  // this lexical index is a semantic embedding search.
  const grams = cjkBigrams(query)
  if (grams.length < 3) return null
  const compactJoined = joined.replace(/[\s\p{P}\p{S}]+/gu, '')
  const hits = grams.filter((gram) => compactJoined.includes(gram)).length
  const ratio = hits / grams.length
  if (hits < 3 || ratio < 0.30) return null
  return 10_000 + Math.round(ratio * 1_000) + hits
}

function bounded(text: string): string {
  if (text.length <= MAX_SIDE_CHARS) return text
  return `${text.slice(0, MAX_SIDE_CHARS)}\n…[这一侧原话过长，已在 ${MAX_SIDE_CHARS} 字符处截断]`
}

export type ChatHistorySearchOptions = {
  query?: string
  skip?: number
  limit?: number
  contextTurns?: number
  startTime?: string
  endTime?: string
  aroundTurnId?: string
}

function parsedTime(value: string | undefined, endOfDay: boolean): number | null {
  if (!value) return null
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const parsed = Date.parse(day ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00` : value)
  return Number.isFinite(parsed) ? parsed : null
}

function renderTurn(turn: DialogueTurn, label: string): string {
  const cc = turn.cc.length
    ? turn.cc.map((text, i) => turn.cc.length > 1 ? `[${i + 1}] ${text}` : text).join('\n\n')
    : '（这一轮没有找到已发送给用户的文字/语音回复）'
  return [
    label,
    `时间：${turn.timestamp ?? '未知'}`,
    `定位：session_id=${turn.sessionId} turn_id=${turn.turnId}`,
    '用户原话：',
    bounded(turn.user),
    'CC 当轮原话：',
    bounded(cc),
  ].join('\n')
}

export function searchTurns(turns: DialogueTurn[], options: ChatHistorySearchOptions): string {
  const query = String(options.query ?? '').trim()
  const aroundTurnId = String(options.aroundTurnId ?? '').trim()
  const skip = Math.max(0, Math.trunc(options.skip ?? 0))
  const limit = Math.max(1, Math.min(5, Math.trunc(options.limit ?? 3)))
  const contextTurns = Math.max(0, Math.min(3, Math.trunc(options.contextTurns ?? 1)))
  const start = parsedTime(options.startTime, false)
  const end = parsedTime(options.endTime, true)
  const inRange = (turn: DialogueTurn) => {
    if (start === null && end === null) return true
    const ts = Date.parse(String(turn.timestamp ?? ''))
    return Number.isFinite(ts) && (start === null || ts >= start) && (end === null || ts <= end)
  }

  let ranked: Array<{ turn: DialogueTurn; index: number; score: number }>
  if (aroundTurnId) {
    ranked = turns
      .map((turn, index) => ({ turn, index, score: turn.turnId === aroundTurnId ? 1_000_000 : -1 }))
      .filter((item) => item.score >= 0 && inRange(item.turn))
  } else {
    ranked = turns
      .map((turn, index) => ({ turn, index, score: matchScore(turn, query) }))
      .filter((item): item is { turn: DialogueTurn; index: number; score: number } => item.score !== null && inRange(item.turn))
      .sort((a, b) => b.score - a.score || String(b.turn.timestamp ?? '').localeCompare(String(a.turn.timestamp ?? '')))
  }

  const selected = ranked.slice(skip, skip + limit)
  if (!selected.length) {
    const scope = aroundTurnId ? `turn_id=${aroundTurnId}` : query ? `「${query}」` : '给定时间范围'
    return `没有找到符合 ${scope} 的原始对话。`
  }

  const sections = selected.map((hit, hitIndex) => {
    let from = hit.index
    let to = hit.index
    while (from > 0 && hit.index - from < contextTurns && turns[from - 1].sessionId === hit.turn.sessionId) from--
    while (to < turns.length - 1 && to - hit.index < contextTurns && turns[to + 1].sessionId === hit.turn.sessionId) to++
    const neighborhood = turns.slice(from, to + 1).map((turn, offset) => {
      const absolute = from + offset
      return renderTurn(turn, absolute === hit.index ? '【命中轮次】' : absolute < hit.index ? '【前一轮上下文】' : '【后一轮上下文】')
    })
    return [`===== 命中 ${hitIndex + 1}/${selected.length} =====`, ...neighborhood].join('\n\n')
  })
  const header = `找到 ${ranked.length} 个匹配；本次从第 ${skip + 1} 个起返回 ${selected.length} 个，每个带前后 ${contextTurns} 轮。${skip + selected.length < ranked.length ? '还有更多匹配，可增大 skip。' : '已到末尾。'}`
  const result = [header, ...sections].join('\n\n')
  return result.length <= MAX_RESULT_CHARS ? result : `${result.slice(0, MAX_RESULT_CHARS)}\n…[结果已在 ${MAX_RESULT_CHARS} 字符处截断，请缩小 limit/context_turns 或收窄时间范围]`
}

export function searchOne(query: string, skip: number): string {
  return searchTurns(loadTurns(), { query, skip, limit: 1, contextTurns: 0 })
}

const server = new Server(
  { name: 'cc-chat-history', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions: '只读原始聊天历史。一次可返回少量相关命中及相邻轮次，也可按日期或 turn_id 定位；优先一次收窄查询，不要为了“更全面”遍历全部历史。',
  },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'search_chat_history',
    description: '检索常驻 CC 的全部原始 transcript。支持关键词/近似词面、时间范围或 turn_id；一次返回 1-5 个命中，并可带前后 0-3 轮真实原文。不搜索恢复摘要、系统注入或工具输出。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 300, description: '关键词、短语或对旧事的大致表述；使用 around_turn_id 时可省略' },
        skip: { type: 'integer', minimum: 0, maximum: 1000, default: 0, description: '跳过前 N 个匹配' },
        limit: { type: 'integer', minimum: 1, maximum: 5, default: 3, description: '本次返回几个匹配' },
        context_turns: { type: 'integer', minimum: 0, maximum: 3, default: 1, description: '每个命中附带前后几轮原文' },
        start_time: { type: 'string', description: '可选起始日期 YYYY-MM-DD（按用户本地 UTC+8）或带时区的 ISO 时间' },
        end_time: { type: 'string', description: '可选结束日期 YYYY-MM-DD（按用户本地 UTC+8）或带时区的 ISO 时间' },
        around_turn_id: { type: 'string', description: '已知定位时直接展开该 turn_id 及相邻轮次' },
      },
      anyOf: [
        { required: ['query'] },
        { required: ['around_turn_id'] },
      ],
    },
  }],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== 'search_chat_history') throw new Error('unknown tool')
  const args = (request.params.arguments ?? {}) as Record<string, unknown>
  const query = String(args.query ?? '').trim()
  const aroundTurnId = String(args.around_turn_id ?? '').trim()
  if (!query && !aroundTurnId) throw new Error('query or around_turn_id is required')
  const skip = Number(args.skip ?? 0)
  const limit = Number(args.limit ?? 3)
  const contextTurns = Number(args.context_turns ?? 1)
  if (!Number.isInteger(skip) || skip < 0 || skip > 1000) throw new Error('skip must be an integer from 0 to 1000')
  if (!Number.isInteger(limit) || limit < 1 || limit > 5) throw new Error('limit must be an integer from 1 to 5')
  if (!Number.isInteger(contextTurns) || contextTurns < 0 || contextTurns > 3) throw new Error('context_turns must be an integer from 0 to 3')
  return { content: [{ type: 'text', text: searchTurns(loadTurns(), {
    query,
    aroundTurnId,
    skip,
    limit,
    contextTurns,
    startTime: typeof args.start_time === 'string' ? args.start_time : undefined,
    endTime: typeof args.end_time === 'string' ? args.end_time : undefined,
  }) }] }
})

if (import.meta.main) await server.connect(new StdioServerTransport())
