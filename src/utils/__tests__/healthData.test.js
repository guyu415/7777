import { describe, expect, it } from 'vitest'
import { healthDataCategories, isHealthTool } from '../healthData'

describe('health-data tool presentation', () => {
  it('recognizes Apple Health tools without limiting the UI to heart rate', () => {
    expect(isHealthTool('health_latest')).toBe(true)
    expect(isHealthTool('mcp__apple_health__health_current_context')).toBe(true)
    expect(isHealthTool('health_query')).toBe(true)
    expect(isHealthTool('WebSearch')).toBe(false)
  })

  it('splits health metrics found in tool details and replies', () => {
    expect(healthDataCategories(
      [{ tool: 'health_query', detail: 'HKQuantityTypeIdentifierOxygenSaturation' }],
      '最新血氧 98%，今天步数 12,804',
    )).toEqual([
      expect.objectContaining({ id: 'blood-oxygen', label: '血氧' }),
      expect.objectContaining({ id: 'steps', label: '步数' }),
    ])
  })

  it('does not call a generic health read a heart-rate read', () => {
    expect(healthDataCategories([{ tool: 'health_latest', detail: '' }], '')).toEqual([
      { id: 'health-data', label: '健康数据' },
    ])
  })

  it('uses a specific label for dedicated health tools', () => {
    expect(healthDataCategories([{ tool: 'health_workouts', detail: '' }], '')).toEqual([
      expect.objectContaining({ id: 'workout', label: '锻炼' }),
    ])
  })
})
