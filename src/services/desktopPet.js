// 桌宠手势目录——纯数据，不含任何模型调用逻辑。真正的"回应"完全走
// useChat()/useCodexChat() 这条和主聊天窗一模一样的真实链路（见
// DesktopPet.jsx），这里只负责：手势 id → 本地动效/标记，以及把累计的
// 手势次数汇总成一句话交给那条真实链路。
export const GESTURES = [
  { id: 'pet', label: '摸', unit: '下', mark: '♡', motion: 'pet' },
  { id: 'pinch', label: '捏脸', unit: '下', mark: 'ˋ', motion: 'pinch' },
  { id: 'bonk', label: '锤', unit: '下', mark: '!', motion: 'bonk' },
  { id: 'lift', label: '拎起来晃', unit: '次', mark: '？', motion: 'lift' },
]

export function findGesture(id) {
  return GESTURES.find((g) => g.id === id) || GESTURES[0]
}

export function emptyGestureCounts() {
  return { pet: 0, pinch: 0, bonk: 0, lift: 0 }
}

export function totalGestureCount(counts) {
  return GESTURES.reduce((sum, g) => sum + (counts[g.id] || 0), 0)
}

// 用于真实发给模型那条消息——主聊天窗里 <i>动作内容</i> 已经是被
// MessageBubble 支持的"动作描写"格式（见 ChatWindow 的 renderWithActions），
// 这里直接复用，不需要新样式。
export function buildGestureReport(counts) {
  const parts = GESTURES
    .filter((g) => counts[g.id] > 0)
    .map((g) => `${g.label}了${counts[g.id]}${g.unit}`)
  if (!parts.length) return ''
  return `<i>${parts.join('，')}</i>`
}

// 用于"要不要带上"确认弹窗里给用户看的大白话版本（不带 <i> 标签）。
export function describeGestureCounts(counts) {
  const parts = GESTURES
    .filter((g) => counts[g.id] > 0)
    .map((g) => `${g.label}了${counts[g.id]}${g.unit}`)
  return parts.join('、')
}
