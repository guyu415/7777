#!/usr/bin/env bash
# Validate and reload channel-server.ts without restarting the resident Claude
# session. The stable channel-proxy owns MCP stdio and replays the handshake.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/env.sh"

PID_FILE="${PROJECT_DIR}/state/channel-proxy.pid"
STATUS_FILE="${PROJECT_DIR}/state/channel-proxy-status.json"
pid="$(cat "$PID_FILE" 2>/dev/null | tr -d '[:space:]')"
if [[ ! "$pid" =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
  echo "channel proxy is not running; one final brain restart is required to install it" >&2
  exit 2
fi

cmdline="$(tr '\0' ' ' < "/proc/${pid}/cmdline" 2>/dev/null || true)"
if [[ "$cmdline" != *channel-proxy.ts* ]]; then
  echo "refusing to signal pid ${pid}: it is not channel-proxy.ts" >&2
  exit 2
fi

build_out="$(mktemp /tmp/ai-companion-channel-check.XXXXXX.js)"
cleanup() { rm -f "$build_out"; }
trap cleanup EXIT
bun build "${PROJECT_DIR}/channel-server.ts" --target bun --outfile "$build_out" >/dev/null

old_child="$(jq -r '.childPid // 0' "$STATUS_FILE" 2>/dev/null || echo 0)"
kill -HUP "$pid"

for _ in $(seq 1 620); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "channel proxy exited during reload" >&2
    exit 1
  fi
  phase="$(jq -r '.phase // "unknown"' "$STATUS_FILE" 2>/dev/null || echo unknown)"
  child="$(jq -r '.childPid // 0' "$STATUS_FILE" 2>/dev/null || echo 0)"
  if [ "$phase" = "ready" ] && [ "$child" != "0" ] && [ "$child" != "$old_child" ] \
    && curl -fsS --max-time 2 "$HEALTH_URL" >/dev/null; then
    echo "channel backend reloaded (child ${old_child} -> ${child}); Claude was not restarted"
    exit 0
  fi
  if [ "$phase" = "replay_timeout" ]; then
    echo "channel reload handshake timed out; proxy is recovering" >&2
  fi
  sleep 0.5
done

echo "channel reload did not complete within 310s (it may still be waiting for an active turn to finish)" >&2
exit 1
