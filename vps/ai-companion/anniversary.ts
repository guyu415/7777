export type AnniversaryEvent = { id: string; text: string; ts: number }
export type AnniversaryState = { entries: Record<string, AnniversaryEvent[]>; updatedAt: number }

export function isAnniversaryDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function defaultAnniversaryState(now = Date.now()): AnniversaryState {
  return { entries: {}, updatedAt: now }
}

export function normalizeAnniversaryState(raw: unknown, now = Date.now()): AnniversaryState {
  const state = defaultAnniversaryState(now)
  if (!raw || typeof raw !== 'object') return state
  const input = raw as any
  if (!input.entries || typeof input.entries !== 'object') return state
  for (const [date, events] of Object.entries(input.entries)) {
    if (!isAnniversaryDate(date) || !Array.isArray(events)) continue
    const day = events
      .filter((event: any) => typeof event?.id === 'string' && typeof event?.text === 'string' && event.text.trim() && Number.isFinite(event?.ts))
      .map((event: any) => ({ id: event.id, text: event.text.trim().slice(0, 500), ts: event.ts }))
      .slice(-200)
    if (day.length) state.entries[date] = day
  }
  state.updatedAt = Number(input.updatedAt) || now
  return state
}

export function addAnniversaryEvent(state: AnniversaryState, date: string, text: string, now = Date.now()): AnniversaryState {
  if (!isAnniversaryDate(date)) throw new Error('日期无效')
  const trimmed = text.trim().slice(0, 500)
  if (!trimmed) throw new Error('内容不能为空')
  const next = normalizeAnniversaryState(state, now)
  const day = next.entries[date] ? [...next.entries[date]] : []
  day.push({ id: `${date}-${now}-${Math.random().toString(36).slice(2, 8)}`, text: trimmed, ts: now })
  next.entries[date] = day.slice(-200)
  next.updatedAt = now
  return next
}

export function deleteAnniversaryEvent(state: AnniversaryState, date: string, id: string, now = Date.now()): AnniversaryState {
  if (!isAnniversaryDate(date)) throw new Error('日期无效')
  const next = normalizeAnniversaryState(state, now)
  const day = next.entries[date]
  if (!day) throw new Error('记录不存在')
  const filtered = day.filter(event => event.id !== id)
  if (filtered.length === day.length) throw new Error('记录不存在')
  if (filtered.length) next.entries[date] = filtered
  else delete next.entries[date]
  next.updatedAt = now
  return next
}

export function anniversaryRange(state: AnniversaryState, startDate: string, endDate: string) {
  if (!isAnniversaryDate(startDate) || !isAnniversaryDate(endDate) || startDate > endDate) throw new Error('日期范围无效')
  const span = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000)
  if (span > 366) throw new Error('单次最多读取 367 天')
  return Object.fromEntries(Object.entries(state.entries).filter(([date]) => date >= startDate && date <= endDate))
}
