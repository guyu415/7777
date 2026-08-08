#!/usr/bin/env bash
# Restart only the Codex app-server child through channel-server's internal
# control API. This never restarts ai-companion-brain.service, Claude, tmux,
# or the CC window. By default an active Codex turn is rejected; pass
# --force only after explicitly warning that the Codex window will be cut off.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/env.sh"

force=false
if [[ $# -gt 0 ]]; then
  case "$1" in
    --force) force=true ;;
    *)
      echo "usage: $0 [--force]" >&2
      exit 2
      ;;
  esac
fi

secret="$(<"$PROJECT_DIR/config/internal.secret")"
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

http_code="$(curl --silent --show-error --max-time 15 \
  --output "$response_file" --write-out '%{http_code}' \
  -X POST "http://127.0.0.1:8789/internal/codex/restart" \
  -H "X-Internal-Secret: $secret" \
  -H 'Content-Type: application/json' \
  --data "{\"force\":$force}")"

cat "$response_file"
echo
if [[ "$http_code" != "200" ]]; then
  echo "Codex restart request failed (HTTP $http_code); CC was not restarted." >&2
  exit 1
fi
