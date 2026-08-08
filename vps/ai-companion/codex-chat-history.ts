export type SplittableCodexMessage = {
  id: string
  from: string
  text: string
  ts: number
  streaming?: boolean
  reasoning?: string
  [key: string]: unknown
}

// Match the CC chat surface: an explicit [SPLIT] marker or one-or-more blank
// lines ends the current assistant bubble. Single newlines stay untouched so
// lists and ordinary Markdown remain together.
export function splitCodexReplyText(text: string): string[] {
  const normalized = String(text || '').replace(/\[SPLIT\]/g, '\n\n')
  return normalized.split(/\n\s*\n+/).map((part) => part.trim()).filter(Boolean)
}

export function splitCompletedCodexMessage<T extends SplittableCodexMessage>(
  message: T,
  nextId: () => string,
): T[] {
  if (message.from !== 'codex' || message.streaming || !message.text.trim()) return [message]
  const parts = splitCodexReplyText(message.text)
  if (parts.length <= 1) return [{ ...message, text: parts[0] ?? message.text.trim() }]
  return parts.map((text, index) => ({
    ...message,
    id: index === 0 ? message.id : nextId(),
    text,
    ts: message.ts + index,
    ...(index === 0 ? {} : { reasoning: undefined }),
  }))
}
