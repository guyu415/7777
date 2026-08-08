#!/usr/bin/env bash
# Runs every 60s via systemd timer (ai-companion-watchdog.timer). Two layers
# of self-heal: (1) brain session missing entirely -> start it; (2) session
# alive but /health not responding -> kill + restart it.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

mkdir -p "$(dirname "$WATCHDOG_LOG")"
ts="$(date -Iseconds)"

# 2026-08-05 incident: a maintenance-prune restart left the whole companion
# tmux SERVER gone (not just the session) for ~8 minutes — start-brain.sh
# kept getting called every tick and kept "succeeding" (tmux new-session
# didn't error), but brain-loop.sh never got far enough to log even its
# first line, 7 ticks in a row. No OOM-killer entry in dmesg/journal to
# explain it; best guess is memory pressure right as a freshly-pruned,
# still-large transcript got reloaded on a 2GB box. Root cause unproven —
# so this doesn't try to fix that, it just stops it from being SILENT and
# adds one extra recovery step in case a half-dead tmux server is the thing
# actually blocking a clean restart.
STREAK_FILE="${PROJECT_DIR}/state/session-missing-streak"
ESCALATE_AFTER=3

if ! tmux has-session -t "$SESSION" 2>/dev/null; then
  streak=$(( $(cat "$STREAK_FILE" 2>/dev/null || echo 0) + 1 ))
  printf '%s\n' "$streak" > "$STREAK_FILE"
  echo "[$ts] session missing, starting (streak ${streak})" >> "$WATCHDOG_LOG"
  if [ "$streak" -ge "$ESCALATE_AFTER" ]; then
    echo "[$ts] ALERT: session missing ${streak} checks in a row (~${streak}min) — mem: $(free -h | awk '/Mem:/{print $3"/"$2" used, "$7" avail"}'), tmux socket: $(ls -la /tmp/tmux-$(id -u)/default 2>&1 || echo 'absent')" >> "$WATCHDOG_LOG"
    # Clear any half-dead tmux server before retrying — cheap and idempotent;
    # if the server is truly gone this is a no-op, if it's wedged this is the
    # one thing a plain start-brain.sh retry can't do on its own.
    tmux kill-server 2>/dev/null || true
  fi
  "${SCRIPT_DIR}/start-brain.sh"
  exit 0
fi

rm -f "$STREAK_FILE"

if curl -fsS --max-time 5 "$HEALTH_URL" >/dev/null 2>&1; then
  echo "[$ts] ok" >> "$WATCHDOG_LOG"
else
  echo "[$ts] health check failed, restarting session" >> "$WATCHDOG_LOG"
  "${SCRIPT_DIR}/restart-brain.sh"
  exit 0
fi

# Piggybacks on this timer rather than owning a systemd unit. Returns
# immediately unless the transcript is genuinely too big AND nobody has
# spoken in a while — see the gates in the script itself (no time-of-day
# restriction as of 2026-08-05). Only reached on a healthy tick, so it can
# never compete with the self-heal path above.
"${SCRIPT_DIR}/maintenance-prune.sh" || true
