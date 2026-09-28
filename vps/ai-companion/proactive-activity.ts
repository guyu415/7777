const DEFAULT_MAX_DETAIL_CHARS = 8_000

function cleanVisibleText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim()
}

/** Build one durable main-chat activity message without flattening its list/output. */
export function formatProactiveActivityMessage(
  title: unknown,
  detail: unknown,
  maxDetailChars = DEFAULT_MAX_DETAIL_CHARS,
): string {
  const heading = cleanVisibleText(title).replace(/\n+/g, ' ').slice(0, 80)
  const body = cleanVisibleText(detail)
  const limit = Number.isFinite(maxDetailChars) ? Math.max(1, Math.floor(maxDetailChars)) : DEFAULT_MAX_DETAIL_CHARS
  const visibleBody = body.length > limit ? `${body.slice(0, limit - 1).trimEnd()}…` : body
  return [heading, visibleBody].filter(Boolean).join('\n')
}

/** Only a self-directed proactive turn may accept a user message into the FIFO. */
export function shouldQueueDuringProactiveTurn(openTurnId: unknown, proactiveTurnId: unknown): boolean {
  return typeof openTurnId === 'string' && openTurnId.length > 0 && openTurnId === proactiveTurnId
}
