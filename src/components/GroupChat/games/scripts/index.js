// 剧本注册表——以后加新本只改这一个文件：写一份 scripts/xxx.js 纯数据，
// import 进来，push 到这个数组。引擎和 UI 都是按数据驱动的，不用动。
import { MIST_ISLAND_LETTER } from './mistIslandLetter'

export const MYSTERY_SCRIPTS = [MIST_ISLAND_LETTER]

export function getScript(scriptId) {
  return MYSTERY_SCRIPTS.find((s) => s.id === scriptId) || null
}

export function getCharacter(script, charId) {
  return script?.characters?.find((c) => c.id === charId) || null
}

export function getChapter(script, index) {
  return script?.chapters?.[index] || null
}
