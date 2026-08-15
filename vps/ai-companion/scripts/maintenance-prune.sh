#!/usr/bin/env bash
# Scheduled transcript maintenance. Called by watchdog.sh on its normal 60s
# tick; does nothing at all unless every gate below is satisfied.
#
# Why it must restart the brain: the live claude process holds the transcript
# open and appends to it continuously. Rewriting that file underneath it would
# corrupt the very session the pruning exists to preserve. So the only safe
# order is stop -> prune -> resume, which costs one restart. That restart is
# cheap (brain-loop.sh resumes the same session id and announces itself), so
# this runs whenever the gates below say the transcript is big enough and
# nobody's mid-conversation — no time-of-day restriction.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

MAINT_LOG="${PROJECT_DIR}/logs/maintenance.log"
LAST_RUN_FILE="${PROJECT_DIR}/state/last-prune"
HISTORY_FILE="${PROJECT_DIR}/state/chat-history.json"
FOCUS_FILE="${PROJECT_DIR}/state/focus.json"

# Gates. Overridable ONLY so the gate logic can be exercised on demand — this
# path would otherwise sit unrun for months and first execute unattended, in
# the middle of the night, against the one file that must not be lost.
#   MAINT_DRY_RUN=1 prints the decision and stops before touching anything.
THRESHOLD_BYTES=${MAINT_THRESHOLD_BYTES:-$((5 * 1024 * 1024))}
IDLE_SECONDS=${MAINT_IDLE_SECONDS:-1800}
MIN_INTERVAL=${MAINT_MIN_INTERVAL:-$((24 * 60 * 60))}
# Urgent path. A context window that is filling up does not wait, and once
# it is full the session compacts and loses detail permanently. So a high
# enough live context reading shortens the other gates — nothing overrides
# "someone is mid-conversation", that's still the one real gate below.
# Start cleanup comfortably before the 70% tidal-summary threshold. Cleanup
# gets first chance at 60%; if it has nothing actionable, it exits without a
# restart and the tide remains the authoritative fallback at 70%.
CTX_URGENT_PCT=${MAINT_CTX_URGENT_PCT:-60}
URGENT_IDLE_SECONDS=${MAINT_URGENT_IDLE_SECONDS:-300}
# A fresh pre-restart context reading must not trigger another maintenance
# cycle as soon as the service comes back. Keep at least an hour between
# disruptive passes; the normal tidal summary remains the pressure fallback.
URGENT_MIN_INTERVAL=${MAINT_URGENT_MIN_INTERVAL:-$((60 * 60))}
URGENT_THRESHOLD_BYTES=${MAINT_URGENT_THRESHOLD_BYTES:-$((2 * 1024 * 1024))}
STATUS_FILE="${PROJECT_DIR}/state/status.json"
# A stale reading is worse than none — it could trigger a restart on a number
# from hours ago. statusLine rewrites this every turn (see hook-notify.sh).
STATUS_MAX_AGE=${MAINT_STATUS_MAX_AGE:-1800}
DRY_RUN=${MAINT_DRY_RUN:-0}
gate_fail() { [ "$DRY_RUN" = "1" ] && echo "SKIP: $1"; exit 0; }

mkdir -p "$(dirname "$MAINT_LOG")"
now=$(date +%s)

session_id="$(cat "$BRAIN_SESSION_ID_FILE" 2>/dev/null | tr -d '[:space:]')"
[ -n "$session_id" ] || gate_fail "no session id on record"
transcript="${TRANSCRIPT_DIR}/${session_id}.jsonl"
[ -s "$transcript" ] || gate_fail "no transcript at ${transcript}"

# Live context-window reading, if one was captured recently enough to trust.
ctx_pct=0
if [ -s "$STATUS_FILE" ]; then
  ctx_pct=$(bun -e '
    try {
      const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
      const age = (Date.now() - (s.capturedAt ?? 0)) / 1000
      const pct = s?.context_window?.used_percentage
      console.log(age <= Number(process.argv[2]) && typeof pct === "number" ? Math.round(pct) : 0)
    } catch { console.log(0) }
  ' "$STATUS_FILE" "$STATUS_MAX_AGE" 2>/dev/null || echo 0)
  ctx_pct=${ctx_pct:-0}
fi

urgent=0
if [ "$ctx_pct" -ge "$CTX_URGENT_PCT" ]; then
  urgent=1
  THRESHOLD_BYTES="$URGENT_THRESHOLD_BYTES"
  MIN_INTERVAL="$URGENT_MIN_INTERVAL"
  IDLE_SECONDS="$URGENT_IDLE_SECONDS"
fi

# Gate 1 — actionable content. File size alone is not a reason to restart:
# sidechains and already-compact dialogue can make JSONL large without giving
# the rewriter anything useful to reclaim.
bytes=$(stat -c %s "$transcript" 2>/dev/null || echo 0)
actionable=0
if HOME=/home/companion bun "${SCRIPT_DIR}/prune-transcript.ts" --check-actionable >/dev/null 2>&1; then
  actionable=1
fi
[ "$actionable" -eq 1 ] || gate_fail "no actionable transcript results (transcript ${bytes}B, ctx ${ctx_pct}%)"

# No quiet-hours gate — tool-call-heavy days fill the transcript up just as
# fast in daylight as overnight, and a resumed restart is a few-second blip
# (session id + transcript carry over, see brain-loop.sh), not a real
# interruption. The gates that actually protect the user are below: don't
# run too often, and never run mid-conversation.

# Gate 2 — not too soon after the last one.
last_run=$(cat "$LAST_RUN_FILE" 2>/dev/null | tr -d '[:space:]')
if [ -n "$last_run" ] && [ $((now - last_run)) -lt "$MIN_INTERVAL" ]; then gate_fail "last prune $((now - last_run))s ago < ${MIN_INTERVAL}s"; fi

# Gate 3 — nobody is mid-conversation. Uses the last message's own timestamp
# rather than file mtime, which other writes to this file would disturb.
# A Focus interaction intentionally does not enter main chat history, so the
# history-only gate used to declare the service idle seconds after answering
# on the Focus screen. Never restart the resident brain while a Pomodoro is
# active (running OR paused): the user is still relying on its manager and a
if [ -s "$FOCUS_FILE" ]; then
  focus_active=$(bun -e '
    try {
      const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
      console.log(s?.active === true ? 1 : 0)
    } catch { console.log(0) }
  ' "$FOCUS_FILE" 2>/dev/null || echo 0)
  [ "${focus_active:-0}" -eq 0 ] || gate_fail "focus session is active"
fi

if [ -s "$HISTORY_FILE" ]; then
  last_msg_ms=$(bun -e '
    try {
      const h = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))
      const last = Array.isArray(h) && h.length ? h[h.length - 1] : null
      console.log(last && typeof last.ts === "number" ? last.ts : 0)
    } catch { console.log(0) }
  ' "$HISTORY_FILE" 2>/dev/null || echo 0)
  last_msg=$(( ${last_msg_ms:-0} / 1000 ))
  if [ "$last_msg" -gt 0 ] && [ $((now - last_msg)) -lt "$IDLE_SECONDS" ]; then gate_fail "last message $((now - last_msg))s ago < idle ${IDLE_SECONDS}s"; fi
fi

if [ "$DRY_RUN" = "1" ]; then echo "PASS: all gates satisfied (ctx ${ctx_pct}%, urgent=${urgent}) — would stop brain, prune, restart"; exit 0; fi

echo "[$(date -Iseconds)] gates passed (transcript ${bytes}B, ctx ${ctx_pct}%, urgent=${urgent}), starting maintenance" >> "$MAINT_LOG"
printf '%s\n' "$now" > "$LAST_RUN_FILE"

# Stop first — see the header comment on why pruning a live transcript is not
# an option. brain-loop.sh dies with the tmux session, so nothing respawns
# claude behind our back while the file is being rewritten.
"${SCRIPT_DIR}/stop-brain.sh"
sleep 3

if bun "${SCRIPT_DIR}/prune-transcript.ts" --apply >> "$MAINT_LOG" 2>&1; then
  echo "[$(date -Iseconds)] prune ok, new size $(stat -c %s "$transcript" 2>/dev/null)B" >> "$MAINT_LOG"
else
  echo "[$(date -Iseconds)] prune FAILED — restoring is manual, see backups/transcripts" >> "$MAINT_LOG"
fi

# Always bring the brain back, prune succeeded or not. A failed prune leaves
# the transcript untouched (the script backs up and swaps only on success),
# so resuming is still the right move.
"${SCRIPT_DIR}/start-brain.sh"
echo "[$(date -Iseconds)] brain restarted after maintenance" >> "$MAINT_LOG"
