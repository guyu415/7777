#!/usr/bin/env bash
# Idempotent: ensures the detached tmux brain session exists. Safe to call
# repeatedly (systemd boot unit, watchdog, manual admin) without spawning
# duplicate sessions or burning extra subscription-billed claude instances.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

if tmux has-session -t "$SESSION" 2>/dev/null; then
  echo "[$(date -Iseconds)] session ${SESSION} already running" >> "$BRAIN_LOG"
  exit 0
fi

mkdir -p "$(dirname "$BRAIN_LOG")"
chmod +x "${SCRIPT_DIR}/brain-loop.sh" "${SCRIPT_DIR}/dialog-guard.sh"
tmux new-session -d -s "$SESSION" -x 220 -y 50 -n brain "${SCRIPT_DIR}/brain-loop.sh"
tmux new-window -d -t "$SESSION" -n guard "${SCRIPT_DIR}/dialog-guard.sh"
echo "[$(date -Iseconds)] started session ${SESSION} (brain + guard windows)" >> "$BRAIN_LOG"

# Record the tmux SERVER's own pid (not a pane/client pid) so crash-watch.sh
# can poll it directly. Nothing else in this stack ever wait()s on the
# server itself — it's an orphan reparented to PID 1 the instant this
# script exits — so this pidfile is the only way anything can even notice
# the moment it dies, let alone try to explain why.
sleep 0.3
srv_pid="$(pgrep -u companion -x tmux | head -1)"
if [ -n "$srv_pid" ]; then
  printf '%s\n' "$srv_pid" > "${PROJECT_DIR}/state/tmux-server.pid"
fi
