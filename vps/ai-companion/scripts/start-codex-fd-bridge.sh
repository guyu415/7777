#!/usr/bin/env bash
set -euo pipefail

RUNTIME_FILE="${AI_COMPANION_CODEX_ADOPT_FILE:-/run/ai-companion-codex/adopt.env}"
if [ ! -r "$RUNTIME_FILE" ]; then
  echo "missing one-shot Codex adoption file: $RUNTIME_FILE" >&2
  exit 1
fi

source "$RUNTIME_FILE"
: "${CODEX_PARENT_PID:?}"
: "${CODEX_STDIN_FD:?}"
: "${CODEX_STDOUT_FD:?}"
: "${CODEX_STDERR_FD:?}"
: "${CODEX_BRIDGE_SOCKET:?}"

exec /opt/ai-companion/scripts/codex-fd-bridge adopt \
  "$CODEX_PARENT_PID" "$CODEX_STDIN_FD" "$CODEX_STDOUT_FD" "$CODEX_STDERR_FD" "$CODEX_BRIDGE_SOCKET"
