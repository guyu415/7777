#!/bin/bash
# Extracts the current resident session's clean dialogue and compresses it
# via SiliconFlow into /opt/ai-companion/compression/summary-pending.md for
# human review. Re-run this (as the `companion` user) any time you want a
# fresh compression, including "regenerate" after rejecting a summary — it
# re-runs both extract and compress from scratch.
set -euo pipefail
cd /opt/ai-companion
BUN="$HOME/.bun/bin/bun"
[ -x "$BUN" ] || BUN="/home/companion/.bun/bin/bun"
"$BUN" run scripts/compression/extract-dialogue.mjs
"$BUN" run scripts/compression/compress-dialogue.mjs
echo "Review: /opt/ai-companion/compression/summary-pending.md"
echo "Original: /opt/ai-companion/compression/latest-dialogue.md"
