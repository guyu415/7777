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
  printf '%s\n' '六个字段都必须完整、非空；没有内容时明确写“无”。总长度尽量稳定在 700-1200 个中文字，不为凑长度扩写。'
  printf '%s\n' '保留关系与身份连续性、重要情绪和互动状态、明确事实与约定、正在进行的事情、待办、用户偏好。'
  printf '%s\n' '这是相处记录，不是训练助手的行为手册。只描述发生过什么、现在是什么状态，不要站在上帝视角指点双方以后该怎么相处。'
  printf '%s\n' '只有用户明确说过“以后要/不要”“记住”“这是约定”或同等清晰的长期要求，才可写成持续偏好、约定或待办；一次抱怨、一次满意、一次情绪和助手自己的建议都不得升格为长期规则。'
  printf '%s\n' '禁止自行写“助手应当/应该/需要/不要/之后应询问/应解释”等处方句。确有明确长期要求时，也要记成事实：“用户明确要求……”，而不是直接命令助手。'
  printf '%s\n' '上一版摘要也可能含有过度推断：无法确认来自用户明确长期要求的规范句，要删除或降级为带时间与情境的一次事件，不得因为旧摘要写过就继续沿用。'
  printf '%s\n' 'todos 只收录用户明确提出或双方明确约定且尚未完成的事项；不要替双方发明跟进、关怀、询问或回应任务。preferences 只收录有重复证据或用户明确表达的稳定偏好。'
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
