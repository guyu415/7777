function finiteTime(value) {
  const time = Number(value)
  return Number.isFinite(time) && time > 0 ? time : null
}

// Live messages use their start timestamp so the counter catches up correctly
// after iOS suspends JS. Older saved messages predate timing metadata, so they
// intentionally return null rather than displaying a made-up duration.
export function getReasoningDurationMs(message, now = Date.now()) {
  const fixed = finiteTime(message?.reasoningDurationMs)
  if (fixed) return fixed

  const startedAt = finiteTime(message?.reasoningStartedAt)
    || (message?.reasoningStreaming ? finiteTime(message?.timestamp) : null)
  if (startedAt) {
    const completedAt = finiteTime(message?.reasoningCompletedAt)
    const endAt = completedAt || (message?.reasoningStreaming ? now : null)
    if (endAt) return Math.max(0, endAt - startedAt)
  }

  // Old saved messages have no timing metadata. Showing “1 秒” for every one
  // looks precise but is fabricated, so callers render a neutral “已思考”.
  return null
}

export function formatReasoningSeconds(durationMs) {
  if (durationMs == null || !Number.isFinite(Number(durationMs))) return null
  return `${Math.max(1, Math.round(Math.max(0, Number(durationMs) || 0) / 1000))} 秒`
}
