#!/usr/bin/env bash
# Triggered by ai-companion-thinking-flush.timer, every 10 minutes. All the
# real gating (busy turn, reset already in flight, a real tidal run in
# progress, no completed summary yet to anchor to, ctx% not grown enough
# since the last flush) lives server-side in checkThinkingFlush() —
# see /internal/thinking-flush-check in channel-server.ts. This script is
# just the cheap poll.
set -u

PORT="${AI_COMPANION_INTERNAL_PORT:-8789}"
SECRET_FILE="${AI_COMPANION_INTERNAL_SECRET_FILE:-/opt/ai-companion/config/internal.secret}"
BRAIN_LOG="/opt/ai-companion/logs/brain.log"

SECRET="$(cat "$SECRET_FILE" 2>/dev/null)"
[ -z "$SECRET" ] && exit 0

RESULT="$(curl -fsS --max-time 30 -X POST "http://127.0.0.1:${PORT}/internal/thinking-flush-check" \
  -H "X-Internal-Secret: ${SECRET}" -H "Content-Type: application/json" \
  -d '{}' 2>&1)"

# Routine "not due yet" polls (below_threshold, baseline_primed, no summary
# yet) are the overwhelming majority of ticks at 10-minute resolution — don't
# let them dominate brain.log. Anything else (a real fire, a skip worth
# knowing about, an error) still gets logged.
case "$RESULT" in
  *'"skipped":"below_threshold"'*|*'"skipped":"baseline_primed"'*|*'"skipped":"no_completed_summary_yet"'*|*'"skipped":"turn_in_progress"'*)
    ;;
  *)
    echo "[$(date -Iseconds)] thinking-flush-check: ${RESULT}" >> "$BRAIN_LOG"
    ;;
esac
