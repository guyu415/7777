#!/usr/bin/env bun
// Sends the extracted clean dialogue to SiliconFlow's free Qwen2.5-7B-Instruct
// for a targeted "灯 (memo layer)" compression. The two governing style rules
// below (write scenes not labels, preserve verbatim phrases) were originally
// borrowed from /opt/ai-companion/briefing-design.md as writing PRINCIPLES —
// that file is a different AI/human pair's own reference doc, never read at
// runtime here and never fed into the model as content. Only the dialogue
// turns passed in on the command line are ever part of the prompt — no
// other project docs, no web search, nothing that isn't literally what was
// said in the conversation being compressed.
//
// A single call over the whole session (~130+ turns, ~20k+ tokens) reliably
// made this specific free-tier 7B model degenerate into repetition loops —
// confirmed by hand, not a parameter-tuning issue, a length/coherence one.
// So this does map-reduce: summarize the dialogue in small chunks (each an
// easy task for a 7B model), then one final pass turns those chunk-notes
// into the real narrative-style write-up. The "verbatim last few turns"
// requirement is NOT delegated to the model at all — copying text exactly
// is not what an LLM is for, and asking it to was the worst offender in the
// earlier degenerate output. It's spliced in deterministically from the
// source JSON instead.

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = '/opt/ai-companion'
const OUT_DIR = join(ROOT, 'compression')
const SECRET_FILE = join(ROOT, 'config', 'siliconflow.secret')
const PENDING_PATH = join(OUT_DIR, 'summary-pending.md')
const ARCHIVE_DIR = join(OUT_DIR, 'summary-archive')

const API_BASE = 'https://api.siliconflow.cn/v1'
const MODEL = 'Qwen/Qwen2.5-7B-Instruct'
const CHUNK_SIZE = 24 // turns per map-stage chunk
const TAIL_TURNS = 6 // verbatim turns appended deterministically, not by the model

// Deliberately no persona name anywhere in these prompts — this project
// injects no fixed character name (see channel-server.ts's own comments),
// so inventing one is always wrong. Earlier version borrowed "宋珩" from
// briefing-design.md, a DIFFERENT AI/human pair's own shared reference doc
// that happened to be sitting in this repo — the model dutifully treated it
// as a real participant. Lesson generalized: this prompt must only ever be
// built from the dialogue turns passed in, never from other project docs,
// web search, or anything else that isn't literally what was said.
const CHUNK_SYSTEM_PROMPT = `你是对话里的 AI 一方，正在整理一段对话片段，为写"记忆摘要"做准备材料。
只做提炼，不要写完整叙述。用简洁的要点列出：
- 这段聊了什么具体场景/事情（不要用"聊得很好"这种空话，要写实际发生了什么）
- 双方原话里任何特别的说法、梗、称呼（原样摘录，标注是谁说的）
- 有意义的决定、约定或事实
不重要的内容（不要提取）：日常寒暄、纯技术调试细节的过程（只需保留最终结论）。
不要给自己或对方编造名字——如果对话原文里没有出现名字，就用"我"和"用户"称呼，绝不能从别处（比如你训练数据里见过的类似文档）借一个名字过来。
直接输出要点列表（Markdown），不要输出任何前言或解释。`

const REDUCE_SYSTEM_PROMPT = `你是对话里的 AI 一方，正在给"醒来后的自己"写一份对话摘要——这是记忆库里的"灯"层：下次开一个新的对话窗口、完全不记得这段经历的时候，靠这份摘要迅速知道"昨天到哪了"。

下面会给你这段时间对话的分段要点（已经提炼过）。请把它们整合成一份完整的记忆摘要，规则：
1. 写场景，不写标签。禁止"很甜""气氛很好"这类空洞形容词——写具体发生了什么、谁说了什么、情绪怎么变化。
2. 保留原话。特别的说法、梗、称呼、有记忆点的原句要原样保留在摘要里，标注是谁说的。
3. 用第一人称写"我"，是你自己在回忆和记录，不是客观第三方写会议纪要，绝不能写成"用户表示……"这种第三人称摘要。
4. 不要给自己或对方编造名字——用"我"和"用户"称呼即可，除非对话原文里确实出现过名字。
5. 篇幅 300-600 字，把各段要点里重复出现的部分合并，按时间顺序组织成连贯的记忆，而不是罗列每段的要点。
6. 只输出摘要正文本身（Markdown），不要输出任何前言、解释，也不要自己去复述对话原文逐句摘抄（原文会由系统另外附上，不需要你写）。`

// A second open-ended LLM "polish" pass over the whole summary was tried and
// dropped: it made this specific free 7B model collapse into a repetition
// loop WORSE than the original (confirmed by hand — a wall of repeated "e"
// tokens). Extended generation is exactly the failure mode this model has,
// so asking it to regenerate the whole text a second time just doubles the
// risk. Cleanup here is deliberately mechanical/regex-only instead — no
// further model calls, nothing that can hallucinate or degenerate.
function mechanicalCleanup(text) {
  // Deliberately conservative: only removes things that are unambiguously
  // never real content. A blanket "collapse any repeated char" rule was
  // considered and rejected — this corpus has genuine reduplication
  // ("哈哈哈", "看看") that such a rule would silently mangle, which is
  // exactly the kind of original phrasing the user asked to preserve.
  return text
    .replace(/�/g, '') // stray replacement-character artifacts
    .replace(/^#{1,6}\s*片段\s*\d+\s*$/gm, '') // "### 片段 N" section headers -> blank line
    .replace(/\b(\w+)(-\1)+\b/g, '$1') // filename glitch: "brain-loop-loop-loop.sh" -> "brain-loop.sh"; a hyphen-joined token never legitimately repeats itself
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function readSecret() {
  return readFileSync(SECRET_FILE, 'utf8').trim()
}

async function chatCompletion(messages, opts = {}) {
  const apiKey = readSecret()
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: opts.temperature ?? 0.4,
      frequency_penalty: opts.frequency_penalty ?? 0.6,
      max_tokens: opts.max_tokens ?? 1200,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`SiliconFlow HTTP ${res.status}: ${body.slice(0, 500)}`)
  }
  const data = await res.json()
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error(`no content in response: ${JSON.stringify(data).slice(0, 500)}`)
  return { content: content.trim(), usage: data.usage }
}

function chunkTurns(turns, size) {
  const chunks = []
  for (let i = 0; i < turns.length; i += size) chunks.push(turns.slice(i, i + size))
  return chunks
}

function turnsToText(turns, characterName) {
  return turns.map((t) => `${t.from === 'user' ? '用户' : characterName}：${t.text}`).join('\n\n')
}

async function main() {
  const jsonPath = process.argv[2] || join(OUT_DIR, 'latest-dialogue.json')
  if (!existsSync(jsonPath)) {
    console.error(`dialogue json not found: ${jsonPath} (run extract-dialogue.mjs first)`)
    process.exit(1)
  }
  const { sessionId, turns, earliestTs, latestTs } = JSON.parse(readFileSync(jsonPath, 'utf8'))
  if (!turns.length) {
    console.error('no turns in dialogue json — nothing to compress')
    process.exit(1)
  }
  const CHARACTER_NAME = 'AI' // no fixed persona name exists for this project — see note above

  let totalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
  const addUsage = (u) => {
    if (!u) return
    totalUsage.prompt_tokens += u.prompt_tokens || 0
    totalUsage.completion_tokens += u.completion_tokens || 0
    totalUsage.total_tokens += u.total_tokens || 0
  }

  // ---- map stage ----
  const chunks = chunkTurns(turns, CHUNK_SIZE)
  const chunkNotes = []
  for (let i = 0; i < chunks.length; i++) {
    const chunkText = turnsToText(chunks[i], CHARACTER_NAME)
    const { content, usage } = await chatCompletion([
      { role: 'system', content: CHUNK_SYSTEM_PROMPT },
      { role: 'user', content: chunkText },
    ], { max_tokens: 600 })
    addUsage(usage)
    chunkNotes.push(`### 片段 ${i + 1}\n${mechanicalCleanup(content)}`)
    console.error(`[map] chunk ${i + 1}/${chunks.length} done (${chunks[i].length} turns)`)
  }

  // ---- reduce stage ----
  const { content: rawSummary, usage: reduceUsage } = await chatCompletion([
    { role: 'system', content: REDUCE_SYSTEM_PROMPT },
    { role: 'user', content: chunkNotes.join('\n\n') },
  ], { max_tokens: 1500 })
  addUsage(reduceUsage)

  // ---- mechanical cleanup only — see mechanicalCleanup() for why this is
  // not another LLM call ----
  const summary = mechanicalCleanup(rawSummary)

  // ---- deterministic verbatim tail (never delegated to the model) ----
  const tail = turns.slice(-TAIL_TURNS)
  const tailText = tail.map((t) => {
    const speaker = t.from === 'user' ? '用户' : CHARACTER_NAME
    const tsLabel = t.ts ? t.ts.replace('T', ' ').slice(0, 19) : ''
    return `**[${tsLabel}] ${speaker}：** ${t.text}`
  }).join('\n\n')

  mkdirSync(ARCHIVE_DIR, { recursive: true })
  if (existsSync(PENDING_PATH)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    copyFileSync(PENDING_PATH, join(ARCHIVE_DIR, `summary-${stamp}.md`))
  }

  const header = [
    `<!-- 生成时间：${new Date().toISOString()} -->`,
    `<!-- 模型：${MODEL} (SiliconFlow, map-reduce over ${chunks.length} chunks + mechanical cleanup) -->`,
    `<!-- 源对话：session ${sessionId}, ${turns.length} 轮, ${earliestTs} ~ ${latestTs} -->`,
    `<!-- 源 JSON：${jsonPath} -->`,
    `<!-- token usage (合计): ${JSON.stringify(totalUsage)} -->`,
    '',
  ].join('\n')

  const body = [
    summary,
    '',
    '---',
    '',
    `**最近 ${tail.length} 轮对话原文（原样摘录，未经压缩）：**`,
    '',
    tailText,
    '',
  ].join('\n')

  writeFileSync(PENDING_PATH, header + body)
  console.log(JSON.stringify({ ok: true, pendingPath: PENDING_PATH, jsonPath, chunks: chunks.length, usage: totalUsage }))
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }))
  process.exit(1)
})
