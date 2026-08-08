# Eunoia VPS companion backend

Production path: `/opt/ai-companion`. The files in this directory are the
version-controlled source mirror for the VPS-resident CC/Codex companion
backend. Secrets, logs, state, transcripts, uploads, generated compression
artifacts, and MCP credentials are intentionally excluded.

## CC tidal-memory configuration

Only the fixed Claude Code companion window reads these variables:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `AI_COMPANION_TIDAL_TOKEN_THRESHOLD` | `110000` | Real input context tokens required to trigger |
| `AI_COMPANION_TIDAL_VISIBLE_THRESHOLD` | `150` | Visible user/assistant messages fallback |
| `AI_COMPANION_TIDAL_RECENT_MAX` | `16` | Maximum raw messages in recovery layer |
| `AI_COMPANION_TIDAL_RECOVERY_TOKEN_BUDGET` | `4000` | Total three-layer recovery budget |
| `AI_COMPANION_TIDAL_RETRY_MS` | `300000` | Retry delay after a failed stage |
| `AI_COMPANION_TIDAL_SUMMARY_TIMEOUT_MS` | `250000` | Luna/fallback task timeout |
| `AI_COMPANION_TIDAL_COMPACT_TIMEOUT_MS` | `180000` | Native `/compact` confirmation timeout |
| `AI_COMPANION_TIDAL_FALLBACK_MODEL` | `Qwen/Qwen2.5-7B-Instruct` | Existing free SiliconFlow fallback |

Luna runs through the root-owned fixed-path script
`scripts/tidal-luna-summary.sh`. The narrow sudoers entry allows no
arguments. It invokes `codex exec --ephemeral --ignore-user-config
--ignore-rules --sandbox read-only --model gpt-5.6-luna` with medium
reasoning and a strict JSON output schema. It never resumes a CC or Codex
thread.

Persistent tidal state is `/opt/ai-companion/state/cc-tidal-memory.json`.
The file contains the CC session id, rolling summary, processed boundary,
two-phase pending record, retry timestamp, and FIFO messages that arrived
during maintenance. It is private runtime state and must never be committed.

The production service remains `ai-companion-brain.service`. It owns only the
CC tmux session; Codex app-server processes are not managed or restarted by
this unit.
