const VPS_CHUNK_MARKER_OPEN = '\uE000CC-CHUNK:'
const VPS_CHUNK_MARKER_CLOSE = '\uE001'
const VPS_CHUNK_MARKER_RE = /\uE000CC-CHUNK:(\d+)\uE001/g
const SPLIT_RE = /\[SPLIT\]/g

export function splitVpsReplyContent(content) {
  return String(content || '')
    .replace(SPLIT_RE, '\n\n')
    .split(/\n\n+/)
    .map(part => part.trim())
    .filter(Boolean)
}

export function vpsReplyFragmentId(wireId, partIndex, partCount) {
  if (!wireId) return null
  return partCount > 1 ? `${wireId}::part:${partIndex}` : wireId
}

// Preserve the transport boundary while the caller strips structured tags.
// One CC reply() tool call is one durable server message. Its paragraphs may
// become multiple UI bubbles later without losing this transport boundary.
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
    const parts = splitVpsReplyContent(content)
    const serverWireId = entries?.[entryIndex]?.wireId || null
    for (let partIndex = 0; partIndex < parts.length; partIndex++) {
      tokens.push({
        type: 'text',
        content: parts[partIndex],
        wireId: vpsReplyFragmentId(serverWireId, partIndex, parts.length),
        serverWireId,
        wirePartIndex: partIndex,
        wirePartCount: parts.length,
      })
    }
  }
  return tokens
}
