#!/usr/bin/env bash
# Claude Code Stop/StopFailure hook -> POST to channel-server.ts's INTERNAL
# turn-lifecycle endpoints (127.0.0.1:8789 — never forwarded by cloudflared).
#
# Gated on AI_COMPANION_BRAIN=1, set only by brain-loop.sh right before it
# launches the production claude session. This project directory's hooks are
# registered at the project level (.claude/settings.json), so any OTHER claude
# session started here too — e.g. an admin/maintenance session someone opens
# by hand to poke around — would fire the same Stop/StopFailure hooks. Without
# this check, that unrelated session's turns would corrupt the production
# turn-lifecycle state. First line of real logic, before touching anything else.
#
# Must exit fast and print nothing meaningful to stdout (anything resembling
# hook control JSON there could block the turn from ending).
set -u

if [ "${AI_COMPANION_BRAIN:-}" != "1" ]; then
  exit 0
fi

PORT="${AI_COMPANION_INTERNAL_PORT:-8789}"
SECRET_FILE="${AI_COMPANION_INTERNAL_SECRET_FILE:-/opt/ai-companion/config/internal.secret}"
SECRET="$(cat "$SECRET_FILE" 2>/dev/null)"
TMUX_SESSION="${AI_COMPANION_TMUX_SESSION:-ai-companion-cc-1}"

INPUT="$(cat)"
EVENT="$(printf '%s' "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null)"

if [ -z "$SECRET" ]; then
  exit 0
fi

# Forces one fresh statusLine re-invocation right as this turn ends, instead
# of trusting ink's own redraw scheduling to happen to fire again soon
# (verified empirically: on a detached/unattended tmux pane, statusLine can
# go many turns without re-firing once idle — it only reliably redraws while
# actively animating a live turn, which can end a fraction of a second
# before the FINAL usage numbers for that same turn are settled). Ctrl-L is
# a standard "redraw screen" keystroke that every terminal UI treats as a
# harmless repaint request, never as real input — confirmed live (does not
# submit/alter anything, only triggers a real statusLine re-run reporting
# genuinely fresh rate_limits). This is what makes "完成一轮 CC 回复后必须
# 刷新状态文件" a guarantee instead of a lucky coincidence. Best-effort: a
# failed tmux call here must never block/fail the turn-lifecycle POST below.
tmux send-keys -t "${TMUX_SESSION}.0" C-l >/dev/null 2>&1 || true

case "$EVENT" in
  Stop)
    curl -fsS --max-time 5 -X POST "http://127.0.0.1:${PORT}/internal/turn-end" \
      -H "X-Internal-Secret: ${SECRET}" -H "Content-Type: application/json" \
      -d '{}' >/dev/null 2>&1 || true
    ;;
  StopFailure)
    ERROR="$(printf '%s' "$INPUT" | jq -r '.error // "unknown"' 2>/dev/null)"
    BODY="$(jq -nc --arg err "$ERROR" '{error:$err}')"
    curl -fsS --max-time 5 -X POST "http://127.0.0.1:${PORT}/internal/turn-error" \
      -H "X-Internal-Secret: ${SECRET}" -H "Content-Type: application/json" \
      -d "$BODY" >/dev/null 2>&1 || true
    ;;
esac

exit 0
