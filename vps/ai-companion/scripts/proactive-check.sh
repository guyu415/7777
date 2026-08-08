#!/usr/bin/env bash
# Triggered by ai-companion-proactive.timer, now a cheap 5-minute POLL — not
# the real cadence. The real "when to actually check in" decision is made by
# the model itself each time (schedule_next_proactive tool in channel-server.ts,
# persisted to state/proactive-schedule.json) and enforced server-side in
# /internal/proactive-inject, which returns skipped:"not_due" on most ticks.
#
# Checks the proactive-message master switch FIRST, directly from disk (same
# machine, same user, no HTTP round-trip needed) — if it's off, exits
# immediately without touching the live Claude session at all. Zero cost.
set -u
CONFIG_FILE="/opt/ai-companion/config/proactive.json"
BRAIN_LOG="/opt/ai-companion/logs/brain.log"

ENABLED="$(jq -r '.enabled // false' "$CONFIG_FILE" 2>/dev/null)"
if [ "$ENABLED" != "true" ]; then
  exit 0
fi

PORT="${AI_COMPANION_INTERNAL_PORT:-8789}"
SECRET_FILE="${AI_COMPANION_INTERNAL_SECRET_FILE:-/opt/ai-companion/config/internal.secret}"
SECRET="$(cat "$SECRET_FILE" 2>/dev/null)"
if [ -z "$SECRET" ]; then
  exit 0
fi

RESULT="$(curl -fsS --max-time 5 -X POST "http://127.0.0.1:${PORT}/internal/proactive-inject" \
  -H "X-Internal-Secret: ${SECRET}" -H "Content-Type: application/json" \
  -d '{}' 2>&1)"
# Skip the log line for a plain "not due yet" poll result — at 5-minute
# resolution that would otherwise dominate brain.log with noise. Anything
# else (a real fire, an error, a busy/reset skip) still gets logged.
if [[ "$RESULT" != *'"skipped":"not_due"'* ]]; then
  echo "[$(date -Iseconds)] proactive-check fired: ${RESULT}" >> "$BRAIN_LOG"
fi
