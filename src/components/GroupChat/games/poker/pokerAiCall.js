// 斗地主和炸金花共用的 AI 调用入口——和 MysteryGameRoom.jsx 的
// callCharacterModel 走同样两条真实路径（claude-code/codex 用 VPS 上为这
// 一局单独开的隔离会话；'api' 成员用该会话自己的 apiKey/baseUrl 直接
// streamChat），复用同一套"群成员原本配置的模型和角色身份"的解析逻辑
// （resolveGroupMemberInfo / resolveApiMemberConfig），不是另起一套。
//
// 和剧本杀的关键差别：这里绝不重试、绝不做"自动重连"式的恢复等待——扑克
// 每一步决策的提示词很短（只是"选一个合法索引"），10 秒思考不到基本就是
// 真卡住了，卡了就立刻判定失败，交给调用方走自动托管，而不是像剧本杀那样
// 再等几十秒。这是"AI 超时/报错/格式错误时立即自动托管，绝不能卡住整局"
// 这条硬要求在这一层的落地。

import { streamChat } from '../../../../services/claude'
import { runMysteryTurn, cleanupMysteryGame } from '../../../../services/companion'
import { resolveGroupMemberInfo, isVpsMemberId } from '../../../../utils/groupMembers'
import { resolveApiMemberConfig } from '../../../../utils/groupApiMember'

export const AI_THINK_TIMEOUT_MS = 10000

// 拿到模型的原始文字回复；超时/无 API Key/请求失败统一以 throw 的方式冒泡，
// 调用方（房间组件）catch 到任何异常都必须走自动托管，不重试。
export async function callSeatForPokerDecision({ runId, charId, seat, sessions, globals, systemPrompt, turnPrompt, timeoutMs = AI_THINK_TIMEOUT_MS }) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    if (isVpsMemberId(seat.memberId)) {
      return await runMysteryTurn(runId, charId, seat.memberId, seat.model || '', systemPrompt, turnPrompt, controller.signal)
    }
    const info = resolveGroupMemberInfo(seat.memberId, sessions)
    const cfg = resolveApiMemberConfig(info.session, globals)
    if (!cfg.apiKey) throw new Error(`${info.name} 没有可用的 API Key（本会话、当前供应商、全局默认都没设置）`)
    let full = ''
    for await (const part of streamChat({
      apiKey: cfg.apiKey,
      apiBaseUrl: cfg.baseUrl,
      model: seat.model || cfg.model,
      systemPrompt,
      messages: [{ role: 'user', type: 'text', content: turnPrompt }],
      workerUrl: globals?.workerUrl,
      useWorkerProxy: globals?.useWorkerProxy,
      providerName: cfg.providerName,
      disableThinking: cfg.disableThinking,
      signal: controller.signal,
    })) {
      if (part.text) full += part.text
    }
    return full
  } finally {
    clearTimeout(timer)
  }
}

// 出问题时的兜底清理——只对 claude-code/codex 座位有意义（它们是这一局
// 单独开的隔离会话，可能真的卡住了）；'api' 座位没有这种会话概念，不用管。
// 后台尽力清理，不阻塞、不等待、失败也无所谓：反正下一次决策会按最新的
// systemPrompt/turnPrompt 重新建一个隔离会话，不影响这名成员的单聊/群聊
// 记忆，也不影响其它座位。
export function cleanupStuckSeat(runId, charId, seat) {
  if (seat?.memberId === 'claude-code' || seat?.memberId === 'codex') {
    cleanupMysteryGame(runId, [charId]).catch(() => {})
  }
}

// 座位自己的系统提示词——沿用它在群里本来的人设（如果有的话），加一段
// 通用的"这是真牌局，只回数字"框定。两个游戏共用同一套框定文字，只有
// gameLabel 不同。
export function buildPokerSystemPrompt(personaPrompt, gameLabel, identity = '') {
  const persona = (personaPrompt || '').trim()
  return [
    persona ? `你的人设/身份设定：\n${persona}` : '',
    identity ? `你在这局牌里的身份是“${identity}”。真人玩家统一称为“用户”；你只能代表“${identity}”行动，绝不能把自己当成用户或其他牌友。` : '',
    `你现在和用户一起玩${gameLabel}。这是一局真实的、由程序判定合法性的牌局，不是聊天。`,
    '每一轮我会把你自己的手牌（只有你自己的，看不到别人的）、桌面公开信息和这一步能选的合法操作列出来，你只需要回复对应操作前面的那个数字，不要输出任何其他文字、不要描述你的牌、不要自己判断合不合法——合法性已经由程序保证，你只管从给出的选项里选。',
  ].filter(Boolean).join('\n\n')
}
