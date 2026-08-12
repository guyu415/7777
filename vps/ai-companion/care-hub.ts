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
  ledger: { monthlyBudget: number; dailyBudget: number; entries: LedgerEntry[] }
  study: { goals: StudyGoal[] }
  updatedAt: number
  runningRole?: CareRoleId | null
}

export function defaultCareHubState(now = Date.now()): CareHubState {
  return {
    config: {
      timezone: 'Asia/Shanghai',
      roles: {
        news: { enabled: true, time: '08:00', runtime: 'codex', model: 'gpt-5.6-luna' },
        almanac: { enabled: true, time: '08:05', runtime: 'codex', model: 'gpt-5.6-luna' },
        ledger: { enabled: true, time: '21:00', runtime: 'codex', model: 'gpt-5.6-luna' },
        study: { enabled: true, time: '21:30', runtime: 'codex', model: 'gpt-5.6-luna' },
      },
    },
    messages: [],
    ledger: { monthlyBudget: 0, dailyBudget: 0, entries: [] },
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
  const goals = Array.isArray(input.study?.goals) ? input.study.goals.filter((g: any) => typeof g?.title === 'string' && g.title.trim()).slice(-500) : []
  return {
    config: { timezone: 'Asia/Shanghai', roles },
    messages,
    ledger: {
      monthlyBudget: Math.max(0, Number(input.ledger?.monthlyBudget) || 0),
      dailyBudget: Math.max(0, Number(input.ledger?.dailyBudget) || 0),
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

export function careIsSevereOverspend(monthlyBudget: number, total: number): boolean {
  return Number.isFinite(monthlyBudget) && monthlyBudget > 0 && Number.isFinite(total) && total >= monthlyBudget * 1.1
}

export function careOverdueDays(targetDate: string | undefined, today: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return 0
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${targetDate}T00:00:00Z`)) / 86_400_000)
  return Number.isFinite(days) ? Math.max(0, days) : 0
}
import { Solar } from 'lunar-javascript'
