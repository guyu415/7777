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
