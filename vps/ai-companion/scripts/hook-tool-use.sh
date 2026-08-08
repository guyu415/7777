#!/usr/bin/env bash
# Claude Code PreToolUse hook -> channel-server's internal /internal/tool-use.
# Gives the user a live view of what the companion is actually DOING during a
# turn, not just what it is thinking — until now the frontend could only show
# the reasoning stream, so any turn spent reading files or running commands
# looked like a long silence.
#
# Runs before EVERY tool call, so it must be cheap and must never fail the
# tool: no output that could resemble hook control JSON, always exit 0, and a
# hard timeout on the POST.
#
# Same AI_COMPANION_BRAIN gate as hook-notify.sh — hooks here are registered
# project-wide, so a hand-started admin session in this directory would
# otherwise stream ITS tool calls into the user's chat window.
set -u

if [ "${AI_COMPANION_BRAIN:-}" != "1" ]; then
  exit 0
fi

PORT="${AI_COMPANION_INTERNAL_PORT:-8789}"
SECRET_FILE="${AI_COMPANION_INTERNAL_SECRET_FILE:-/opt/ai-companion/config/internal.secret}"
SECRET="$(cat "$SECRET_FILE" 2>/dev/null)"
[ -n "$SECRET" ] || exit 0

INPUT="$(cat)"

# One representative detail per tool rather than the whole input blob: the
# path being read, the command being run, the pattern being searched. Long
# values are cut here rather than in the frontend so nothing oversized ever
# crosses the wire. Paths are shown basename-only — the user knows their own
# project, and the full VPS path is noise in a chat bubble.
BODY="$(printf '%s' "$INPUT" | jq -c '
  def clip($n): if (. | length) > $n then (.[0:$n] + "…") else . end;
  def base: if test("/") then (split("/") | last) else . end;
  {
    tool: (.tool_name // "unknown"),
    detail: (
      (.tool_input // {}) as $i
      | if $i.file_path then ($i.file_path | tostring | base)
        elif $i.command then ($i.command | tostring | clip(80))
        elif $i.pattern then ($i.pattern | tostring | clip(60))
        elif $i.url then ($i.url | tostring | clip(80))
        elif $i.query then ($i.query | tostring | clip(60))
        elif $i.description then ($i.description | tostring | clip(60))
        else "" end
    )
  }' 2>/dev/null)"

[ -n "$BODY" ] || exit 0

curl -fsS --max-time 2 -X POST "http://127.0.0.1:${PORT}/internal/tool-use" \
  -H "X-Internal-Secret: ${SECRET}" -H "Content-Type: application/json" \
  -d "$BODY" >/dev/null 2>&1 || true

exit 0
