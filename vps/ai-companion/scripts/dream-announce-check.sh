#!/usr/bin/env bash
# Triggered by ai-companion-dream-announce.timer, every 15 minutes (matches
# xinchao's own settle cadence). Closes the gap the production dream-request
# prompt promises ("早上八点心潮会另外叫你把它讲给用户听") but nothing used to
# actually fire — see /internal/dream-announce in channel-server.ts.
#
# Only ever looks at xinchao's LATEST dream, same "never resurrect a stale
# dream days later" rule dreamPushAllowed itself uses — a dream from an
# earlier day is left alone even if somehow never announced.
set -u

PORT="${AI_COMPANION_INTERNAL_PORT:-8789}"
SECRET_FILE="${AI_COMPANION_INTERNAL_SECRET_FILE:-/opt/ai-companion/config/internal.secret}"
XINCHAO_TOKEN_FILE="${XINCHAO_TOKEN_FILE:-/opt/ai-companion/config/xinchao-token.secret}"
XINCHAO_URL="${XINCHAO_URL:-http://127.0.0.1:18110}"
PUSH_HOUR="${DREAM_PUSH_HOUR:-8}"
TZ_NAME="${DREAM_TIME_ZONE:-Asia/Taipei}"
STATE_FILE="/opt/ai-companion/state/dream-announce-state.json"
BRAIN_LOG="/opt/ai-companion/logs/brain.log"

SECRET="$(cat "$SECRET_FILE" 2>/dev/null)"
XINCHAO_TOKEN="$(cat "$XINCHAO_TOKEN_FILE" 2>/dev/null)"
[ -z "$SECRET" ] && exit 0
[ -z "$XINCHAO_TOKEN" ] && exit 0

STATE_JSON="$(curl -fsS --max-time 5 "${XINCHAO_URL}/v1/state" -H "Authorization: Bearer ${XINCHAO_TOKEN}" 2>/dev/null)"
[ -z "$STATE_JSON" ] && exit 0

# Real incident 2026-08-06: the very first run of this timer fired 30s after
# the user said "醒了，抱抱你" mid-conversation — /internal/dream-announce only
# checks currentTurn at the instant it's called, so it opened a turn anyway,
# and the user's NEXT message landed in that window and got turn_busy-
# rejected. dream-announce has no business interrupting a live exchange, so
# require a short quiet gap since the last real conversation turn first —
# much shorter than engine.js's own dreamMinIdleHours (that one gates a
# phone push and is deliberately hours-scale; this is only about not
# stepping on a message the user is mid-typing/mid-reply on).
IDLE_MINUTES="${DREAM_ANNOUNCE_MIN_IDLE_MINUTES:-5}"
LAST_CONVERSATION_AT="$(echo "$STATE_JSON" | jq -r '.lastConversationAt // empty')"
if [ -n "$LAST_CONVERSATION_AT" ]; then
  LAST_EPOCH="$(date -d "$LAST_CONVERSATION_AT" +%s 2>/dev/null || echo 0)"
  NOW_EPOCH="$(date +%s)"
  IDLE_SECONDS=$((NOW_EPOCH - LAST_EPOCH))
  if [ "$IDLE_SECONDS" -lt $((IDLE_MINUTES * 60)) ]; then
    exit 0
  fi
fi

DREAM="$(echo "$STATE_JSON" | jq -c '.recentDreams[-1] // empty')"
[ -z "$DREAM" ] && exit 0

DREAM_ID="$(echo "$DREAM" | jq -r '.id')"
CREATED_AT="$(echo "$DREAM" | jq -r '.createdAt')"
[ -z "$DREAM_ID" ] || [ "$DREAM_ID" = "null" ] && exit 0

DREAM_DAY="$(TZ="$TZ_NAME" date -d "$CREATED_AT" +%Y-%m-%d 2>/dev/null)"
TODAY="$(TZ="$TZ_NAME" date +%Y-%m-%d)"
NOW_HOUR="$(TZ="$TZ_NAME" date +%H)"
NOW_HOUR=$((10#$NOW_HOUR))

if [ "$DREAM_DAY" != "$TODAY" ]; then
  # A stale latest dream after push hour means the upstream overnight dream
  # request never completed. Record it once per day instead of silently
  # returning success every 15 minutes and making the timer look healthy.
  LAST_MISSING_DAY="$(jq -r '.lastMissingDreamDay // empty' "$STATE_FILE" 2>/dev/null)"
  if [ "$NOW_HOUR" -ge "$PUSH_HOUR" ] && [ "$LAST_MISSING_DAY" != "$TODAY" ]; then
    echo "[$(date -Iseconds)] dream-announce-check missing_today latestDreamDay=${DREAM_DAY:-unknown}" >> "$BRAIN_LOG"
    mkdir -p "$(dirname "$STATE_FILE")"
    (jq --arg day "$TODAY" '.lastMissingDreamDay = $day' "$STATE_FILE" 2>/dev/null || jq -n --arg day "$TODAY" '{lastMissingDreamDay: $day}') \
      > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
  fi
  exit 0
fi
if [ "$NOW_HOUR" -lt "$PUSH_HOUR" ]; then
  exit 0
fi

LAST_ANNOUNCED="$(jq -r '.lastAnnouncedDreamId // empty' "$STATE_FILE" 2>/dev/null)"
if [ "$LAST_ANNOUNCED" = "$DREAM_ID" ]; then
  exit 0
fi

PAYLOAD="$(echo "$DREAM" | jq -c '{dream, residue, awareness}')"
RESULT="$(curl -fsS --max-time 60 -X POST "http://127.0.0.1:${PORT}/internal/dream-announce" \
  -H "X-Internal-Secret: ${SECRET}" -H "Content-Type: application/json" \
  -d "$PAYLOAD" 2>&1)"
echo "[$(date -Iseconds)] dream-announce-check fired dreamId=${DREAM_ID}: ${RESULT}" >> "$BRAIN_LOG"

OK="$(echo "$RESULT" | jq -r '.ok // false' 2>/dev/null)"
if [ "$OK" = "true" ]; then
  mkdir -p "$(dirname "$STATE_FILE")"
  (jq --arg id "$DREAM_ID" '.lastAnnouncedDreamId = $id | del(.lastMissingDreamDay)' "$STATE_FILE" 2>/dev/null || jq -n --arg id "$DREAM_ID" '{lastAnnouncedDreamId: $id}') \
    > "${STATE_FILE}.tmp" && mv "${STATE_FILE}.tmp" "$STATE_FILE"
fi
