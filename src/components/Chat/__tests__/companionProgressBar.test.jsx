import { describe, expect, it } from 'vitest'
import { companionProgressCopy, formatProgressElapsed } from '../CompanionProgressBar'

describe('resident Claude progress bar copy', () => {
  it('distinguishes waiting, work, continuing, and reconnecting phases', () => {
    expect(companionProgressCopy({ phase: 'accepted' }, '小鸡毛').title).toBe('消息已送达')
    expect(companionProgressCopy({ phase: 'working', tool: 'Read' }, '小鸡毛').title).toBe('小鸡毛正在读取文件')
    expect(companionProgressCopy({ phase: 'continuing' }, '小鸡毛').title).toBe('已经回了一条，还没结束')
    expect(companionProgressCopy({ phase: 'reconnecting' }, '小鸡毛').title).toBe('连接波动，正在恢复')
  })

  it('formats a compact, stable elapsed timer', () => {
    expect(formatProgressElapsed(9_900)).toBe('9秒')
    expect(formatProgressElapsed(65_200)).toBe('1:05')
  })
})
