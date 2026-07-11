// 全局音乐播放器单例：MusicDisc 挂件和 AI 的 [MUSIC:...] 指令共用。
import { searchSongs, getPlayUrl } from './music'

const state = { current: null, playing: false, progress: 0, duration: 0 }
const listeners = new Set()
let audio = null

function emit() {
  for (const fn of listeners) fn({ ...state })
}

// iOS 不允许无手势的音频播放。页面上任意一次点按（比如发消息）都会
// 提前用静音 wav 解锁 audio 元素，这样 AI 回复触发的播放就不会被拒。
const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
let unlocked = false
function unlockOnce() {
  if (unlocked) return
  unlocked = true
  const a = getAudio()
  if (!a.src) {
    a.src = SILENT_WAV
    a.play().then(() => { a.pause(); a.removeAttribute('src') }).catch(() => {})
  }
  document.removeEventListener('touchend', unlockOnce)
  document.removeEventListener('click', unlockOnce)
}
if (typeof document !== 'undefined') {
  document.addEventListener('touchend', unlockOnce, { passive: true })
  document.addEventListener('click', unlockOnce)
}

function getAudio() {
  if (!audio) {
    audio = new Audio()
    audio.addEventListener('timeupdate', () => { state.progress = audio.currentTime; emit() })
    audio.addEventListener('durationchange', () => { state.duration = audio.duration || 0; emit() })
    audio.addEventListener('play', () => { state.playing = true; emit() })
    audio.addEventListener('pause', () => { state.playing = false; emit() })
    audio.addEventListener('ended', () => { state.playing = false; emit() })
  }
  return audio
}

export function subscribePlayer(fn) {
  listeners.add(fn)
  fn({ ...state })
  return () => listeners.delete(fn)
}

export function getPlayerState() {
  return { ...state }
}

export async function playSong(song) {
  const { ok, url } = await getPlayUrl(song.id)
  if (!ok || !url) {
    const reason = song.fee === 1
      ? 'VIP 歌曲，需要在 Worker 配置 NCM_COOKIE（VIP 账号）'
      : '拿不到播放链接，可能无版权或已下架'
    return { ok: false, reason }
  }
  const a = getAudio()
  a.src = url
  await a.play()
  state.current = song
  emit()
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.name, artist: song.artists, album: song.album,
        artwork: song.cover ? [{ src: song.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
      })
      navigator.mediaSession.setActionHandler('play', () => getAudio().play())
      navigator.mediaSession.setActionHandler('pause', () => getAudio().pause())
    } catch {}
  }
  return { ok: true, song }
}

// AI 点歌入口：搜索并按顺序尝试前几首（跳过放不出来的）
export async function playByQuery(query) {
  const songs = await searchSongs(query, 6)
  if (!songs.length) return { ok: false, reason: `没搜到「${query}」` }
  for (const song of songs.slice(0, 3)) {
    try {
      const r = await playSong(song)
      if (r.ok) return r
    } catch (e) {
      console.warn('[PLAYER] 尝试播放失败:', song.name, e.message)
    }
  }
  return { ok: false, reason: '搜到了但都播放不了（版权/VIP 限制）' }
}

export function pausePlayer() {
  const a = getAudio()
  if (a.src) a.pause()
}

export function resumePlayer() {
  const a = getAudio()
  if (a.src && state.current) a.play().catch(() => {})
}

export function stopPlayer() {
  const a = getAudio()
  a.pause()
  a.removeAttribute('src')
  state.current = null
  state.playing = false
  state.progress = 0
  state.duration = 0
  emit()
}

export function togglePlayer() {
  const a = getAudio()
  if (!a.src) return
  if (a.paused) a.play().catch(() => {})
  else a.pause()
}

export function seekPlayer(seconds) {
  const a = getAudio()
  if (a.src && Number.isFinite(seconds)) a.currentTime = seconds
}
