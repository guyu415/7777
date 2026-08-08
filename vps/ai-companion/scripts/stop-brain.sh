#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

# Marks this as a deliberate stop before the tmux server actually goes away
# (killing the last session on a server kills the server itself) — so
# crash-watch.sh, which polls the tmux server's pid every few seconds, can
# tell "we did this on purpose" from "it just vanished" and skip firing a
# false-alarm forensics dump on every routine maintenance-prune restart.
date +%s > "${PROJECT_DIR}/state/brain-stop-requested"
tmux kill-session -t "$SESSION" 2>/dev/null || true
echo "[$(date -Iseconds)] stopped session ${SESSION}" >> "$BRAIN_LOG"
