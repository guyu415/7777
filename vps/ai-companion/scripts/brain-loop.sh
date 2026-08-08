#!/usr/bin/env bash
# Runs *inside* the detached tmux pane. Keeps the interactive claude session
# alive: if it exits (crash, /clear-induced exit, OOM, etc.) it is respawned
# after a short backoff. This is the innermost layer of the self-heal stack.
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$(dirname "$BRAIN_LOG")" "$(dirname "$BRAIN_SESSION_ID_FILE")"

newuuid() {
  if command -v uuidgen >/dev/null 2>&1; then uuidgen | tr 'A-Z' 'a-z'
  else cat /proc/sys/kernel/random/uuid; fi
}

# The brain has exactly ONE long-lived session id, persisted here. Every
# respawn resumes it, so a restart is a blink rather than amnesia. It is only
# ever rotated when resuming genuinely fails (see the early-death check below).
session_id="$(cat "$BRAIN_SESSION_ID_FILE" 2>/dev/null | tr -d '[:space:]')"
if [ -z "$session_id" ]; then
  session_id="$(newuuid)"
  printf '%s\n' "$session_id" > "$BRAIN_SESSION_ID_FILE"
  echo "[$(date -Iseconds)] no session id on record, minted ${session_id}" >> "$BRAIN_LOG"
fi

attempt=0
while true; do
  attempt=$((attempt + 1))

  # A transcript that exists and is non-empty is the only evidence that this
  # session id is resumable. Anything else means we're starting a life, not
  # continuing one — and we say so rather than guessing.
  transcript="${TRANSCRIPT_DIR}/${session_id}.jsonl"
  if [ -s "$transcript" ]; then
    mode="resumed"
    session_args=(--resume "$session_id")
    bytes=$(stat -c %s "$transcript" 2>/dev/null || echo 0)
    # No --model here — a resume should pick up whatever model was actually
    # in use in that conversation (its own /model or Auto-mode state), not
    # get force-reset to the fresh-session default every single restart.
    # Confirmed live 2026-08-05: forcing opus-5 on every launch (even a
    # resume that had drifted to opus-4-6) put every restart at odds with
    # Claude Code's own Auto mode, which would then try to switch back —
    # sometimes via a blocking interactive dialog nobody was there to answer
    # (see dialog-guard.sh's model-switch guard, added same day as a
    # second-layer fix; this is the root-cause fix).
    model_args=()
  else
    mode="fresh"
    session_args=(--session-id "$session_id")
    bytes=0
    model_args=(--model claude-opus-5)
  fi

  # channel-server.ts reads this on boot and tells the user which kind of
  # session just came up. `announced:false` is the flag it flips once it has;
  # written before the spawn so it is always in place by the time the MCP
  # server starts as this process's child.
  printf '{"mode":"%s","sessionId":"%s","transcriptBytes":%s,"attempt":%s,"ts":%s,"announced":false}\n' \
    "$mode" "$session_id" "$bytes" "$attempt" "$(date +%s000)" > "$SESSION_MODE_FILE"

  echo "[$(date -Iseconds)] starting claude (attempt ${attempt}, mode=${mode}, session=${session_id}, transcript=${bytes}B)" >> "$BRAIN_LOG"

  # Marks this specific claude process as *the* production brain session, so
  # hook-notify.sh (fired by this project's Stop/StopFailure hooks) knows to
  # act. Any other claude session started in this same directory by hand
  # (admin/maintenance) will NOT have this set and its hook firings are inert.
  export AI_COMPANION_BRAIN=1

  started=$(date +%s)
  claude \
    "${session_args[@]}" \
    "${model_args[@]}" \
    --mcp-config "${PROJECT_DIR}/mcp-config.json" \
    --strict-mcp-config \
    --dangerously-load-development-channels server:ai-companion \
    --permission-mode bypassPermissions \
    --autocompact 1000000 \
    --debug-file "${PROJECT_DIR}/logs/claude-debug.log"

  code=$?
  elapsed=$(( $(date +%s) - started ))
  echo "[$(date -Iseconds)] claude exited with code ${code} after ${elapsed}s (mode=${mode})" >> "$BRAIN_LOG"

  # Resume that dies almost immediately means the transcript is unusable
  # (corrupt, truncated, too large to load). Retrying it forever would be a
  # crash loop with no companion at all, so rotate to a new id — losing the
  # context is bad, being permanently down is worse.
  if [ "$mode" = "resumed" ] && [ "$code" -ne 0 ] && [ "$elapsed" -lt 20 ]; then
    old="$session_id"
    session_id="$(newuuid)"
    printf '%s\n' "$session_id" > "$BRAIN_SESSION_ID_FILE"
    echo "[$(date -Iseconds)] resume of ${old} died in ${elapsed}s (code ${code}); rotated to ${session_id}" >> "$BRAIN_LOG"
  fi

  sleep 5
done
