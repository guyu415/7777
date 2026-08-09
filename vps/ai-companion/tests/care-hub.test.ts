import { describe, expect, it } from 'vitest'
import { careRoleIsDue, defaultCareHubState, isValidCareTime, ledgerMonthSummary, normalizeCareHubState, sanitizeCareRoleConfig, zonedDateTime } from '../care-hub'

describe('care hub', () => {
  it('validates push time and sanitizes role config', () => {
    expect(isValidCareTime('08:05')).toBe(true)
    expect(isValidCareTime('24:00')).toBe(false)
    const role = defaultCareHubState().config.roles.news
    expect(sanitizeCareRoleConfig(role, { time: '07:30', runtime: 'claude-code', model: '' })).toMatchObject({ time: '07:30', runtime: 'claude-code', model: '' })
    expect(sanitizeCareRoleConfig(role, { runtime: 'gemini', model: 'gemini-3.5-flash-lite' })).toMatchObject({ runtime: 'gemini', model: 'gemini-3.5-flash-lite' })
  })

  it('defaults scheduled care to lightweight subscription models', () => {
    const roles = defaultCareHubState().config.roles
    expect(roles.news.model).toBe('gpt-5.6-luna')
    expect(roles.almanac.model).toBe('gpt-5.4-mini')
  })

  it('uses Shanghai wall time and only runs once per day', () => {
    expect(zonedDateTime(new Date('2026-08-09T00:05:00Z'), 'Asia/Shanghai')).toEqual({ date: '2026-08-09', time: '08:05' })
    const role = defaultCareHubState().config.roles.news
    expect(careRoleIsDue(role, '2026-08-09', '08:05')).toBe(true)
    expect(careRoleIsDue({ ...role, lastAttemptDate: '2026-08-09' }, '2026-08-09', '08:05')).toBe(false)
  })

  it('keeps fixed slots when loading partial old state', () => {
    const state = normalizeCareHubState({ config: { roles: { news: { enabled: false, time: '09:00' } } } })
    expect(state.config.roles.news.enabled).toBe(false)
    expect(state.config.roles.ledger).toBeTruthy()
    expect(state.config.timezone).toBe('Asia/Shanghai')
  })

  it('builds visual-ledger totals by month and category', () => {
    const result = ledgerMonthSummary([
      { id: '1', amount: 12.5, category: '餐饮', note: '', date: '2026-08-01', ts: 1 },
      { id: '2', amount: 20, category: '餐饮', note: '', date: '2026-08-02', ts: 2 },
      { id: '3', amount: 8, category: '交通', note: '', date: '2026-07-31', ts: 3 },
    ], '2026-08')
    expect(result).toEqual({ total: 32.5, byCategory: { 餐饮: 32.5 }, count: 2 })
  })
})
