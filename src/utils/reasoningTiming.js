const MIN_VISIBLE_REASONING_MS = 1000

function finiteTime(value) {
  const time = Number(value)
  return Number.isFinite(time) && time > 0 ? time : null
}

// Older saved messages predate timing metadata. They still get an honest,
// stable label instead of a blank duration; live messages use their start
// timestamp so the counter also catches up correctly after iOS suspends JS.
export function getReasoningDurationMs(message, now = Date.now()) {
  const fixed = finiteTime(message?.reasoningDurationMs)
  if (fixed) return Math.max(MIN_VISIBLE_REASONING_MS, fixed)

  const startedAt = finiteTime(message?.reasoningStartedAt)
    || (message?.reasoningStreaming ? finiteTime(message?.timestamp) : null)
  if (startedAt) {
    const completedAt = finiteTime(message?.reasoningCompletedAt)
    const endAt = completedAt || (message?.reasoningStreaming ? now : null)
    if (endAt) return Math.max(MIN_VISIBLE_REASONING_MS, endAt - startedAt)
  }

  return message?.reasoning ? MIN_VISIBLE_REASONING_MS : 0
}

export function formatReasoningSeconds(durationMs) {
  return `${Math.max(1, Math.round(Math.max(0, Number(durationMs) || 0) / 1000))} 秒`
}
