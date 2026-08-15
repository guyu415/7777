const REPLY_LINE = /^> 回复(?: ([^：\n]+))?：([^\n]*)$/

export function buildReplyQuotePrefix(quotes) {
  if (!Array.isArray(quotes) || quotes.length === 0) return ''
  const lines = quotes.map((quote) => {
    const label = String(quote?.label || '').replace(/[：\n\r]/g, ' ').trim()
    const preview = String(quote?.preview || '消息').replace(/[\n\r]/g, ' ').trim()
    return `> 回复${label ? ` ${label}` : ''}：${preview || '消息'}`
  })
  return `${lines.join('\n')}\n\n`
}

export function buildQuotedReplyContent(quotes, parts) {
  const body = (Array.isArray(parts) ? parts : [])
    .filter((part) => typeof part === 'string' && part.trim())
    .join('\n')
  return `${buildReplyQuotePrefix(quotes)}${body}`
}

export function buildReplyMessage(content, quotes) {
  const body = typeof content === 'string' ? content.trim() : ''
  if (!body) return ''
  return Array.isArray(quotes) && quotes.length
    ? buildQuotedReplyContent(quotes, [body])
    : body
}

export function buildReplyMessageBatch(queuedMessages, currentText, currentQuotes) {
  const queued = (Array.isArray(queuedMessages) ? queuedMessages : [])
    .filter((message) => typeof message === 'string' && message.trim())
  const current = buildReplyMessage(currentText, currentQuotes)
  return current ? [...queued, current] : queued
}

// Persistent runtimes accept one physical turn even when the composer shows
// several user bubbles. A plain newline join loses the boundary before a
// later quote (`normal\n> 回复...`), because that quote is no longer at the
// start of a message. Give every part the same explicit envelope.
export function formatReplyMessageBatchForModel(messages) {
  const parts = (Array.isArray(messages) ? messages : [])
    .filter((message) => typeof message === 'string' && message.trim())
    .map((message) => message.trim())
  if (parts.length <= 1) return parts[0] || ''
  return parts
    .map((message, index) => `【同一轮分条消息 ${index + 1}/${parts.length}】\n${message}`)
    .join('\n\n')
}

export function parseReplyQuotes(content) {
  if (typeof content !== 'string' || !content.startsWith('> 回复')) return null

  const lines = content.split('\n')
  const quotes = []
  let index = 0
  while (index < lines.length) {
    const match = lines[index].match(REPLY_LINE)
    if (!match) break
    quotes.push({ label: match[1] || '', preview: match[2] })
    index += 1
  }

  // The blank line is the unambiguous boundary between quote metadata and
  // the user's own message. Keep old single-quote messages compatible.
  if (!quotes.length || lines[index] !== '') return null
  return { quotes, body: lines.slice(index + 1).join('\n') }
}
