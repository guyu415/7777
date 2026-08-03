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
- [ ] VPS runtime（claude-code / codex）作为 AI 玩家：需后端提供无状态单次调用接口。
- [ ] 第二个剧本、第二个游戏（扑克）——入口已预留，加数据即可。
- [ ] 语音/朗读、角色立绘等表现层增强。

---

## 5. 已知边界（写清楚，别当 bug 重修）

- AI 玩家只能是 `api` 类群成员；VPS runtime 本版不可选（原因见 1.1）。
- 主持人不是 AI，是本地脚本；不消耗额度。
- 一个群聊同时只有一局剧本杀；「结束本局」会清掉该群的存档。
- 游戏发言存在前端 store，不进群聊后端的消息流——刻意如此，
  避免把角色私密语境混进群聊后端历史。
