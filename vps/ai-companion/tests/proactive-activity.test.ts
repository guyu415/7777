import { describe, expect, test } from 'bun:test'
import { formatProactiveActivityMessage, shouldQueueDuringProactiveTurn } from '../proactive-activity.ts'

describe('visible proactive activities', () => {
  test('keeps the complete multi-line activity list in the chat message', () => {
    expect(formatProactiveActivityMessage('🎣 自主活动 · 钓鱼', '第一竿：鲫鱼\n第二竿：旧宝箱\n📊 等级 3')).toBe(
      '🎣 自主活动 · 钓鱼\n第一竿：鲫鱼\n第二竿：旧宝箱\n📊 等级 3',
    )
  })

  test('removes unsafe controls without collapsing readable line breaks', () => {
    expect(formatProactiveActivityMessage('🌿 自主活动\n花园', '看了帖子\u0000\n回了一句话')).toBe(
      '🌿 自主活动 花园\n看了帖子\n回了一句话',
    )
  })

  test('only queues an interjection behind the active proactive turn', () => {
    expect(shouldQueueDuringProactiveTurn('proactive-1', 'proactive-1')).toBe(true)
    expect(shouldQueueDuringProactiveTurn('ordinary-1', 'proactive-1')).toBe(false)
    expect(shouldQueueDuringProactiveTurn(null, null)).toBe(false)
  })
})
