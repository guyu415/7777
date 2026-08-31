// 网易云手机播放控制：这里只搜索歌曲并生成 App Deep Link。
// 音频始终由手机上的网易云官方客户端获取，VPS 不解析或缓存歌曲文件。

const SYNC_BASE = 'https://chat.xiaoman.xyz'

function numericSongId(id) {
  const value = String(id ?? '').trim()
  if (!/^\d+$/.test(value)) throw new Error('无效的网易云歌曲 ID')
  return value
}

export async function searchSongs(keywords, limit = 12, match = {}) {
  const query = String(keywords || '').trim()
  if (!query) return []
  const size = Math.min(Math.max(Number(limit) || 12, 1), 20)
  const params = new URLSearchParams({ keywords: query, limit: String(size) })
  if (match.title) params.set('title', match.title)
  if (match.artist) params.set('artist', match.artist)
  const res = await fetch(`${SYNC_BASE}/netease/search?${params}`)
  if (!res.ok) throw new Error(`网易云搜索失败 HTTP ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || '网易云搜索失败')
  return data.songs || []
}

export async function getNeteaseLyrics(id) {
  const songId = numericSongId(id)
  const res = await fetch(`${SYNC_BASE}/netease/lyric?id=${songId}`)
  if (!res.ok) throw new Error(`歌词获取失败 HTTP ${res.status}`)
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || '歌词获取失败')
  return parseLrc(data.lrc || '', data.tlyric || '')
}

function parseTimestamp(minutes, seconds, fraction = '') {
  const fractionMs = fraction ? Number(`0.${fraction}`) * 1000 : 0
  return Math.round((Number(minutes) * 60 + Number(seconds)) * 1000 + fractionMs)
}

export function parseLrc(lrc, translatedLrc = '') {
  const parse = (value) => {
    const rows = new Map()
    let offset = 0
    for (const rawLine of String(value || '').split(/\r?\n/)) {
      const offsetMatch = rawLine.match(/^\[offset:([+-]?\d+)\]/i)
      if (offsetMatch) { offset = Number(offsetMatch[1]) || 0; continue }
      const stamps = [...rawLine.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)]
      if (!stamps.length) continue
      const text = rawLine.replace(/\[[^\]]+\]/g, '').trim()
      if (!text) continue
      for (const stamp of stamps) rows.set(Math.max(0, parseTimestamp(stamp[1], stamp[2], stamp[3]) + offset), text)
    }
    return rows
  }
  const original = parse(lrc)
  const translated = parse(translatedLrc)
  return [...original.entries()].sort((a, b) => a[0] - b[0]).map(([timeMs, text]) => ({
    timeMs,
    text,
    translation: translated.get(timeMs) || '',
  }))
}

export async function syncNeteasePlayback(action, positionMs = 0) {
  const songId = numericSongId(action?.songId)
  const body = {
    songId,
    name: String(action?.name || '').slice(0, 100),
    artists: String(action?.artists || '').slice(0, 100),
    positionMs: Math.max(0, Math.round(Number(positionMs) || 0)),
  }
  const res = await fetch(`${SYNC_BASE}/netease/playback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  })
  if (!res.ok) throw new Error(`播放进度同步失败 HTTP ${res.status}`)
  return res.json()
}

export function buildNeteaseDeepLink(id) {
  return `orpheus://song/${numericSongId(id)}/?autoplay=1`
}

export function buildNeteaseWebUrl(id) {
  return `https://music.163.com/song?id=${numericSongId(id)}`
}

export function createNeteasePhoneAction(song) {
  if (!song?.id) throw new Error('歌曲信息不完整')
  return {
    provider: 'netease',
    songId: String(song.id),
    name: song.name || '未知歌曲',
    artists: song.artists || '',
    album: song.album || '',
    cover: song.cover || '',
    deepLink: buildNeteaseDeepLink(song.id),
    webUrl: buildNeteaseWebUrl(song.id),
  }
}
