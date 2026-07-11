// 网易云音乐（经 Worker 的 /ncm/* Cookie 代理）

const SYNC_BASE = 'https://chat.xiaoman.xyz'

export async function searchSongs(keywords, limit = 12) {
  const res = await fetch(`${SYNC_BASE}/ncm/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`)
  if (!res.ok) throw new Error(`搜索失败 HTTP ${res.status}`)
  const data = await res.json()
  return data.songs || []
}

export async function getPlayUrl(id) {
  const res = await fetch(`${SYNC_BASE}/ncm/playurl?id=${id}`)
  if (!res.ok) throw new Error(`获取播放链接失败 HTTP ${res.status}`)
  return res.json() // { ok, url, br, code }
}

export async function getLyric(id) {
  const res = await fetch(`${SYNC_BASE}/ncm/lyric?id=${id}`)
  if (!res.ok) return { lrc: '', tlyric: '' }
  return res.json()
}

// Cookie 登录状态自检（面板顶部显示账号是否生效）
export async function getNcmStatus() {
  const res = await fetch(`${SYNC_BASE}/ncm/status`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() // { cookieConfigured, loggedIn, nickname, vipType }
}
