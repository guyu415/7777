#!/bin/bash
# PreCompact hook target (matcher: "auto" only — see .claude/settings.json).
# Fires right before Claude Code's own native auto-compact runs, while the
# full pre-compaction transcript is still intact. Reads the hook's JSON off
# stdin for transcript_path (the precise file to extract from — do not
# resolve the "current" session ourselves here, the hook already tells us
# exactly which transcript is about to be compacted).
#
# Must return fast and never block compaction: the actual extract+compress
# work (several SiliconFlow API calls, tens of seconds) runs as a detached
# background job. A simple PID lock file guards against two overlapping runs
# if auto-compact fires again before the previous run finished.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN="/home/companion/.bun/bin/bun"
LOG="/opt/ai-companion/compression/pre-compact.log"
LOCK="/opt/ai-companion/compression/.compressing.lock"

mkdir -p "$(dirname "$LOG")"

hook_input="$(cat)"
transcript_path="$(printf '%s' "$hook_input" | "$BUN" -e '
  try {
    const d = JSON.parse(require("fs").readFileSync(0, "utf8"))
    process.stdout.write(d.transcript_path || "")
  } catch {}
')"

if [ -z "$transcript_path" ]; then
  echo "[$(date -Iseconds)] PreCompact fired but no transcript_path in hook input, skipping" >> "$LOG"
  exit 0
fi

if [ -f "$LOCK" ]; then
  lock_pid="$(cat "$LOCK" 2>/dev/null | tr -d '[:space:]')"
  if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
    echo "[$(date -Iseconds)] PreCompact fired but a compression run (pid $lock_pid) is already in progress, skipping" >> "$LOG"
    exit 0
  fi
  rm -f "$LOCK"
fi

(
  echo "[$(date -Iseconds)] PreCompact auto-compact detected, transcript=$transcript_path" >> "$LOG"
  "$BUN" run "${SCRIPT_DIR}/extract-dialogue.mjs" "$transcript_path" >> "$LOG" 2>&1
  "$BUN" run "${SCRIPT_DIR}/compress-dialogue.mjs" >> "$LOG" 2>&1
  echo "[$(date -Iseconds)] compression run done" >> "$LOG"
  rm -f "$LOCK"
) < /dev/null > /dev/null 2>&1 &
bg_pid=$!
# Written synchronously in the foreground, right after backgrounding — the
# lock must exist before this script returns, not whenever the subshell
# happens to get scheduled, or two PreCompact firings close together race
# past the lock check above.
echo "$bg_pid" > "$LOCK"
disown

exit 0
