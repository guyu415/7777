# 群聊互动小游戏 · 第一个游戏：轻量沉浸式情感本剧本杀

> **给未来的自己（含被摘要后的自己）**：任何时候继续这个功能，**先读完这份文件再动手**，
> 不要凭记忆重做。已完成的阶段不要重复实现；待办按顺序往下做；每完成一个阶段回来更新
> 「进度」一节。

---

## 0. 需求原文要点（不可偏离）

1. 复用现有群聊成员和各自真实 AI 调用，**不另建一套角色聊天系统**。
2. 支持选择剧本、选择角色；**情感本也允许存在凶手**。
3. 每个角色有独立身份、秘密、任务、可见线索；**禁止互相泄露隐藏信息**。
4. 支持主持人、NPC、AI 玩家、用户玩家，**按章节推进**。
5. 游戏状态**必须持久保存**，关页面/中断后可继续。
6. 第一版必须内置**一个真正能完整游玩的原创情感本**，不要空壳。
7. 保持轻量，不照搬庞大框架；同一入口以后要能扩展扑克等桌游。
8. 本文件即进度锚点，阶段性更新。
9. 只做剧本杀，不碰社媒浏览器/登录。
10. 完成后验证主流程 + 刷新续玩，构建通过后统一 commit 直接 push main。

---

## 1. 设计决策（为什么这么做）

### 1.1 「复用群聊成员和真实 AI 调用」怎么落地

群聊里成员有两类（见 `src/utils/groupMembers.js`）：

- **`api:<sessionId>` 成员**：普通单聊会话。它的 API key/baseUrl/model 只存在于浏览器里，
  群聊后端没有凭据，所以**浏览器本来就是唯一能真正调用它的地方**（见
  `src/utils/groupApiMember.js` 的 `fulfillApiMemberTurn`）。
- **`claude-code` / `codex` 两个 VPS 常驻 runtime**：由 VPS 上的 channel-server 持有，
  前端没有「无状态单次提问」的调用入口，它们是**一条长期会话**。

**决策**：AI 玩家只允许分配给 `api` 类成员，走的正是群聊 api 成员同一条路径
（`resolveApiMemberConfig` → `streamChat`），复用同一份会话配置、人设、模型——
这就是「真实 AI 调用」，没有另建角色聊天系统。

VPS runtime 在选角界面里可见但不可选，并写明原因：它们只有一条长期会话，
把角色秘密塞进去既会污染它们自己的记忆，也无法保证秘密隔离。
（以后若后端加了无状态单次调用接口，这里放开一行判断即可。）

### 1.2 秘密隔离怎么保证（第 3 条硬要求）

结构上保证，而不是靠提示词祈祷：

- `buildCharacterSystemPrompt(script, charId, state)` **只从 `script.characters` 里取
  `charId` 自己那一条**，其他角色的 `secret` / `mission` / `privateClues` / `truth`
  在这个函数里根本没有被读取的路径。
- 发给 AI 的「公开上下文」= `state.log` 里 `visibility === 'public'` 的条目，
  私密条目（自己的线索卡、自己的任务）只在**该角色自己**的 prompt 里出现。
- `script.truth`（凶手是谁）只在揭晓章节之后、由**主持人**发布为公开信息；
  在此之前任何角色 prompt 都不包含它——包括凶手本人，凶手只知道**自己做了什么**。

### 1.3 主持人 = 本地脚本，不是 AI

主持人负责念章节旁白、发线索、控流程。做成**确定性的本地逻辑**（读剧本数据），
不消耗任何模型额度，也不会跑偏。这是「轻量」的关键：整套引擎是纯函数 + 一份剧本数据。

### 1.4 NPC

没有被分配给用户/AI 的角色自动成为 NPC，由主持人代述该角色在本章的
`npcLines`（剧本里写死）。因此**1 个真人 + 0 个 AI 也能把本走完**，
人多则更多角色由真实 AI 出演。

### 1.5 持久化

`useStore`（zustand + persist → localStorage，key `pink-chat-settings`）里新增
`mysteryGames: { [groupChatId]: GameState }`，并加进 `partialize`。
刷新/关页面/换标签页后回到同一群聊，直接续上章节、发言记录、投票。

### 1.6 入口与可扩展性（第 7 条）

群聊右上角「群聊菜单」→ 新增一行 **「小游戏」** → 打开 `GameHubSheet`
（游戏列表，数据在 `games/gameRegistry.js`）→ 目前只有「剧本杀」一项，
以后加扑克只需往 registry 里加一条 + 一个房间组件，入口不用再改。

---

## 2. 内置剧本：《雾岛来信》（原创情感本，5 角色，含凶手）

- **类型**：情感本 / 微推理，5 人（可 1 人 + N 个 AI，其余转 NPC）
- **背景**：十年前的夏天，高中生林晚从雾岛灯塔坠海身亡，定性为意外。
  十年后同学在旧旅馆重聚，每个人都收到一封署名「林晚」的信。
- **角色**：周砚（旅馆老板）、苏茉（中学老师）、陈屿（货车司机）、
  温知夏（记者）、顾时明（律师）。
- **真相**：顾时明是过失致死者并用钱封口十年；陈屿是被所有线索指向的「假凶手」。
- **章节**：重逢之夜 → 那封信 → 灯塔的那晚（搜证） → 谁在说谎（投票指认） → 真相与和解。

剧本数据在 `src/components/GroupChat/games/scripts/mistIslandLetter.js`，
纯数据，不含逻辑，方便以后再加本。

---

## 3. 涉及/新增文件

| 文件 | 说明 |
| --- | --- |
| `docs/mystery-game-progress.md` | 本文件 |
| `src/components/GroupChat/games/scripts/mistIslandLetter.js` | 内置原创剧本《雾岛来信》纯数据 |
| `src/components/GroupChat/games/scripts/index.js` | 剧本注册表（以后加本只改这里） |
| `src/components/GroupChat/games/gameRegistry.js` | 小游戏注册表（以后加扑克只改这里） |
| `src/components/GroupChat/games/mysteryEngine.js` | 纯函数引擎：建局、发言 prompt 构造、章节推进、投票统计 |
| `src/components/GroupChat/games/GameHubSheet.jsx` | 「小游戏」列表底部弹层 |
| `src/components/GroupChat/games/MysteryGameRoom.jsx` | 剧本杀房间 UI（选本 → 选角 → 章节推进 → 揭晓） |
| `src/store/index.js` | 新增 `mysteryGames` 状态 + 读写 action + partialize 持久化 |
| `src/components/GroupChat/GroupChatWindow.jsx` | 群聊菜单加「小游戏」入口，挂载房间组件 |

---

## 4. 进度

### 已完成
- [x] **阶段 0**：读群聊现有实现，确定架构与秘密隔离方案，写下本文件。
- [x] **阶段 1**：剧本数据《雾岛来信》+ 剧本/游戏注册表。
- [x] **阶段 2**：`mysteryEngine.js` 纯逻辑（建局、prompt、推进、投票）。
- [x] **阶段 3**：store 持久化（`mysteryGames` + partialize）。
- [x] **阶段 4**：`MysteryGameRoom.jsx` + `GameHubSheet.jsx` UI，接入真实 `streamChat`。
- [x] **阶段 5**：群聊菜单接入入口。
- [x] **阶段 6**：验证 → 单次 commit push main。

### 验证记录（2026-08-03）

**引擎层（纯函数跑完整局，37 项全过）**：建局座位归属 / 未分配自动 NPC；
秘密隔离（角色 prompt 不含他人 secret、不含 `truth`，真凶自己的 prompt 里也没有
剧本判定的真相；私密线索不串台）；存档 JSON 往返后能接着走完当章且 prompt 构造
结果一致；五章全流程走到落幕、投票计票、真相公布、结局文本；投票解析四种输入
（含"解不出来就算弃权，不瞎猜"）；1 个真人 + 0 个 AI 全 NPC 也能通关。

**UI 层（真实浏览器挂载真实组件 + 真实 store，22 项全过）**：选本选角面板、
VPS 成员不可选且写明原因、开局；NPC 自动念台词 → 停在用户回合等输入 → 用户发言入日志；
AI 玩家缺 API Key 时**如实报错**并给重试/跳过，不伪装成"选择沉默"、不推进轮次；
角色卡只显示自己的秘密、他人私密线索不出现在界面上；**刷新页面后存档、章节、
已说过的话、角色分配全部还在**；一路推进到揭晓真相与尾声，`finished` 置位。

`npm run build` 通过（1646 modules，14.7s）。验证脚本放在会话临时目录，未入库。

### 待办 / 以后可做（本次不做）
- [ ] 第二个剧本、第二个游戏（扑克）——入口已预留，加数据即可。
- [ ] 语音/朗读、角色立绘等表现层增强。

---

## 6. 第二阶段：CC / Codex 作为真正的 AI 玩家（2026-08-03）

上一阶段把 claude-code/codex 列为"不可选"，理由是它们只有一条长期会话、没有
无状态单次调用入口。这一阶段把那个入口做出来了——**不是在前端妥协，是在
VPS 的 channel-server.ts 里给这两个 runtime 各自加了一条"这一局、这一个
角色专用"的真实隔离线程/会话**，同时保证：不读 CC/Codex 自己的单聊或群聊
历史、不碰 Auto Memory、只知道这一个角色自己的秘密/任务/线索、游戏内的
角色记忆和剧情上下文在这条隔离线程里真实保留（不是每次重新灌全部上下文
假装有记忆）。

### 6.1 后端设计（/opt/ai-companion/channel-server.ts，不在这个 git 仓库里，
直接部署在 VPS 上——见下方"涉及文件"里专门标出的一条）

**Claude Code**：CC 本身只有一条常驻 tmux/MCP 会话，没有"开一条新线程"这个
概念，所以这里是**每个 (gameId, charId) 单独起一个全新的 `claude` 进程**，
在自己的 detached tmux 会话里：
- `--system-prompt` **整体替换**默认系统提示——CC 自己的人设/记忆一个字都
  不会混进来；
- `--tools ""` 完全关掉所有工具（不能读写文件、不能跑 Bash）——这也是保证
  Auto Memory 结构上不可能被这条隔离线程写入的根本原因，不是靠提示词自觉；
- `--strict-mcp-config` + 一个空的 mcp 配置——CC 真正的 MCP 工具在这里一个
  都连不上；
- 复用同一个共享的、预先信任过一次的 scratch 目录（因为 `--tools ""` 已经
  保证没有任何东西会读写那个目录，共享是安全的，也省得每个角色都单独弹一次
  "是否信任这个目录"）；预先信任的做法是直接往 companion 用户自己的
  `~/.claude.json` 的 `projects.<path>.hasTrustDialogAccepted` 写一次
  `true`——和这台机器上常驻大脑自己预接受权限提示用的是同一个机制。
- tmux 会话对这一局的生命周期是**常驻的**（角色在章节之间真的记得自己说过
  什么——直接实测过：问它"我第一句话说了什么"，逐字答对），只有明确结束本局
  /删除存档时才杀掉；有并发上限（同时最多 4 个 CC 剧本杀进程），保护这台本来
  就吃紧的 VPS 内存。
- 由于这类会话没有 MCP 工具通道，回复是**直接从真实终端屏幕上解析出来的**
  （数"✻ ... for Ns"这条完成标记出现的次数，取最新一段"●"开头的内容）；
  多行指令发送前会压成单行（tmux 没有安全的办法把带真换行的文本粘贴进这个
  UI 而不被当成提前按了 Enter——实测验证过，粘贴带换行的文本会被拆成好几条
  提前发送的消息）。

**Codex**：本来就有真正的"线程"概念（`thread/start`/`thread/resume`），
群聊功能自己就已经在用"每个群一条独立线程"这个模式——这里只是照搬同一个
形状，改成"每个角色一条独立线程"，角色系统提示通过 `developerInstructions`
在建线程时传入。

两条路径统一收在一个入口 `mysteryRunTurn`，通过 `POST /mystery/turn` 暴露；
模型选择是纯粹的单次调用参数（CC 是进程启动参数，Codex 是 turn/start 的
`model` 覆盖），从不写回 `codexSelectedModel`或大脑自己 tmux 里的 `/model`
——这一局选的模型绝不会影响任何一个 runtime 真正的单聊/群聊模型设置。

`POST /mystery/cleanup` 杀掉某局某些角色的 CC tmux 会话、删掉持久化的
Codex 线程 id 映射——结束本局或删除群聊时调用，幂等（角色从没被叫起来过
也能安全调用）。

### 6.2 前端改动
- `src/services/companion.js`：`getMysteryCcModels`/`runMysteryTurn`/
  `cleanupMysteryGame`——和这个文件里其他真实模型调用一样，失败直接抛
  错，从不伪造成功。
- `src/components/GroupChat/games/mysteryEngine.js`：`createGame` 的座位
  结构从 `{kind, memberId}` 扩成 `{kind, memberId, model}`——`model` 只在
  `kind==='ai'` 时有意义，随存档一起持久化，刷新不丢。
- `src/components/GroupChat/games/MysteryGameRoom.jsx`：
  - `runAiTurn` 按 `isVpsMemberId(seat.memberId)` 分两条真实路径——api 成员
    走原来的 streamChat（现在也会带上这一局选的 `seat.model` 覆盖，不影响
    会话自己平时用的模型）；claude-code/codex 走新的 `runMysteryTurn`。
  - 开局面板解除了 claude-code/codex 的"不可选"限制，任何 AI 座位（api /
    claude-code / codex）现在都多一层"本局用哪个模型"的下拉：claude-code 用
    固定几个真实模型 ID（`/mystery/cc-models`，和 VPS `/model` 命令认的
    那份完全一致）；codex 用它自己真实的模型目录（复用已有的
    `/codex/model-status`）；api 会话用它所属供应商配置里真实的模型列表。
  - 结束本局 / 删除这个群聊时，都会对这局里被分配给 claude-code/codex 的
    角色调用一次 `cleanupMysteryGame`。

### 6.3 验证记录（2026-08-03，第二阶段）

**后端真实端到端（直接 curl 生产环境，不是 mock）**：
- CC 角色收到"有人问你今天过得怎么样"，只答自己的内容，未经询问从不主动
  透露秘密（藏了一颗草莓糖）；直接问"口袋里藏了什么"才如实交代——秘密隔离
  在真实模型行为层面确认。
- 同一局里第二个 CC 角色（不同秘密：怕黑）被问"口袋里藏了什么"时完全不知道
  candy 这回事——跨角色隔离确认。
- 第二次调用同一个角色（同一 tmux 会话）明显更快（复用而非重新起进程），
  且能在上下文里正确使用之前说过的内容——真实的局内记忆持续性确认。
- Codex 角色同样验证：秘密不主动透露、被直接问到时如实回答、第二次调用
  复用同一线程明显更快。
- `/mystery/cleanup` 调用后 `tmux list-sessions` 确认 CC 会话已消失、
  `state/mystery-codex-threads.json` 确认对应线程 id 已被删除。
- 全程 `curl /status` 确认大脑自己的真实模型（`claude-sonnet-5`）从未被
  这些调用改动；`/group/list` 确认群聊功能未受影响；重启常驻大脑（部署
  这次改动的必经步骤）后 `/health` 恢复、群聊/群成员数据从持久化文件正确
  恢复。

**前端**：`npm run build` 通过；引擎级 37 项回归全过（model 字段加入后无
影响）；真实浏览器挂载真实组件，10 项新增检查全过——Claude Code/Codex 出现
在选角下拉、"不可选"提示已移除、选中后出现模型下拉且能真实切换、含
claude-code/codex 玩家的对局能正常开局、**刷新后每个角色的座位分配和本局
模型选择原样保留**。（模型列表接口在离线测试环境里做了路由级 mock，因为
真实网络请求需要生产环境的 CORS/登录态；后端返回的真实模型列表已经在上面
的 curl 测试里直接验证过。）

### 6.4 已知边界（写清楚，别当 bug 重修）
- CC 隔离线程是**每个 (game, character) 一个真实 OS 进程**，同时并发上限
  4 个——这是为了保护共享 VPS 的内存，不是随便设的数字；如果同时有很多局
  游戏都用 CC 当玩家，超限的会收到"太多剧本杀 Claude Code 会话同时进行"
  错误，重试即可，不会静默失败或卡死。
- CC 这条链路没有逐字流式预览（Codex/api 成员也没有，只有 api 成员本来就
  有的 streamChat 才有）——一次 HTTP 请求换一整段回复，等待期间界面显示
  "思考中"。
- 这条隔离线程会在 channel-server.ts 每次重启后丢失"进程还活着"的内存态，
  但 CC 会话靠 tmux 会话名是确定性的（能用 `tmux has-session` 找回来，
  只要 tmux 服务本身没死）、Codex 线程 id 持久化在文件里——两者都能在重启
  后自然恢复，不需要额外迁移代码。

---

## 7. 第三阶段：自由发言节奏 + CC 发言异常缓慢根因排查（2026-08-03）

### 7.1 自由发言节奏

按顺序发言（一人一次、顺序固定）完全没动。新增的是：**剧情章（stage:
'story'）顺序发言全部说完后，自动进入一段自由讨论**，投票/揭晓章不受影响、
直接照旧走"进入下一章"。

- 引擎新增（`mysteryEngine.js`）：`enterFreeDiscussion`/`nextFreeActor`/
  `appendFreeSpeech`/`appendUserFreeMessage`/`skipFreeSpeechTurn`/
  `buildFreeSpeechPrompt`，外加 `FREE_SPEECH_LIMIT=3`（每个 AI 座位这一章
  最多自由发言 3 次，上限不是任务，额度用完自然停，不强求说满）和
  `FREE_SPEECH_MAX_CHARS=50`（真正的硬截断，不只是让模型自己控制）。
  `freeDiscussion` 状态（`remaining`/`paused`/`lastSpeaker`）随存档一起
  持久化，翻页（`advanceChapter`）时清掉，NPC/用户角色不占用额度。
- 房间组件（`MysteryGameRoom.jsx`）：一个 8 秒的 `setTimeout`
  （`FREE_SPEECH_DELAY_MS`）在每条自由发言之后自动排下一位，不需要逐条
  批准；用户输入框一旦非空就立刻 `setFreeDiscussionPaused(true)` 并清掉
  定时器，发送后解除暂停并重新计时；额外的手动"暂停讨论/继续讨论"按钮
  只是同一个 paused 标志的另一个开关，不会变成必须逐条点击的流程；
  "进入下一章"按钮在自由讨论期间也一直可点，用户随时能提前结束。
- 验证：引擎级 24 项全过（额度/轮流/暂停/50 字截断/秘密隔离/投票章不进入
  自由讨论）；真实浏览器端到端 12 项全过，包括**真实测到两条自由发言之间
  确实有约 8 秒间隔、用户打字立即暂停且超时也不会偷偷继续、发送后重新计时
  再继续**。

### 7.2 CC 发言异常缓慢——两个真实根因（不是猜的，都是现场复现确认的）

**根因一：`--setting-sources 'user'` 带进了 companion 账号自己的
`alwaysThinkingEnabled:true` + `effortLevel:"high"`。** 这两个设置是为常驻
大脑自己的真实关系对话调的，剧本杀这种短对白角色扮演完全不需要，而且现场
截图确认了状态栏显示 `● high · /effort`——每一局剧本杀的每一次发言都在
不知不觉里跑"深度思考"模式。**修复**：`--setting-sources` 改成空字符串
（不加载任何 user/project/local 设置），额外显式加 `--effort low` 双重
保证。

**根因二（更关键，真正的"长期没反应"）：长指令被 Claude Code 自己的输入框
当成"粘贴"，需要第二次 Enter 才会真的提交。** `tmux send-keys -l` 是把整段
文字当一次性字符突发写进去的，短测试消息（几十字）从来没触发过，但真实
游戏跑到中段、`buildTurnPrompt` 里累积的公开发言记录变长之后（现场用一段
~1800 字符的真实中局 prompt 复现），输入框会把这一整段折叠显示成
"[Pasted text #1 +N lines]"，只发一次 Enter 根本没有提交——模型那一轮压根
没开始处理，只是安安静静地"没反应"，正好对应"轮到它时长期没有反应，用户
等不下去才手动跳过"这个症状。现场确认过修复方式：再发一次 Enter 就立刻
提交。**修复**：`mysteryCcSendTurn` 现在每次轮询都检查 pane 里是否还挂着
"[Pasted text"，挂着就再发一次 Enter（最多重试 5 次），确认干净以后才继续
按原来的完成标记逻辑等待。

**排查过程中顺手炸出的第三个 bug（同一个根因的另一种表现）：** 用真实的
中局 prompt 连续测试时发现，即使成功提交了，完成检测偶尔也会整整卡满
110 秒超时，或者提取出空字符串——根因是 Claude Code 的 ink 界面是
alternate-screen 模式，`tmux capture-pane -S` 能抓到的历史大致只有"一屏
高度"，而不是无限滚动记录；tmux 会话原本只给了 `-y 24`（24 行），几轮对话
之后旧的完成标记就会被"挤出"可截取范围，导致"数标记数量变化"这套判断逻辑
在数量刚好没变化（挤掉一条、新增一条）时误判为"还没结束"，甚至把回复内容
本该有的"●"开头行也一起挤没了（对应空字符串那个症状）。**修复**：把 tmux
会话的高度从 24 改成 3000——一整局游戏的所有对话都稳稳装得下，不会再挤。

**这两个真实根因的验证**：用同一段真实中局 prompt（约 1800 字符）连续测试
5 次 CC 发言，全部成功，总耗时分别是 12.3s / 10.0s / 8.3s / 6.5s / 9.1s
（对照修复前：同样的 prompt 曾经真实录得 33 秒一次回复，以及至少两次
完全卡满 110 秒超时/提取失败）——诊断日志里能看到 `mystery_cc_pending_
paste_detected` 在 5 次里有 3 次真的触发了（证明这个 bug 不是偶发，是
常见路径），修复后全部自动恢复、不需要人工介入。

**Codex 侧核对**：Codex 走的是它自己 app-server 的真实 `thread/start`/
`turn/start` 协议，不经过任何终端截屏，天然不会有上面两个问题；核对了
`mysteryCodexPendingByThread` 的单飞保护本来就已经在等——不需要改。

**跳过必须真正作废请求（第 6 条要求）**：`MysteryGameRoom.jsx` 新增
`activeCallRef`——每次真实调用都有自己的 `AbortController`，点"跳过"会
真的 abort 网络请求、并把这次调用标记成"已作废"；即使 VPS 那边来不及在
abort 那一刻就收尾，等它最终结算时也会发现自己已经不是当前调用了，安静地
什么都不做（不提交内容、不重复消耗自由发言额度）。后端 `mysteryCcSendTurn`
也接了同一个 abort signal，每次轮询检查一次，跳过之后会在一次轮询周期内
（远小于 110 秒超时）就释放这个角色的忙碌锁，不阻塞它下一次发言——现场
验证过：abort 后等 1.5 秒，同一个角色的下一次调用正常拿到真实回复。

诊断日志（`mystery_cc_session_start/ready`、`mystery_cc_turn_sent`、
`mystery_cc_pending_paste_detected`、`mystery_cc_first_content`、
`mystery_cc_turn_complete/timeout`、`mystery_turn_received/done/error`）
留在了正式代码里（不是一次性脚本）——量很小，只在关键节点各打一条，
后续真的又变慢时能直接从日志里看出卡在哪一步，不用再重新排查一遍。

### 7.3 涉及文件（这一阶段）
- `src/components/GroupChat/games/mysteryEngine.js` —— 自由发言引擎逻辑。
- `src/components/GroupChat/games/MysteryGameRoom.jsx` —— 自由讨论 UI/自动
  驱动 + AbortController 真取消。
- `/opt/ai-companion/channel-server.ts`（VPS 上，不在这个 git 仓库里）——
  `--setting-sources`/`--effort` 修复、粘贴确认重试、tmux 高度、诊断日志、
  abort signal 透传、`mysteryCcBusy` 单飞保护。

### 7.4 已知边界
- AI 玩家只能是群聊里真实存在的成员（`api` 会话 / claude-code / codex）；
  主持人不是 AI，是本地脚本，不消耗额度。
- 一个群聊同时只有一局剧本杀；「结束本局」会清掉该群的存档，也会清理 VPS
  上对应角色的隔离线程/会话。
- 游戏发言存在前端 store，不进群聊后端的消息流——刻意如此，避免把角色
  私密语境混进群聊后端历史。
- CC 隔离线程并发上限 4 个（保护共享 VPS 内存），超限会收到清晰错误而不是
  静默排队。

---

## 8. 第四阶段：清理/中断和 CC 轮询之间的最后一个真实 bug（2026-08-03/04）

7.2 的两个根因修完、推上 main 之后，另一个人（guyu415，用 codex 帮忙）在
`MysteryGameRoom.jsx` 加了一层客户端自动恢复（`runCcTurnWithRecovery`，见
`git log` 里的 e6eb211/c8792b7/85e5842）：给 CC 单独设了 30 秒"卡住检测"，
卡住就调用 `/mystery/cleanup` 杀掉这个角色的隔离会话再重试一次，并且给每一
局游戏加了独立的 `runId`（不再直接拿 `chatId` 当 gameId），避免"刚结束的
上一局"和"刚开的这一局"撞到同一个隔离线程。这些前端改动本身没问题，但改完
之后用户反馈"CC 还是不说话，让 codex 修了两次都没用"——因为这层新加的自动
恢复逻辑，会比以前更频繁地触发一个后端一直存在、从没暴露过的真实 bug。

**真实根因**：`mysteryCleanupGame`（结束本局 / 自动恢复都会调用它）会直接
`tmuxKill` 掉这个角色的 tmux 会话——但如果这时候**另一个还在轮询的
`/mystery/turn` 请求**正等着这同一个会话给出完成标记，它对这次 kill 一无
所知（那是完全不同的一次 HTTP 请求，没有任何信号会通知到它），只能傻等到
完整的 110 秒超时才会释放 `mysteryCcBusy`。这段时间里，这个角色的任何新
发言请求都会被"上一轮还没结束"直接拒绝——包括自动恢复逻辑自己发起的重试！
现场复现完全对上用户报告的日志：`mystery_cleanup` 在 18:03:38 触发，
一个全新创建、干净等待的 tmux 会话在 18:03:39 建好，但发送前就被
"上一轮还没结束"拦下，白白浪费掉，一直卡到 18:05:01（110 秒后）才恢复。

**修复**：`mysteryCcSendTurn` 的轮询循环里，每一轮除了检查 abort 信号，
现在也会检查 `tmuxHasSession(tmuxName)`——一旦发现自己在等的会话已经不
存在了（不管是被 cleanup 杀的、还是别的原因），立刻抛出"会话已被清理"并
释放 `mysteryCcBusy`，不用等满 110 秒。

**验证**（现场复现原始故障场景后确认修复）：发起一个真实 CC 请求不管它，
4 秒后调用 `/mystery/cleanup` 打断它（模拟结束本局/自动恢复中途介入）——
修复前这会让这个角色卡住到 110 秒；修复后，第一个请求在 cleanup 之后
**686 毫秒**内就干净地报错结束，紧接着对同一个角色发起的新请求**立刻**
正常拿到真实回复。之后连续 5 次同角色发言全部成功。

### 8.1 涉及文件
- `/opt/ai-companion/channel-server.ts`（VPS 上，不在这个 git 仓库里）——
  `mysteryCcSendTurn` 轮询循环新增 `tmuxHasSession` 检查。
- 前端的 `runId`/自动恢复/跳过时清理会话（`MysteryGameRoom.jsx`、
  `mysteryEngine.js`）是另一个人加的，这次没有改动，只是确认它们和这个
  后端修复配合起来能正常工作。

## 9. 第五阶段：CC「还是不说话」的又一个真实根因——Enter 被粘贴防抖吞掉且不再显示占位符（2026-08-04）

用户报告修完第 8 节的 bug 后 CC 在真实游戏里仍然不说话。日志还原了完整现场
（03:37–03:44 的真实一局）：

1. 第一回合发出后 30 秒内没有任何输出，前端 30 秒卡住判定触发，杀会话重试；
2. 重试后**又是 110 秒超时，全程零输出**；
3. 卡死的 tmux 会话被完整保留了下来——`capture-pane` 直接抓到铁证：
   **~690 字的指令全文原样躺在输入框里，从来没有被提交**。

**真实根因**：`tmux send-keys -l` 的字符爆发会触发 Claude Code 输入框的
粘贴防抖，紧跟着发出的 Enter 被当作爆发的一部分吞掉——这本身是第 6 节就
发现过的老问题，但当时的表现是折叠成 "[Pasted text #N]" 占位符，修复也
只认占位符（`PENDING_PASTE_RE`）。而现在的 Claude Code v2.1.221 对这种
长度（~690 字）的单行指令**不再折叠占位符**：全文原样留在输入框里。于是
占位符检测一次都不命中，第一次轮询就误判"已提交"，从此不再补 Enter，
消息坐满 110 秒直到超时。现场只补发一个 Enter，消息立即提交、回复正常
生成——机制 100% 确认。

**修复**（`/opt/ai-companion/channel-server.ts`，VPS）：
- 发送指令文本后先等 250ms 再发 Enter，让输入框把字符爆发消化完，降低
  Enter 被吞的概率；
- 轮询循环里的"已提交"判定不再依赖占位符长相，改为直接看输入框本身：
  pane 里最后一行以 `❯` 开头的就是输入框（已提交消息的回显也带 `❯` 但
  永远在上方），它还包含指令开头（或粘贴占位符）就说明没提交成功，补一个
  Enter（最多 10 次，事件 `mystery_cc_unsubmitted_input_detected`）。
  输入框为空时多余的 Enter 是 no-op，宁可多补不可漏补。

**顺带修复**（前端 `MysteryGameRoom.jsx`）：30 秒卡住判定放宽到 60/90 秒。
之前实测到过 33 秒的合法回合，30 秒阈值会误杀真实生成中的回合（本次日志里
03:38:05 的那次 cleanup 正是它触发的），销毁会话、丢掉回复、还放大清理与
轮询之间的竞态。根因已在后端根治，这层超时只是兜底，不该当第一道防线。

**验证**：用和卡死现场同一条 ~690 字长指令，走真实 `/mystery/turn` 接口
连续 5 回合全部成功（6.5s / 2.1s / 3.0s / 4.0s / 2.1s），无一次超时、
无一次需要补 Enter（250ms 停顿已足够；补 Enter 逻辑作为兜底保险保留，
其判定方式已在真实卡死现场直接验证）。
