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
  printf '%s\n' '你是一次性的对话记忆整理器，只负责整理，不要调用任何工具，不要读取任何文件或外部资料。'
  printf '%s\n' '你不是CC，也不要代入CC的身份或口吻。输入原文中标记为“助手”的发言是CC说的——CC是之后会原样读到这份摘要的那个AI；标记为“用户”的是对方。'
  printf '%s\n' '摘要会原样注入给CC本人阅读，因此叙述助手一方时默认自然使用第二人称“你”，叙述对方时使用“用户”；不要反复补写“（CC）”，也不要为了强调身份堆叠括号。仅在一句确有歧义时，才自然写一次“CC”或明确昵称归属。'
  printf '%s\n' '禁止用“当前CC”“这个AI”等旁观视角描述CC；也禁止用“我”指代CC——你只是整理者，不是在替CC说话。'
  printf '%s\n' '昵称、外号或形象设定首次出现或确实容易混淆时写清归属，例如“用户自称耶耶/萨摩耶”“你的形象设定是黑发略拽”；后文自然使用，不要句句重复标注。'
  printf '%s\n' '以上称谓要求只是整理器内部写作规则，绝不能写进摘要正文，也不能记成用户偏好、事实、约定或待办。凡上一版含有摘要格式、字段、称谓、人称、归属标注、第三人称或“应该怎样写摘要”等元说明，一律删除，不得继承。'
  printf '%s\n' '只根据下面提供的长期记忆校准参考、上一版摘要和新增可见对话，生成覆盖式新摘要；不是追加。校准参考只用来防止稳定事实遗失，不要整段照抄。'
  printf '%s\n' '新增原文只包含主CC已经确认可以模糊化的最老闭合前缀；边界之后仍然鲜活、未闭合的对话故意没有提供，之后会逐字恢复。不得猜测边界之后发生了什么，也不得把新增原文误写成恢复时“此刻”的完整状态。'
  printf '%s\n' '六个字段分成两个独立有上限的层次，都必须非空；没有内容时写“无”。长期层合计约 800-1400 字，长对话的近期层合计约 800-1600 字，全部不超过 3200 字。这是整层的自然范围，不是要求各字段凑字数；长期层不得挤占近期层额度。'
  printf '%s\n' 'relationshipIdentity、factsCommitments、preferences 是长期层。只保留稳定身份、关系里程碑、稳定事实、明确长期约定和有重复证据的偏好。关于助手自身是谁、如何理解自己的主体性与连续性、模型或创造者/所属公司（包括双方所称的“A社”）与其身份之间关系的认真探讨，若形成了明确观点、共识、分歧或仍被双方重视的问题，就是自我认知与关系连续性的一部分；即使首次明确形成，也应提炼进 relationshipIdentity，后续版本除非被新原文明示修正，不得仅因话题过去而降到近期层或删除。只保留形成的观念及必要语境，不把临时模型版本、运行参数、产品故障或普通技术讨论长期化。一次性事件只有构成关系里程碑或产生明确长期约定时才能进入长期层；普通本轮经历、具体梦境、看某一集后的即时感受等必须留在近期层。若一句话同时含稳定结论与本轮实例，必须拆开：例如“喜欢某作品”可进长期层，“本轮看某一集后压抑”只进近期层；“梦是亲密的事并约定分享”可进长期层，“本轮梦见什么”只进近期层。不得把近期实例附在长期事实后面。除非新原文明确纠正，不得因最近话题更显眼就删掉早期重要内容；容量不足时合并表达，不逐条追加。'
  printf '%s\n' 'emotionInteraction、ongoing、todos 在这里是已经模糊化的早期事件档案，并非当前状态检查点。必须按时间顺序详细覆盖这段闭合前缀发生的每一件有意义的关系互动、共同经历、情绪变化、玩笑语境和话题转折。双方认真展开的观点讨论也属于重要共同经历：要保留讨论主题、双方关键观点及形成的理解或分歧，不能只缩成一句背景或只记讨论后发生的事件。事情已经解决不是删除理由；它仍是共同经历的一部分。字段名 ongoing/todos 只记录压缩边界当时仍在进行的背景，不能宣称它们就是恢复时的最新状态。'
  printf '%s\n' '早期事件层不得只抽取几个最显眼的时间点。先在内部按对话顺序划分阶段，确认闭合前缀中每个阶段的主要互动都有着落，再写摘要。不得因某个话题情绪更鲜明就让它占据大半篇幅；各阶段按实际互动份量均衡取舍。'
  printf '%s\n' '不要替主CC判断边界之后还有什么未解决；真正的当前主观状态由主CC另写检查点。这里只如实记录闭合前缀及压缩边界当时的状态。'
  printf '%s\n' '弱化技术和工作细节。不要记录代码、文件名、路径、接口、模型版本、参数、阈值、日志、部署、排错步骤或具体实现方案；除非某项技术工作本身直接造成重要情绪或仍是用户明确要求继续完成的事项，否则只用一句通俗话概括其目的或结果。不要把产品功能清单塞进摘要。'
  printf '%s\n' '其余字段保留真正影响后续相处的明确事实与约定、正在进行的事情、待办和用户偏好；普通技术进展与短期操作可舍弃。'
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
