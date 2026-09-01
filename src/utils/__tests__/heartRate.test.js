import { describe, expect, it } from 'vitest'
import { extractHeartRate, heartBeatDurationMs, isHeartRateTool } from '../heartRate'

describe('heart-rate tool effect', () => {
  it('recognizes explicit heart reads without treating generic health reads as heart rate', () => {
    expect(isHeartRateTool('health_latest')).toBe(false)
    expect(isHeartRateTool('mcp__apple_health__health_current_context')).toBe(false)
    expect(isHeartRateTool('health_query', 'HKQuantityTypeIdentifierHeartRate')).toBe(true)
    expect(isHeartRateTool('health_query', 'HKQuantityTypeIdentifierOxygenSaturation')).toBe(false)
  })

  it('extracts BPM from Chinese, English and HealthKit-shaped replies', () => {
    expect(extractHeartRate('最近一次心率：83 次/分')).toBe(83)
    expect(extractHeartRate('Apple Watch shows 71 BPM.')).toBe(71)
    expect(extractHeartRate('{"type":"HKQuantityTypeIdentifierHeartRate","value":96,"unit":"count/min"}')).toBe(96)
  })

  it('rejects unrelated or implausible numbers', () => {
    expect(extractHeartRate('今日步数 12,804，数据时间 2026-09-01')).toBeNull()
    expect(extractHeartRate('心率：999 BPM')).toBeNull()
  })

  it('maps BPM to one beat cycle', () => {
    expect(heartBeatDurationMs(60)).toBe(1000)
    expect(heartBeatDurationMs(120)).toBe(500)
    expect(heartBeatDurationMs(null)).toBe(833)
  })
})

