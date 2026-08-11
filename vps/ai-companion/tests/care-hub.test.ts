import { describe, expect, it } from 'vitest'
import { baziSolarMonthContext, careIsSevereOverspend, careOverdueDays, careRoleIsDue, defaultCareHubState, isValidCareTime, ledgerMonthSummary, ledgerPeriodForDate, ledgerPeriodSummary, normalizeCareHubState, sanitizeCareRoleConfig, zonedDateTime } from '../care-hub'

describe('care hub', () => {
  it('validates push time and sanitizes role config', () => {
    expect(isValidCareTime('08:05')).toBe(true)
    expect(isValidCareTime('24:00')).toBe(false)
    const role = defaultCareHubState().config.roles.news
    expect(sanitizeCareRoleConfig(role, { time: '07:30', runtime: 'claude-code', model: '' })).toMatchObject({ time: '07:30', runtime: 'claude-code', model: '' })
    expect(sanitizeCareRoleConfig(role, { runtime: 'gemini', model: 'gemini-3.5-flash-lite' })).toMatchObject({ runtime: 'gemini', model: 'gemini-3.5-flash-lite' })
  })

  it('defaults every scheduled care role to ChatGPT-authenticated Luna', () => {
    const roles = defaultCareHubState().config.roles
    for (const role of Object.values(roles)) {
      expect(role.runtime).toBe('codex')
      expect(role.model).toBe('gpt-5.6-luna')
    }
  })

  it('uses Shanghai wall time and only runs once per day', () => {
    expect(zonedDateTime(new Date('2026-08-09T00:05:00Z'), 'Asia/Shanghai')).toEqual({ date: '2026-08-09', time: '08:05' })
    const role = defaultCareHubState().config.roles.news
    expect(careRoleIsDue(role, '2026-08-09', '08:05')).toBe(true)
    expect(careRoleIsDue({ ...role, lastAttemptDate: '2026-08-09' }, '2026-08-09', '08:05')).toBe(false)
  })

  it('switches the bazi month pillar at the exact solar-term boundary', () => {
    expect(baziSolarMonthContext(new Date('2026-08-07T10:00:00Z')).pillar).toBe('乙未')
    expect(baziSolarMonthContext(new Date('2026-08-07T12:00:00Z'))).toMatchObject({ pillar: '丙申', boundaryName: '立秋' })
    expect(baziSolarMonthContext(new Date('2026-08-10T00:05:00Z')).pillar).toBe('丙申')
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

  it('supports a custom monthly ledger start day', () => {
    expect(ledgerPeriodForDate('2026-08-11', 15)).toEqual({ start: '2026-07-15', end: '2026-08-14' })
    expect(ledgerPeriodForDate('2026-08-15', 15)).toEqual({ start: '2026-08-15', end: '2026-09-14' })
    expect(ledgerPeriodForDate('2026-03-01', 31)).toEqual({ start: '2026-02-28', end: '2026-03-30' })
    expect(ledgerPeriodSummary([
      { id: '1', amount: 10, category: '餐饮', note: '', date: '2026-07-14', ts: 1 },
      { id: '2', amount: 20, category: '餐饮', note: '', date: '2026-07-15', ts: 2 },
      { id: '3', amount: 5, category: '交通', note: '', date: '2026-08-14', ts: 3 },
      { id: '4', amount: 99, category: '购物', note: '', date: '2026-08-15', ts: 4 },
    ], '2026-08-11', 15)).toMatchObject({ total: 25, count: 2, byCategory: { 餐饮: 20, 交通: 5 } })
  })

  it('normalizes old goals and the new recurring schedules', () => {
    const state = normalizeCareHubState({
      ledger: { monthStartDay: 40 },
      study: { goals: [
        { id: 'old', title: '旧目标', done: false },
        { id: 'daily', title: '每日目标', schedule: 'daily', completedDates: ['2026-08-11', 'bad'] },
        { id: 'dates', title: '多日目标', schedule: 'dates', dates: ['2026-08-12', '2026-08-11', '2026-08-11'] },
      ] },
    })
    expect(state.ledger.monthStartDay).toBe(31)
    expect(state.study.goals[0].schedule).toBe('once')
    expect(state.study.goals[1].completedDates).toEqual(['2026-08-11'])
    expect(state.study.goals[2].dates).toEqual(['2026-08-11', '2026-08-12'])
  })

  it('only escalates genuinely severe overspending and overdue goals', () => {
    expect(careIsSevereOverspend(1000, 1099)).toBe(false)
    expect(careIsSevereOverspend(1000, 1100)).toBe(true)
    expect(careIsSevereOverspend(0, 9999)).toBe(false)
    expect(careOverdueDays('2026-08-06', '2026-08-09')).toBe(3)
    expect(careOverdueDays('2026-08-10', '2026-08-09')).toBe(0)
  })
})
