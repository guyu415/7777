// AI 点歌的手机交接层。
// Eunoia 只选歌并生成网易云 App Deep Link，不在网页或 VPS 上播放音频。
import { createNeteasePhoneAction, searchSongs, syncNeteasePlayback } from './music'

const STORAGE_KEY = 'eunoia.netease-playback.v1'
const state = { current: null, action: null, lyrics: [], startedAt: 0, mode: 'phone-handoff' }
const listeners = new Set()

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
  if (saved?.action?.songId && Number.isFinite(saved.startedAt)) Object.assign(state, saved)
} catch { /* private browsing/storage disabled */ }

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* best effort */ }
}

function emit() {
  for (const fn of listeners) fn({ ...state })
}

export function subscribePlayer(fn) {
  listeners.add(fn)
  fn({ ...state })
  return () => listeners.delete(fn)
}

export function getPlayerState() {
  const positionMs = state.startedAt ? Math.max(0, Date.now() - state.startedAt) : 0
  const lyricIndex = findLyricIndex(state.lyrics, positionMs)
  return { ...state, positionMs, lyricIndex, currentLyric: lyricIndex >= 0 ? state.lyrics[lyricIndex] : null }
}

export function findLyricIndex(lines, positionMs) {
  let low = 0
  let high = (lines?.length || 0) - 1
  let answer = -1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (lines[mid].timeMs <= positionMs) { answer = mid; low = mid + 1 } else high = mid - 1
  }
  return answer
}

export function startPhonePlayback(action, lyrics = []) {
  state.action = action
  state.current = { id: action.songId, name: action.name, artists: action.artists, album: action.album, cover: action.cover }
  state.lyrics = Array.isArray(lyrics) ? lyrics : []
  state.startedAt = Date.now()
  persist(); emit()
  void syncNeteasePlayback(action, 0).catch(() => {})
  return getPlayerState()
}

export function attachPhonePlaybackLyrics(songId, lyrics) {
  if (state.action?.songId !== String(songId) || !Array.isArray(lyrics) || !lyrics.length) return getPlayerState()
  state.lyrics = lyrics
  persist(); emit()
  return getPlayerState()
}

export function calibratePhonePlayback(positionMs) {
  if (!state.action) return getPlayerState()
  state.startedAt = Date.now() - Math.max(0, Number(positionMs) || 0)
  persist(); emit()
  void syncNeteasePlayback(state.action, Date.now() - state.startedAt).catch(() => {})
  return getPlayerState()
}

export async function playByQuery(query, match = {}) {
  const songs = await searchSongs(query, 8, match)
  if (!songs.length) return { ok: false, reason: `网易云没搜到「${query}」` }
  const song = songs[0]
  const action = createNeteasePhoneAction(song)
  state.current = song
  state.action = action
  persist()
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
  state.action = null
  state.lyrics = []
  state.startedAt = 0
  persist()
  emit()
  return { ok: false, reason: '请用网易云或手机控制中心停止播放' }
}
