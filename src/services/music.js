// iTunes / Apple Music 试听（经 Worker 的 /itunes/* 代理）
// 迭代：网易云（地区 404）→ B 站音频区（412）→ B 站视频区（机房 IP 风控 412）
// → iTunes。境外机房 IP 反而是优势：iTunes 不封境外、零登录、零风控，
// 几乎每首华语流行都有，返回可直接播放的 m4a。代价：每首 30 秒试听。

const SYNC_BASE = 'https://chat.xiaoman.xyz'

export async function searchSongs(keywords, limit = 12) {
  const res = await fetch(`${SYNC_BASE}/itunes/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`)
  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`)
  const data = await res.json()
  return data.songs || []
}

export async function getPlayUrl(id) {
  const res = await fetch(`${SYNC_BASE}/itunes/playurl?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`获取播放链接失败 HTTP ${res.status}`)
  return res.json() // { ok, url, br, code }
}

export async function getLyric(id) {
  const res = await fetch(`${SYNC_BASE}/itunes/lyric?id=${encodeURIComponent(id)}`)
  if (!res.ok) return { lrc: '', tlyric: '' }
  return res.json()
}

// 数据源探测：面板顶部显示"数据源：Apple Music 试听 · 探测正常 (N 首)"
export async function getMusicStatus() {
  const res = await fetch(`${SYNC_BASE}/itunes/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() // { ok, source, probe }
}
