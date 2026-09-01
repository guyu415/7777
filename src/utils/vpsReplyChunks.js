const VPS_CHUNK_MARKER_OPEN = '\uE000CC-CHUNK:'
const VPS_CHUNK_MARKER_CLOSE = '\uE001'
const VPS_CHUNK_MARKER_RE = /\uE000CC-CHUNK:(\d+)\uE001/g

// Preserve the transport boundary while the caller strips structured tags.
// One CC reply() tool call is one durable server message and one UI bubble;
// blank lines inside that call are formatting, not message boundaries.
export function markVpsReplyChunks(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry, index) => `${VPS_CHUNK_MARKER_OPEN}${index}${VPS_CHUNK_MARKER_CLOSE}${String(entry?.text || '').trim()}`)
    .join('')
}

export function extractVpsReplyTokens(processedContent, entries) {
  const source = String(processedContent || '')
  const matches = [...source.matchAll(VPS_CHUNK_MARKER_RE)]
  if (!matches.length) return []
  const tokens = []
  for (let index = 0; index < matches.length; index++) {
    const match = matches[index]
    const entryIndex = Number(match[1])
    const start = match.index + match[0].length
    const end = matches[index + 1]?.index ?? source.length
    // CC voice uses send_voice on the wire. A leaked legacy [VOICE] tag in a
    // text reply degrades to text without creating sibling identities for one
    // wire message.
    const content = source.slice(start, end).replace(/\[\/?VOICE\]/g, '').trim()
    if (!content) continue
    tokens.push({ type: 'text', content, wireId: entries?.[entryIndex]?.wireId || null })
  }
  return tokens
}
