#!/usr/bin/env bash
set -u
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/stop-brain.sh"
sleep 1
"${SCRIPT_DIR}/start-brain.sh"
