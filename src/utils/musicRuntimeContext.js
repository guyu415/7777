// Browser-side formatter for the direct API path. The authoritative snapshot
// still comes from channel-server's authenticated /music/context endpoint;
// this file only formats that one request's response and never stores it.

function boundedText(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function jsonField(value) {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? 'null' : encoded
}

export function renderMusicRuntimeContext(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || snapshot.active !== true) return ''
  const song = snapshot.song && typeof snapshot.song === 'object' ? snapshot.song : {}
  const lyric = snapshot.currentLyric && typeof snapshot.currentLyric === 'object' ? snapshot.currentLyric : null
  const position = Number(snapshot.positionMs)
  const positionMs = Number.isFinite(position) ? Math.max(0, Math.round(position)) : 0
  return [
    '【临时运行时音乐上下文：仅对本轮模型请求有效；不要写入长期记忆或聊天历史】',
    `song: ${jsonField(boundedText(song.name))}`,
    `artist: ${jsonField(boundedText(song.artists))}`,
    `positionMs: ${positionMs}`,
    `currentLyric: ${jsonField(lyric ? boundedText(lyric.text, 500) : null)}`,
  ].join('\n')
}

export function appendMusicRuntimeContext(text, snapshot) {
  const runtime = renderMusicRuntimeContext(snapshot)
  return runtime ? `${runtime}\n\n${text || ''}` : text
}

