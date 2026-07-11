// Bilibili 视频区（经 Worker 的 /bili/* 代理）
// 迭代：网易云（地区限制 404）→ B 站音频区（HTTP 412 反爬）→
// B 站视频区（WBI 签名 + buvid3，曲库巨大）。song.id 现在是 bvid 字符串。

const SYNC_BASE = 'https://chat.xiaoman.xyz'

export async function searchSongs(keywords, limit = 12) {
  const res = await fetch(`${SYNC_BASE}/bili/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`)
  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`)
  const data = await res.json()
  return data.songs || []
}

export async function getPlayUrl(id) {
  const res = await fetch(`${SYNC_BASE}/bili/playurl?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`获取播放链接失败 HTTP ${res.status}`)
  return res.json() // { ok, url, br, code, stage? }
}

export async function getLyric(id) {
  const res = await fetch(`${SYNC_BASE}/bili/lyric?id=${encodeURIComponent(id)}`)
  if (!res.ok) return { lrc: '', tlyric: '' }
  return res.json()
}

// 数据源探测：面板顶部显示"数据源：Bilibili 视频区 · 探测正常 (N 首)"
export async function getMusicStatus() {
  const res = await fetch(`${SYNC_BASE}/bili/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() // { ok, source, probe }
}
