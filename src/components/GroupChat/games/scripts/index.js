// 剧本注册表——以后加新本只改这一个文件：写一份 scripts/xxx.js 纯数据，
// import 进来，push 到这个数组。引擎和 UI 都是按数据驱动的，不用动。
import { MIST_ISLAND_LETTER } from './mistIslandLetter'
import { EMOTIONAL_MYSTERIES } from './emotionalMysteries'

const CUSTOM_STORAGE_KEY = 'eunoia.custom-mystery-scripts.v1'
const BUILTIN_SCRIPTS = [MIST_ISLAND_LETTER, ...EMOTIONAL_MYSTERIES]

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空`)
  return value.trim()
}

export function validateMysteryScript(input, { custom = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('剧本 JSON 必须是一个对象')
  const script = structuredClone(input)
  script.id = requiredText(script.id, 'id')
  if (!/^[a-z0-9][a-z0-9-]{2,63}$/.test(script.id)) throw new Error('id 只能用小写字母、数字和短横线，长度 3—64')
  script.title = requiredText(script.title, '标题')
  script.intro = requiredText(script.intro, '公共背景')
  script.hostOpening = requiredText(script.hostOpening, '主持人开场')
  if (!Array.isArray(script.characters) || ![4, 5].includes(script.characters.length)) throw new Error('目前只支持 4 人或 5 人本')
  if (!Array.isArray(script.chapters) || script.chapters.length < 4) throw new Error('至少需要 4 个章节')
  const charIds = new Set()
  for (const [index, c] of script.characters.entries()) {
    if (!c || typeof c !== 'object') throw new Error(`角色 ${index + 1} 格式错误`)
    c.id = requiredText(c.id, `角色 ${index + 1} id`)
    if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(c.id) || charIds.has(c.id)) throw new Error(`角色 id “${c.id}”无效或重复`)
    charIds.add(c.id)
    for (const field of ['name', 'title', 'publicBio', 'relation', 'voice', 'secret', 'mission', 'ending']) requiredText(c[field], `${c.name || `角色 ${index + 1}`} 的 ${field}`)
    if (!c.privateClues || typeof c.privateClues !== 'object') c.privateClues = {}
    if (!c.npcLines || typeof c.npcLines !== 'object') c.npcLines = {}
  }
  const chapterIds = new Set()
  for (const [index, chapter] of script.chapters.entries()) {
    chapter.id = requiredText(chapter?.id, `章节 ${index + 1} id`)
    if (chapterIds.has(chapter.id)) throw new Error(`章节 id “${chapter.id}”重复`)
    chapterIds.add(chapter.id)
    chapter.title = requiredText(chapter.title, `章节 ${index + 1} 标题`)
    chapter.narration = requiredText(chapter.narration, `章节 ${index + 1} 旁白`)
    chapter.task = requiredText(chapter.task, `章节 ${index + 1} 任务`)
    if (!['story', 'vote', 'reveal'].includes(chapter.stage)) throw new Error(`章节 ${chapter.id} 的 stage 无效`)
    if (!Array.isArray(chapter.publicClues)) chapter.publicClues = []
  }
  if (!script.chapters.some((chapter) => chapter.stage === 'vote') || !script.chapters.some((chapter) => chapter.stage === 'reveal')) throw new Error('剧本必须包含投票章和真相揭晓章')
  if (!script.truth || !charIds.has(script.truth.culpritId)) throw new Error('truth.culpritId 必须指向一个真实角色')
  script.truth.summary = requiredText(script.truth.summary, '真相总结')
  if (!Array.isArray(script.truth.timeline) || !script.truth.timeline.length) throw new Error('真相时间线不能为空')
  if (!script.truth.verdicts || typeof script.truth.verdicts !== 'object') script.truth.verdicts = {}
  script.icon = typeof script.icon === 'string' && script.icon ? script.icon.slice(0, 8) : '🕯️'
  script.genre = typeof script.genre === 'string' && script.genre ? script.genre.slice(0, 40) : '自定义剧本'
  script.duration = typeof script.duration === 'string' && script.duration ? script.duration.slice(0, 40) : '时长自定'
  script.tagline = typeof script.tagline === 'string' ? script.tagline.slice(0, 120) : ''
  script.seats = script.characters.length
  script.hasCulprit = true
  if (custom) script.custom = true
  return script
}

function loadCustomScripts() {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    const valid = []
    for (const item of raw) {
      try { valid.push(validateMysteryScript(item, { custom: true })) } catch { /* one broken import must not hide the others */ }
    }
    return valid
  } catch {
    return []
  }
}

let customScripts = loadCustomScripts()
export let MYSTERY_SCRIPTS = [...BUILTIN_SCRIPTS, ...customScripts]

function persistCustomScripts() {
  if (typeof localStorage !== 'undefined') localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customScripts))
  MYSTERY_SCRIPTS = [...BUILTIN_SCRIPTS, ...customScripts]
}

export function importMysteryScript(input) {
  const parsed = typeof input === 'string' ? JSON.parse(input) : input
  const script = validateMysteryScript(parsed?.script || parsed, { custom: true })
  if (BUILTIN_SCRIPTS.some((item) => item.id === script.id)) throw new Error('这个 id 与内置剧本重复，请换一个 id')
  if (customScripts.some((item) => item.id === script.id)) throw new Error('已经导入过这个剧本；请先删除旧版本或更换 id')
  customScripts = [...customScripts, script]
  persistCustomScripts()
  return script
}

export function removeCustomMysteryScript(scriptId) {
  const next = customScripts.filter((item) => item.id !== scriptId)
  if (next.length === customScripts.length) return false
  customScripts = next
  persistCustomScripts()
  return true
}

export function getScript(scriptId) {
  return MYSTERY_SCRIPTS.find((s) => s.id === scriptId) || null
}

export function getCharacter(script, charId) {
  return script?.characters?.find((c) => c.id === charId) || null
}

export function getChapter(script, index) {
  return script?.chapters?.[index] || null
}
