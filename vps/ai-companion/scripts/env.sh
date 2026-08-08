# Shared environment for ai-companion scripts. Sourced, not executed directly.
export PATH="/home/companion/.bun/bin:/home/companion/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export HOME="/home/companion"
PROJECT_DIR="/opt/ai-companion"
SESSION="ai-companion-cc-1"
WEB_PORT="8788"
HEALTH_URL="http://127.0.0.1:${WEB_PORT}/health"
BRAIN_LOG="${PROJECT_DIR}/logs/brain.log"
WATCHDOG_LOG="${PROJECT_DIR}/logs/watchdog.log"

# Session continuity across restarts. Without these the brain came up as a
# brand-new claude session every time, so every bug-fix restart wiped the
# conversation — the exact opposite of what a resident companion is for.
#   BRAIN_SESSION_ID_FILE — holds the uuid of the ONE long-lived brain session.
#   TRANSCRIPT_DIR        — where claude keeps that session's .jsonl.
#   SESSION_MODE_FILE     — written by brain-loop.sh on every spawn, read by
#                           channel-server.ts so the user is told, out loud,
#                           whether this session remembers or not.
BRAIN_SESSION_ID_FILE="${PROJECT_DIR}/state/brain-session-id"
TRANSCRIPT_DIR="${HOME}/.claude/projects/-opt-ai-companion"
SESSION_MODE_FILE="${PROJECT_DIR}/state/session-mode.json"

# Defensive: never let a claude-in-claude nesting artifact leak into the brain session.
unset CLAUDECODE CLAUDE_CODE_CHILD_SESSION CLAUDE_CODE_SESSION_ID CLAUDE_PID \
      CLAUDE_CODE_ENTRYPOINT CLAUDE_CODE_EXECPATH CLAUDE_EFFORT AI_AGENT
