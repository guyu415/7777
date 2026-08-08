#!/usr/bin/env bash
# Runs in a second tmux window alongside the brain-loop. Every claude launch
# (including automatic respawns after a crash) shows a one-time-per-process
# "WARNING: Loading development channels" confirmation because this build has
# no persistent bypass for --dangerously-load-development-channels (unlike the
# workspace-trust and bypass-permissions disclaimers, which we pre-accept via
# ~/.claude.json once). Left unanswered, this would hang every crash-recovery
# forever. This watcher ONLY answers that one known, narrowly-matched dialog
# about our own plugin (server:ai-companion) — nothing else — by pressing
# Enter on its pre-selected default option ("I am using this for local
# development"). It never touches any other prompt, including real tool
# permission prompts.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

MARKER="WARNING: Loading development channels"

# Claude Code's own "Auto" model mode can decide mid-session to switch model
# and — unlike its normal silent switches (logged as ordinary /model lines in
# history.jsonl, see project memory on the "谁在切模型" investigation) —
# sometimes surfaces this as a real interactive confirmation dialog instead.
# On an unattended resident session nobody is watching the terminal to answer
# it, so it just sits there — confirmed live 2026-08-05: this blocked the
# WHOLE session (every message turn_busy-rejected) for ~10 minutes until
# someone happened to notice and send a keypress by hand. brain-loop.sh
# already launches with an explicit --model, so a mid-session prompt trying
# to move away from that is Auto second-guessing an explicit operator choice
# — always decline (option 2, "No, go back") to preserve it, never let this
# hang again.
MODEL_SWITCH_MARKER="Switch model?"
MODEL_SWITCH_MARKER2="No, go back"

while true; do
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    pane="$(tmux capture-pane -t "${SESSION}.0" -p 2>/dev/null || true)"
    if [[ "$pane" == *"$MARKER"* ]]; then
      tmux send-keys -t "${SESSION}.0" "" Enter
      echo "[$(date -Iseconds)] auto-confirmed dev-channels dialog" >> "$BRAIN_LOG"
      sleep 10
    elif [[ "$pane" == *"$MODEL_SWITCH_MARKER"* && "$pane" == *"$MODEL_SWITCH_MARKER2"* ]]; then
      tmux send-keys -t "${SESSION}.0" "2" Enter
      echo "[$(date -Iseconds)] auto-declined model-switch dialog (kept configured model)" >> "$BRAIN_LOG"
      sleep 10
    fi
  fi
  sleep 2
done
