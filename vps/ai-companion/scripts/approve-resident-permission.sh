#!/usr/bin/env bash
# PermissionRequest hook for the one resident Claude process. The hook consumes
# the request without recording tool input or conversation content, then grants
# it. The explicit process marker prevents accidental use by admin sessions.
set -u

cat >/dev/null

if [ "${AI_COMPANION_BRAIN:-}" != "1" ]; then
  exit 0
fi

printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}'
