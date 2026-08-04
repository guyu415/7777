// 思维链只保留近 N 轮（一轮 = 一条用户消息起、到下一条用户消息前的区间）。
// 更早的 assistant 消息上挂着的 reasoning/reasoningStreaming 字段被整体移除
// —— 清的是持久化在本地 IndexedDB / 云端 KV 里的展示副本；发给模型的请求
// 本来就只带 role+content（见 services/claude.js buildMessages），CC/Anthropic
// 也自动丢弃历史轮的 thinking，所以模型上下文里从来不会积累旧思维链。
// 返回 { changed, messages }：changed 是被剥掉思维链后的新消息对象（供调用方
// 持久化），messages 是整个列表的新版本。不足 N 轮时原样返回。
// 独立于 hooks/services 的纯函数模块，便于无浏览器环境下单元测试。
export function pruneReasoningBeyondTurns(messages, keepTurns = 5) {
  let userSeen = 0
  let cutoffIdx = -1 // messages[cutoffIdx..] 保留思维链
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userSeen++
      if (userSeen === keepTurns) { cutoffIdx = i; break }
    }
  }
  if (cutoffIdx <= 0) return { changed: [], messages }
  const changed = []
  const out = messages.map((m, i) => {
    if (i >= cutoffIdx) return m
    if (m.role === 'assistant' && (m.reasoning !== undefined || m.reasoningStreaming !== undefined)) {
      const { reasoning, reasoningStreaming, ...rest } = m
      changed.push(rest)
      return rest
    }
    return m
  })
  return { changed, messages: out }
}
