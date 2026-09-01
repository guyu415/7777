// Ephemeral music context shared by the server-side model request boundaries.
// This module deliberately has no persistence, I/O, or model/tool behavior:
// callers provide the current snapshot and receive a request-only text block.

type MusicContextSong = {
  id?: unknown
  name?: unknown
  artists?: unknown
}

type MusicContextLyric = {
  timeMs?: unknown
  text?: unknown
  translation?: unknown
}

type MusicContextSnapshot = {
  active?: unknown
  song?: MusicContextSong | null
  positionMs?: unknown
  currentLyric?: MusicContextLyric | null
}

function boundedText(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function jsonField(value: unknown): string {
  const encoded = JSON.stringify(value)
  return encoded === undefined ? 'null' : encoded
}

export function renderMusicRuntimeContext(snapshot: unknown): string {
  if (!snapshot || typeof snapshot !== 'object' || (snapshot as MusicContextSnapshot).active !== true) return ''
  const context = snapshot as MusicContextSnapshot
  const song = context.song && typeof context.song === 'object' ? context.song : {}
  const lyric = context.currentLyric && typeof context.currentLyric === 'object' ? context.currentLyric : null
  const position = Number(context.positionMs)
  const positionMs = Number.isFinite(position) ? Math.max(0, Math.round(position)) : 0

  return [
    '【临时运行时音乐上下文：仅对本轮模型请求有效；不要写入长期记忆或聊天历史】',
    `song: ${jsonField(boundedText(song.name))}`,
    `artist: ${jsonField(boundedText(song.artists))}`,
    `positionMs: ${positionMs}`,
    `currentLyric: ${jsonField(lyric ? boundedText(lyric.text, 500) : null)}`,
  ].join('\n')
}

export function injectMusicRuntimeContext(text: string, snapshot: unknown): string {
  const runtime = renderMusicRuntimeContext(snapshot)
  if (!runtime) return text
  return text ? `${runtime}\n\n${text}` : runtime
}

// Codex app-server has no per-turn developer-instructions field. Its
// request-only input array is the narrowest boundary available for a turn, so
// prepend the context to the first text item. The caller's raw user text and
// the server's own history remain untouched; this function also never mutates
// the supplied params object or input array.
export function injectMusicRuntimeContextIntoTurnParams(params: unknown, snapshot: unknown): unknown {
  const runtime = renderMusicRuntimeContext(snapshot)
  if (!runtime || !params || typeof params !== 'object') return params
  const record = params as Record<string, unknown>
  if (!Array.isArray(record.input)) return params

  const input = record.input as unknown[]
  const firstTextIndex = input.findIndex((item) => (
    !!item && typeof item === 'object' && typeof (item as Record<string, unknown>).text === 'string'
  ))
  const nextInput = input.map((item, index) => {
    if (index !== firstTextIndex) return item
    const block = item as Record<string, unknown>
    return { ...block, text: `${runtime}\n\n${block.text as string}` }
  })
  if (firstTextIndex === -1) nextInput.unshift({ type: 'text', text: runtime, text_elements: [] })
  return { ...record, input: nextInput }
}

