// 剧本杀引擎——**纯函数**，没有 React、没有网络、没有 store 依赖。
// UI 负责"什么时候调"，这里只负责"调了会变成什么"。这样整局游戏可以被
// 一段脚本完整跑一遍来验证（见本次提交的验证脚本），也保证了持久化只是
// 把一个普通对象存进 localStorage 而已。
//
// ===== 秘密隔离（第 3 条硬要求）在这里落地 =====
// buildCharacterSystemPrompt / buildTurnPrompt 只接受一个 charId，并且**只**从
// script.characters 里取那一条的 secret/mission/voice/privateClues。别人的
// secret 和 script.truth 在这两个函数里没有任何可达路径——不是靠提示词约束，
// 是结构上就拿不到。改这个文件时请守住这条。

import { getScript, getCharacter, getChapter } from './scripts'

export const SEAT_USER = 'user'
export const SEAT_AI = 'ai'
export const SEAT_NPC = 'npc'

let idSeq = 0
function newId(prefix) {
  idSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`
}

// ---------------------------------------------------------------- 建局

// seats: { [charId]: { kind: 'user'|'ai'|'npc', memberId?: string } }
// 没有出现在 seats 里的角色一律按 NPC 处理，所以"1 个真人 + 0 个 AI"也能开局。
export function createGame(scriptId, seats) {
  const script = getScript(scriptId)
  if (!script) throw new Error(`剧本不存在：${scriptId}`)
  const normalized = {}
  for (const c of script.characters) {
    const s = seats?.[c.id]
    normalized[c.id] = s && (s.kind === SEAT_USER || s.kind === SEAT_AI)
      ? { kind: s.kind, memberId: s.memberId || null }
      : { kind: SEAT_NPC, memberId: null }
  }
  const state = {
    scriptId,
    seats: normalized,
    chapterIndex: 0,
    log: [],
    spoken: {},
    votes: {},
    truthRevealed: false,
    finished: false,
    startedAt: Date.now(),
  }
  return openChapter(state, 0)
}

// 进入某一章：主持人念旁白、发公开线索、给每个角色发各自的私密线索。
function openChapter(state, index) {
  const script = getScript(state.scriptId)
  const chapter = getChapter(script, index)
  if (!chapter) return { ...state, finished: true }
  const entries = []
  if (index === 0) {
    entries.push(host(script.hostOpening))
    entries.push(host(`【本回背景】\n${script.intro}`))
  }
  entries.push({
    id: newId('ch'),
    ts: Date.now(),
    kind: 'chapter',
    charId: null,
    visibility: 'public',
    text: `${chapter.title}\n\n${chapter.narration}`,
  })
  for (const clue of chapter.publicClues || []) {
    entries.push({ id: newId('pc'), ts: Date.now(), kind: 'clue', charId: null, visibility: 'public', text: clue })
  }
  entries.push(host(`【本章任务】${chapter.task}`))
  // 私密线索：一条只属于一个角色，visibility='private' + forCharId
  for (const c of script.characters) {
    for (const clue of c.privateClues?.[chapter.id] || []) {
      entries.push({ id: newId('sc'), ts: Date.now(), kind: 'clue', charId: null, visibility: 'private', forCharId: c.id, text: clue })
    }
  }
  return { ...state, chapterIndex: index, log: [...state.log, ...entries] }
}

function host(text) {
  return { id: newId('h'), ts: Date.now(), kind: 'host', charId: null, visibility: 'public', text }
}

// ---------------------------------------------------------------- 回合

export function currentChapter(state) {
  return getChapter(getScript(state.scriptId), state.chapterIndex)
}

// 本章按剧本角色顺序轮流发言；返回下一个还没发言的角色，全说完了返回 null。
export function nextActor(state) {
  const script = getScript(state.scriptId)
  const chapter = currentChapter(state)
  if (!chapter) return null
  const done = state.spoken?.[chapter.id] || []
  for (const c of script.characters) {
    if (!done.includes(c.id)) return { charId: c.id, seat: state.seats[c.id] || { kind: SEAT_NPC } }
  }
  return null
}

export function isChapterComplete(state) {
  return nextActor(state) === null
}

// 记一次发言。markTurn=false 用于用户的"随时补充"，不占轮次。
export function appendSpeech(state, charId, text, { markTurn = true } = {}) {
  const chapter = currentChapter(state)
  const entry = {
    id: newId('s'), ts: Date.now(), kind: 'speech', charId,
    visibility: 'public', text: String(text || '').trim(),
  }
  const next = { ...state, log: [...state.log, entry] }
  if (markTurn && chapter) {
    const done = state.spoken?.[chapter.id] || []
    if (!done.includes(charId)) next.spoken = { ...state.spoken, [chapter.id]: [...done, charId] }
  }
  return next
}

// 投票章专用：发言 + 记票（targetId 可以为 null = 弃权）。
export function appendVote(state, charId, text, targetId) {
  const next = appendSpeech(state, charId, text)
  return { ...next, votes: { ...state.votes, [charId]: targetId || null } }
}

export function advanceChapter(state) {
  const script = getScript(state.scriptId)
  const nextIndex = state.chapterIndex + 1
  if (nextIndex >= script.chapters.length) return { ...state, finished: true }
  let next = openChapter(state, nextIndex)
  // 揭晓章：进章时先公布票型，再公布真相——之后所有人的最后一句话才有意义。
  if (getChapter(script, nextIndex)?.stage === 'reveal') next = revealTruth(next)
  return next
}

export function tallyVotes(state) {
  const script = getScript(state.scriptId)
  const counts = {}
  for (const target of Object.values(state.votes || {})) {
    if (!target) continue
    counts[target] = (counts[target] || 0) + 1
  }
  const rows = Object.entries(counts)
    .map(([charId, count]) => ({ charId, name: getCharacter(script, charId)?.name || charId, count }))
    .sort((a, b) => b.count - a.count)
  return { rows, top: rows[0] || null, abstain: Object.values(state.votes || {}).filter((v) => !v).length }
}

// 公布票型 + 真相。这是 script.truth 唯一一次进入公开日志的地方。
export function revealTruth(state) {
  const script = getScript(state.scriptId)
  const { rows, top } = tallyVotes(state)
  const entries = []
  if (rows.length) {
    entries.push(host(`【指认结果】\n${rows.map((r) => `${r.name} — ${r.count} 票`).join('\n')}`))
    const verdict = script.truth?.verdicts?.[top.charId]
    if (verdict) entries.push(host(verdict))
  } else {
    entries.push(host('【指认结果】没有人被指认。'))
  }
  entries.push(host(`【真相】\n${script.truth.summary}`))
  entries.push(host(`【那一晚真正发生了什么】\n${script.truth.timeline.map((t) => `· ${t}`).join('\n')}`))
  return { ...state, truthRevealed: true, log: [...state.log, ...entries] }
}

// 每个角色的结局文本，只在真相公布后使用。
export function endings(state) {
  const script = getScript(state.scriptId)
  return script.characters.map((c) => ({ charId: c.id, name: c.name, emoji: c.emoji, text: c.ending }))
}

// ---------------------------------------------------------------- 可见性

// 某个角色（或旁观视角 charId=null）能看到的日志。
// 私密条目只对它的主人可见——UI 和 prompt 都走这一个函数，不会有第二套规则。
export function visibleLog(state, charId) {
  return (state.log || []).filter((e) => e.visibility !== 'private' || e.forCharId === charId)
}

function publicTranscript(state) {
  const script = getScript(state.scriptId)
  const lines = []
  for (const e of state.log || []) {
    if (e.visibility === 'private') continue
    if (e.kind === 'speech') {
      lines.push(`${getCharacter(script, e.charId)?.name || e.charId}：${e.text}`)
    } else if (e.kind === 'chapter') {
      lines.push(`\n—— ${e.text.split('\n')[0]} ——`)
    } else if (e.kind === 'clue') {
      lines.push(`（公开线索）${e.text}`)
    } else {
      lines.push(`主持人：${e.text}`)
    }
  }
  return lines.join('\n')
}

function ownClues(state, charId) {
  return (state.log || [])
    .filter((e) => e.visibility === 'private' && e.forCharId === charId)
    .map((e) => e.text)
}

// ---------------------------------------------------------------- Prompt

// 只读 charId 自己那一条角色数据。别人的 secret / script.truth 在这里不可达。
export function buildCharacterSystemPrompt(scriptId, charId) {
  const script = getScript(scriptId)
  const c = getCharacter(script, charId)
  if (!c) throw new Error(`角色不存在：${charId}`)
  return `你正在参加一场沉浸式剧本杀，本子叫《${script.title}》。你扮演的角色是【${c.name}】。

# 公共背景（在场所有人都知道）
${script.intro}

# 你的公开身份（别人也看得到）
${c.publicBio}
你和大家的关系：${c.relation}

# 你说话的样子
${c.voice}

# 你的秘密（除了你没有第二个人知道）
${c.secret}

# 你这一局要做到的事
${c.mission}

# 铁律
1. 你就是${c.name}本人，全程第一人称，不是在"分析剧本"。可以用（）写自己的小动作。
2. 你只知道三样东西：上面这些、公开的发言记录、以及主持人单独发给你的线索。别的一律不知道，不许猜设定、不许编造别人的秘密、不许描写别人心里在想什么。
3. 秘密不要整段背出来。你可以撒谎、回避、只说一半——真人就是这样的。
4. 不要说"作为AI""这个剧本""根据线索推理"这类跳出角色的话，不要写小作文、不要分点罗列。
5. 每次发言 80–200 字，像一个人在饭桌上说话。`
}

export function buildTurnPrompt(state, charId) {
  const script = getScript(state.scriptId)
  const c = getCharacter(script, charId)
  const chapter = currentChapter(state)
  const clues = ownClues(state, charId)
  const parts = [
    `【${chapter.title}】`,
    `主持人：${chapter.narration}`,
    '',
    '【到目前为止，大家公开说过的话】',
    publicTranscript(state) || '（还没有人开口）',
    '',
  ]
  if (clues.length) {
    parts.push('【只有你一个人知道的线索】', clues.map((t) => `· ${t}`).join('\n'), '')
  }
  parts.push('【这一章你要做的事】', chapter.task, '')

  if (chapter.stage === 'vote') {
    parts.push(
      `现在轮到你（${c.name}）。请**第一行**只写「我指认：某某」（从 ${script.characters.map((x) => x.name).join('、')} 里选一个，也可以指认你自己），`,
      '然后换行，用你自己的话说清楚理由。理由要基于你真的知道的东西，不要凭空捏造证据。',
    )
  } else if (chapter.stage === 'reveal') {
    parts.push(`真相已经摊开了。现在轮到你（${c.name}）。只说一句话——你此刻最想对林晚说的那一句。不要复盘、不要总结、不要解释。`)
  } else {
    parts.push(`现在轮到你（${c.name}）发言。直接说你要说的话，不要写"（${c.name}说）"这种前缀。`)
  }
  return parts.join('\n')
}

// 从 AI 的回复里解出它指认了谁。先认「我指认：X」，认不出来就退化成
// "回复里最先出现的角色名"——解不出来就是弃权，不猜。
export function parseVote(scriptId, text) {
  const script = getScript(scriptId)
  const body = String(text || '')
  const m = body.match(/我指认[：:]\s*([^\n，,。.！!？?、]{1,12})/)
  if (m) {
    const hit = script.characters.find((c) => m[1].includes(c.name))
    if (hit) return hit.id
  }
  let best = null
  let bestIdx = Infinity
  for (const c of script.characters) {
    const i = body.indexOf(c.name)
    if (i >= 0 && i < bestIdx) { bestIdx = i; best = c.id }
  }
  return best
}

// NPC 这一章的台词：剧本里写死的，没写就给一句沉默——NPC 永远不消耗模型额度。
export function npcLine(state, charId) {
  const script = getScript(state.scriptId)
  const c = getCharacter(script, charId)
  const chapter = currentChapter(state)
  return c?.npcLines?.[chapter?.id] || `（${c?.name || '这个人'}没有说话。）`
}

export function npcVote(state, charId) {
  return getCharacter(getScript(state.scriptId), charId)?.npcVote ?? null
}
