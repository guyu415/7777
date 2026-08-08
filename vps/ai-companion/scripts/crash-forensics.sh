#!/usr/bin/env bash
# Root-run forensics dump, fired by crash-watch.sh the moment the tmux
# server's pid disappears without a preceding stop-brain.sh marker.
#
# Why this has to be root: companion (uid 1001, no sudo) cannot read dmesg
# (kernel.dmesg_restrict=1) or journalctl -k (not in adm/systemd-journal) —
# confirmed 2026-08-06 while investigating a live 502. Every other script in
# this project runs as companion, so none of them could ever have seen
# kernel-level OOM evidence even if it existed. This is the one piece that
# can, which is the actual gap the 2026-08-05 and 2026-08-06 incidents both
# hit: root cause stayed "unproven" partly because nothing had the
# privilege to look.
set -u
PROJECT_DIR="/opt/ai-companion"
STATE_DIR="${PROJECT_DIR}/state"
LOG="${PROJECT_DIR}/logs/crash-forensics.log"
BRAIN_LOG="${PROJECT_DIR}/logs/brain.log"
mkdir -p "$(dirname "$LOG")"
ts="$(date -Iseconds)"

now_oom="$(awk '/^oom_kill /{print $2}' /proc/vmstat)"
baseline_oom="$(cat "${STATE_DIR}/oom-kill-baseline" 2>/dev/null || echo 0)"
if [ "${now_oom:-0}" -gt "${baseline_oom:-0}" ]; then
  verdict="OOM KILLER FIRED (global oom_kill counter ${baseline_oom} -> ${now_oom})"
else
  verdict="no kernel OOM kill detected (oom_kill counter unchanged at ${baseline_oom}) — likely a crash/signal, not memory exhaustion"
fi

{
  echo "===== CRASH DETECTED ${ts} ====="
  echo "-- verdict: ${verdict}"
  echo
  echo "-- last known-good snapshot (captured shortly BEFORE this crash):"
  cat "${STATE_DIR}/last-good-snapshot.log" 2>/dev/null || echo "  (none captured yet)"
  echo
  echo "-- free -h (AFTER crash, memory may already be reclaimed):"
  free -h
  echo
  echo "-- ps aux top 15 by mem (AFTER crash):"
  ps aux --sort=-%mem | head -16
  echo
  echo "-- dmesg tail (last 100 lines):"
  dmesg -T 2>&1 | tail -100
  echo
  echo "-- journalctl -k, last 5min:"
  journalctl -k -S "-5min" --no-pager 2>&1
  echo
  echo "-- journalctl (all units), last 5min, filtered tmux|claude|bun|oom|killed|segfault:"
  journalctl -S "-5min" --no-pager 2>&1 | grep -iE "tmux|claude|bun|oom|killed|segfault" || echo "  (no matches)"
  echo
  echo "===== end ====="
  echo
} >> "$LOG"

echo "[$ts] CRASH: tmux server died — ${verdict} — see logs/crash-forensics.log" >> "$BRAIN_LOG"
