export const THINKING_PAINT_GRACE_MS = 120

/**
 * Keep the visible reply behind a just-emitted thinking frame long enough for
 * the browser's throttled reasoning update to render at least once.
 */
export function remainingThinkingPaintDelay(
  lastBroadcastAt: unknown,
  now = Date.now(),
  graceMs = THINKING_PAINT_GRACE_MS,
): number {
  const sentAt = Number(lastBroadcastAt)
  if (!Number.isFinite(sentAt) || sentAt <= 0) return 0
  const grace = Number.isFinite(graceMs) ? Math.max(0, Number(graceMs)) : THINKING_PAINT_GRACE_MS
  return Math.max(0, Math.ceil(grace - Math.max(0, now - sentAt)))
}
