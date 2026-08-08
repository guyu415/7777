#!/usr/bin/env bash
# Official Claude Code statusLine command for the production brain session.
# Reads the official stdin JSON payload and writes ONLY a small, non-sensitive
# whitelist of fields (model, context_window, rate_limits) atomically to
# state/status.json, which channel-server.ts's /status endpoint serves to the
# frontend. Never SERVES cost/session_id/transcript_path/cwd to the frontend —
# those aren't needed there and shouldn't leave this machine.
#
# session_id IS written, but to a separate internal-only file
# (state/brain-session-id) — see the block below. This runs on every single
# turn, so it is the one place that reliably knows the live process's actual
# current session id in real time. brain-loop.sh trusts that file blindly to
# decide what to `--resume` on its NEXT start — before this fix, nothing kept
# it in sync with reality: an in-session `/clear` (real root cause of the
# 2026-08-05 evening incident — see project memory) genuinely starts a brand
# new internal session/transcript, but with no code anywhere updating this
# file, the OLD (pre-clear) session id just sat there stale. The next restart
# for ANY reason (crash, watchdog, maintenance-prune, a manual deploy restart)
# would then resume the stale pre-clear transcript, silently reverting the
# clear and abandoning everything said since — exactly what happened. Writing
# the real session_id here every turn closes this for good, for /clear and
# for any other future session-changing event we haven't thought of yet.
#
# Gated on AI_COMPANION_BRAIN=1 (same convention as hook-notify.sh) so an
# ad-hoc admin `claude` session started by hand — which shares this same
# user-level statusLine config — never overwrites the production status file
# (or the production session-id tracking) with its own unrelated session data.
set -u
STATE_DIR="/opt/ai-companion/state"
STATUS_FILE="${STATE_DIR}/status.json"
TMP_FILE="${STATUS_FILE}.tmp.$$"
SESSION_ID_FILE="${STATE_DIR}/brain-session-id"

INPUT="$(cat)"

if [ "${AI_COMPANION_BRAIN:-}" != "1" ]; then
  exit 0
fi

mkdir -p "$STATE_DIR"

printf '%s' "$INPUT" | jq -c '{
  model: .model,
  context_window: (.context_window | {used_percentage, remaining_percentage, context_window_size}),
  rate_limits: (.rate_limits | {five_hour, seven_day}),
  capturedAt: (now * 1000 | floor)
}' > "$TMP_FILE" 2>/dev/null && mv -f "$TMP_FILE" "$STATUS_FILE"
rm -f "$TMP_FILE" 2>/dev/null

LIVE_SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
if [ -n "$LIVE_SESSION_ID" ]; then
  CURRENT_RECORDED="$(cat "$SESSION_ID_FILE" 2>/dev/null | tr -d '[:space:]')"
  if [ "$LIVE_SESSION_ID" != "$CURRENT_RECORDED" ]; then
    SID_TMP="${SESSION_ID_FILE}.tmp.$$"
    printf '%s\n' "$LIVE_SESSION_ID" > "$SID_TMP" && mv -f "$SID_TMP" "$SESSION_ID_FILE"
    rm -f "$SID_TMP" 2>/dev/null
  fi
fi

# Minimal human-readable line, purely for anyone who attaches to the tmux
# session to eyeball — not read by anything else.
MODEL_NAME="$(printf '%s' "$INPUT" | jq -r '.model.display_name // "?"')"
FIVE_H="$(printf '%s' "$INPUT" | jq -r '.rate_limits.five_hour.used_percentage // "-"')"
WEEK="$(printf '%s' "$INPUT" | jq -r '.rate_limits.seven_day.used_percentage // "-"')"
printf '%s | 5h:%s%% wk:%s%%\n' "$MODEL_NAME" "$FIVE_H" "$WEEK"
