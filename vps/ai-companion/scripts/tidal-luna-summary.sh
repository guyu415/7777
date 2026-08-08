#!/usr/bin/env bash
# Fixed-path, one-shot Luna summarizer. This is the only command the
# companion user may run as root (see /etc/sudoers.d/ai-companion-tidal).
# It uses root's existing ChatGPT login, creates no resumable Codex thread,
# loads no Codex/project rules, and never prints the private prompt or output.
set -euo pipefail
umask 077

INPUT=/opt/ai-companion/state/tidal/luna-input.txt
OUTPUT=/opt/ai-companion/state/tidal/luna-output.json
SCHEMA=/opt/ai-companion/scripts/tidal-summary.schema.json
WORKDIR=/var/lib/ai-companion-tidal-summary
CODEX=/root/.local/bin/codex
TIMEOUT_SECONDS="${AI_COMPANION_TIDAL_SUMMARY_TIMEOUT_SECONDS:-240}"

test -x "$CODEX"
test -f "$INPUT"
test ! -L "$INPUT"
test -f "$SCHEMA"
mkdir -p "$WORKDIR"
chmod 700 "$WORKDIR"

tmp="${OUTPUT}.tmp.$$"
rm -f "$tmp"

{
  printf '%s\n' '你是一次性的对话记忆整理器。不要调用任何工具，不要读取任何文件或外部资料。'
  printf '%s\n' '只根据下面提供的上一版摘要和新增可见对话，生成覆盖式的新滚动摘要；不是追加。'
  printf '%s\n' '六个字段都必须完整、非空；没有内容时明确写“无”。总长度尽量稳定在 900-1600 个中文字。'
  printf '%s\n' '保留关系与身份连续性、重要情绪和互动状态、明确事实与约定、正在进行的事情、待办、用户偏好。'
  printf '%s\n' '不要包含 thinking、工具内部输出、系统消息，不要提及压缩过程。只输出符合 schema 的 JSON。'
  printf '%s\n\n' '--- 输入开始 ---'
  /usr/bin/sed -n '1,$p' "$INPUT"
  printf '%s\n' '--- 输入结束 ---'
} | timeout --signal=TERM --kill-after=10 "$TIMEOUT_SECONDS" \
  "$CODEX" exec \
    --ephemeral \
    --ignore-user-config \
    --ignore-rules \
    --skip-git-repo-check \
    --sandbox read-only \
    --cd "$WORKDIR" \
    --model gpt-5.6-luna \
    --config 'model_reasoning_effort="medium"' \
    --output-schema "$SCHEMA" \
    --output-last-message "$tmp" \
    - >/dev/null 2>/dev/null

test -s "$tmp"
jq -e '
  type == "object" and
  (.relationshipIdentity | type == "string" and length > 0) and
  (.emotionInteraction | type == "string" and length > 0) and
  (.factsCommitments | type == "string" and length > 0) and
  (.ongoing | type == "string" and length > 0) and
  (.todos | type == "string" and length > 0) and
  (.preferences | type == "string" and length > 0)
' "$tmp" >/dev/null

mv -f "$tmp" "$OUTPUT"
chown companion:companion "$OUTPUT"
chmod 600 "$OUTPUT"
