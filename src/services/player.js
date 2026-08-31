// AI 点歌的手机交接层。
// Eunoia 只选歌并生成网易云 App Deep Link，不在网页或 VPS 上播放音频。
import { createNeteasePhoneAction, searchSongs } from './music'

const state = { current: null, mode: 'phone-handoff' }
const listeners = new Set()

function emit() {
  for (const fn of listeners) fn({ ...state })
}

export function subscribePlayer(fn) {
  listeners.add(fn)
  fn({ ...state })
  return () => listeners.delete(fn)
}

export function getPlayerState() {
  return { ...state }
}

export async function playByQuery(query, match = {}) {
  const songs = await searchSongs(query, 8, match)
  if (!songs.length) return { ok: false, reason: `网易云没搜到「${query}」` }
  const song = songs[0]
  const action = createNeteasePhoneAction(song)
  state.current = song
  emit()
  return { ok: true, song, action }
}

export function pausePlayer() {
  return { ok: false, reason: '请用网易云或手机控制中心暂停' }
}

export function resumePlayer() {
  return { ok: false, reason: '请用网易云或手机控制中心继续播放' }
}

export function stopPlayer() {
  state.current = null
  emit()
  return { ok: false, reason: '请用网易云或手机控制中心停止播放' }
}
