// Bilibili 音频（经 Worker 的 /bili/* 代理）
// 之前接的网易云被境外 IP 挡在门外，改用 B 站音频区。

const SYNC_BASE = 'https://chat.xiaoman.xyz'

export async function searchSongs(keywords, limit = 12) {
  const res = await fetch(`${SYNC_BASE}/bili/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`)
  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`)
  const data = await res.json()
  return data.songs || []
}

export async function getPlayUrl(id) {
  const res = await fetch(`${SYNC_BASE}/bili/playurl?id=${id}`)
  if (!res.ok) throw new Error(`获取播放链接失败 HTTP ${res.status}`)
  return res.json() // { ok, url, br, code }
}

export async function getLyric(id) {
  const res = await fetch(`${SYNC_BASE}/bili/lyric?id=${id}`)
  if (!res.ok) return { lrc: '', tlyric: '' }
  return res.json()
}

// 数据源探测：显示"数据源：Bilibili 音频区"
export async function getMusicStatus() {
  const res = await fetch(`${SYNC_BASE}/bili/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() // { ok, source, note }
}
