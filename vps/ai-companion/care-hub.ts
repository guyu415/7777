export const CARE_ROLE_IDS = ['news', 'ledger', 'almanac', 'study'] as const
export type CareRoleId = typeof CARE_ROLE_IDS[number]
export type CareRuntime = 'codex' | 'claude-code' | 'gemini'

export type CareRoleConfig = {
  enabled: boolean
  time: string
  runtime: CareRuntime
  model: string
  lastRunDate?: string
  lastAttemptDate?: string
  lastError?: string
}

export type CareMessage = {
  id: string
  role: CareRoleId
  text: string
  ts: number
  kind: 'report' | 'record' | 'reminder' | 'system'
}

export type LedgerEntry = {
  id: string
  amount: number
  category: string
  note: string
  date: string
  ts: number
  kind: 'daily' | 'longTerm'
}

export type StudyGoal = {
  id: string
  title: string
  targetDate?: string
  schedule?: 'once' | 'daily' | 'dates'
  dates?: string[]
  completedDates?: string[]
  done: boolean
  createdAt: number
  doneAt?: number
}

export type CareHubState = {
  config: {
    timezone: string
    roles: Record<CareRoleId, CareRoleConfig>
  }
  messages: CareMessage[]
  ledger: { monthlyBudget: number; dailyBudget: number; monthStartDay: number; entries: LedgerEntry[] }
  study: { goals: StudyGoal[] }
  updatedAt: number
  runningRole?: CareRoleId | null
}

export function defaultCareHubState(now = Date.now()): CareHubState {
  return {
    config: {
      timezone: 'Asia/Shanghai',
      roles: {
        // The life-care group UI and its scheduled reports were retired. Keep
        // ledger data/API access, but never resurrect notifications merely
        // because the state file is new, missing, or being recovered.
        news: { enabled: false, time: '08:00', runtime: 'codex', model: 'gpt-5.6-luna' },
        almanac: { enabled: false, time: '08:05', runtime: 'codex', model: 'gpt-5.6-luna' },
        ledger: { enabled: false, time: '21:00', runtime: 'codex', model: 'gpt-5.6-luna' },
        study: { enabled: false, time: '21:30', runtime: 'codex', model: 'gpt-5.6-luna' },
      },
    },
    messages: [],
    ledger: { monthlyBudget: 0, dailyBudget: 0, monthStartDay: 1, entries: [] },
    study: { goals: [] },
    updatedAt: now,
  }
}

export function isValidCareTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function zonedDateTime(now: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return { date: `${value('year')}-${value('month')}-${value('day')}`, time: `${value('hour')}:${value('minute')}` }
}

export function baziSolarMonthContext(now: Date, timezone = 'Asia/Shanghai'): { pillar: string; boundaryName: string; boundaryAt: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0)
  const lunar = Solar.fromYmdHms(value('year'), value('month'), value('day'), value('hour'), value('minute'), value('second')).getLunar()
  const boundary = lunar.getPrevJie()
  return {
    pillar: lunar.getEightChar().getMonth(),
    boundaryName: boundary.getName(),
    boundaryAt: boundary.getSolar().toYmdHms(),
  }
}

export function careRoleIsDue(config: CareRoleConfig, date: string, time: string): boolean {
  return config.enabled && time >= config.time && config.lastRunDate !== date && config.lastAttemptDate !== date
}

export function sanitizeCareRoleConfig(previous: CareRoleConfig, patch: unknown): CareRoleConfig {
  if (!patch || typeof patch !== 'object') return previous
  const input = patch as Record<string, unknown>
  const runtime: CareRuntime = input.runtime === 'claude-code' ? 'claude-code' : input.runtime === 'codex' ? 'codex' : input.runtime === 'gemini' ? 'gemini' : previous.runtime
  const fallbackModel = runtime === 'codex' ? 'gpt-5.6-luna' : runtime === 'gemini' ? 'gemini-3.5-flash-lite' : 'claude-haiku-4-5'
  return {
    ...previous,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : previous.enabled,
    time: isValidCareTime(input.time) ? input.time : previous.time,
    runtime,
    model: typeof input.model === 'string' ? input.model.trim().slice(0, 80) : (runtime === previous.runtime ? previous.model : fallbackModel),
  }
}

export function normalizeCareHubState(raw: unknown, now = Date.now()): CareHubState {
  const base = defaultCareHubState(now)
  if (!raw || typeof raw !== 'object') return base
  const input = raw as any
  const roles = { ...base.config.roles }
  for (const id of CARE_ROLE_IDS) roles[id] = { ...sanitizeCareRoleConfig(roles[id], input.config?.roles?.[id]),
    ...(typeof input.config?.roles?.[id]?.lastRunDate === 'string' ? { lastRunDate: input.config.roles[id].lastRunDate } : {}),
    ...(typeof input.config?.roles?.[id]?.lastAttemptDate === 'string' ? { lastAttemptDate: input.config.roles[id].lastAttemptDate } : {}),
    ...(typeof input.config?.roles?.[id]?.lastError === 'string' ? { lastError: input.config.roles[id].lastError.slice(0, 300) } : {}),
  }
  const messages = Array.isArray(input.messages) ? input.messages.filter((m: any) => CARE_ROLE_IDS.includes(m?.role) && typeof m?.text === 'string' && Number.isFinite(m?.ts)).slice(-300) : []
  const entries = Array.isArray(input.ledger?.entries) ? input.ledger.entries
    .filter((e: any) => Number.isFinite(e?.amount) && e.amount > 0 && typeof e?.date === 'string')
    .map((e: any) => ({
      ...e,
      kind: e?.kind === 'longTerm' ? 'longTerm' : 'daily',
    }))
    .slice(-5000) : []
  const goals = Array.isArray(input.study?.goals) ? input.study.goals
    .filter((g: any) => typeof g?.title === 'string' && g.title.trim())
    .map((g: any) => {
      const schedule = g.schedule === 'daily' || g.schedule === 'dates' ? g.schedule : 'once'
      const dates = Array.isArray(g.dates) ? [...new Set(g.dates.filter((date: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(date))))].sort().slice(0, 366) : []
      const completedDates = Array.isArray(g.completedDates) ? [...new Set(g.completedDates.filter((date: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(date))))].sort().slice(-730) : []
      return { ...g, schedule, dates, completedDates }
    }).slice(-500) : []
  return {
    config: { timezone: 'Asia/Shanghai', roles },
    messages,
    ledger: {
      monthlyBudget: Math.max(0, Number(input.ledger?.monthlyBudget) || 0),
      dailyBudget: Math.max(0, Number(input.ledger?.dailyBudget) || 0),
      monthStartDay: Math.min(31, Math.max(1, Math.trunc(Number(input.ledger?.monthStartDay) || 1))),
      entries,
    },
    study: { goals },
    updatedAt: Number(input.updatedAt) || now,
  }
}

export function ledgerMonthSummary(entries: LedgerEntry[], month: string) {
  const selected = entries.filter((entry) => entry.date.startsWith(`${month}-`))
  const byCategory: Record<string, number> = {}
  let total = 0
  for (const entry of selected) {
    total += entry.amount
    byCategory[entry.category] = (byCategory[entry.category] || 0) + entry.amount
  }
  return { total: Math.round(total * 100) / 100, byCategory, count: selected.length }
}

export function ledgerDailySummary(entries: LedgerEntry[], date: string) {
  const selected = entries.filter((entry) => entry.date === date && entry.kind !== 'longTerm')
  const total = selected.reduce((sum, entry) => sum + entry.amount, 0)
  return { total: Math.round(total * 100) / 100, count: selected.length }
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function clampedUtcDate(year: number, month: number, day: number): Date {
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)))
}

export function ledgerPeriodForDate(date: string, monthStartDay = 1): { start: string; end: string } {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date()
  const day = Math.min(31, Math.max(1, Math.trunc(monthStartDay) || 1))
  const candidate = clampedUtcDate(parsed.getUTCFullYear(), parsed.getUTCMonth(), day)
  const start = parsed >= candidate ? candidate : clampedUtcDate(parsed.getUTCFullYear(), parsed.getUTCMonth() - 1, day)
  const next = clampedUtcDate(start.getUTCFullYear(), start.getUTCMonth() + 1, day)
  const end = new Date(next.getTime() - 86_400_000)
  return { start: dateOnly(start), end: dateOnly(end) }
}

export function ledgerPeriodSummary(entries: LedgerEntry[], date: string, monthStartDay = 1) {
  const period = ledgerPeriodForDate(date, monthStartDay)
  const selected = entries.filter((entry) => entry.date >= period.start && entry.date <= period.end)
  const byCategory: Record<string, number> = {}
  let total = 0
  for (const entry of selected) {
    total += entry.amount
    byCategory[entry.category] = (byCategory[entry.category] || 0) + entry.amount
  }
  return { ...period, total: Math.round(total * 100) / 100, byCategory, count: selected.length }
}

export function careIsSevereOverspend(monthlyBudget: number, total: number): boolean {
  return Number.isFinite(monthlyBudget) && monthlyBudget > 0 && Number.isFinite(total) && total >= monthlyBudget * 1.1
}

export function careOverdueDays(targetDate: string | undefined, today: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${targetDate}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(days) ? Math.max(0, days) : 0
}
import { Solar } from 'lunar-javascript'
