#!/usr/bin/env bash
# Tight-interval (3s) root-run supervisor for the tmux SERVER process
# itself — the one thing in this stack nothing ever wait()s on. It's an
# orphan reparented to PID 1 the instant start-brain.sh exits, so no exit
# code has ever been observable for it; this is the closest thing to one.
#
# start-brain.sh (runs as companion) writes the server's pid to
# state/tmux-server.pid on every (re)spawn. This loop polls that pid; the
# moment it goes from alive to gone WITHOUT a fresh state/brain-stop-requested
# marker (written by stop-brain.sh right before intentional kills — routine
# maintenance-prune restarts go through there), it fires crash-forensics.sh.
#
# Runs as root specifically because companion cannot read dmesg or
# journalctl -k on this box (see crash-forensics.sh header) — this service
# is the only privilege boundary crossed here, and it only ever reads.
set -u
PROJECT_DIR="/opt/ai-companion"
STATE_DIR="${PROJECT_DIR}/state"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="${STATE_DIR}/tmux-server.pid"
SNAPSHOT="${STATE_DIR}/last-good-snapshot.log"
STOP_MARKER="${STATE_DIR}/brain-stop-requested"
LOG="${PROJECT_DIR}/logs/crash-watch.log"
mkdir -p "$STATE_DIR" "$(dirname "$LOG")"

echo "[$(date -Iseconds)] crash-watch starting" >> "$LOG"

# Baseline the global oom_kill counter at startup so a kill from before this
# watcher last (re)started never gets misattributed to the next crash.
awk '/^oom_kill /{print $2}' /proc/vmstat > "${STATE_DIR}/oom-kill-baseline" 2>/dev/null || true

was_alive=0
last_pid=""

while true; do
  pid="$(cat "$PIDFILE" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    was_alive=1
    last_pid="$pid"
    { echo "$(date -Iseconds) pid=${pid}"; free -h | sed -n '1,2p'; ps aux --sort=-%mem | head -6; } > "$SNAPSHOT" 2>/dev/null
  else
    if [ "$was_alive" = "1" ]; then
      stop_ts="$(cat "$STOP_MARKER" 2>/dev/null || echo 0)"
      now_ts="$(date +%s)"
      if [ -n "$stop_ts" ] && [ $(( now_ts - stop_ts )) -le 20 ]; then
        echo "[$(date -Iseconds)] tmux server (pid ${last_pid}) gone — planned stop (marker $(( now_ts - stop_ts ))s old), skipping forensics" >> "$LOG"
      else
        echo "[$(date -Iseconds)] tmux server (pid ${last_pid}) gone WITHOUT a stop marker — firing crash-forensics.sh" >> "$LOG"
        "${SCRIPT_DIR}/crash-forensics.sh"
      fi
      # Reset the oom baseline right after handling this transition so the
      # next crash window starts clean.
      awk '/^oom_kill /{print $2}' /proc/vmstat > "${STATE_DIR}/oom-kill-baseline" 2>/dev/null || true
    fi
    was_alive=0
  fi
  sleep 3
done
