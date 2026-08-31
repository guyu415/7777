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
