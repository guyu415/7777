export const STUDY_SUBJECTS = ['言语', '判推', '数资', '申论'] as const
export const STUDY_STAGES = ['基础', '刷题', '强化班'] as const
export const STUDY_SLOTS = ['morning', 'afternoon'] as const

export type StudySubject = typeof STUDY_SUBJECTS[number]
export type StudyStage = typeof STUDY_STAGES[number]
export type StudySlot = typeof STUDY_SLOTS[number]
export type StudyCourse = { subject: StudySubject; stage: StudyStage }
export type StudyScheduleState = {
  entries: Record<string, Partial<Record<StudySlot, StudyCourse>>>
  updatedAt: number
}

export function isStudyDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function defaultStudySchedule(now = Date.now()): StudyScheduleState {
  return { entries: {}, updatedAt: now }
}

export function normalizeStudySchedule(raw: unknown, now = Date.now()): StudyScheduleState {
  const state = defaultStudySchedule(now)
  if (!raw || typeof raw !== 'object') return state
  const input = raw as any
  if (!input.entries || typeof input.entries !== 'object') return state
  for (const [date, slots] of Object.entries(input.entries)) {
    if (!isStudyDate(date) || !slots || typeof slots !== 'object') continue
    const day: Partial<Record<StudySlot, StudyCourse>> = {}
    for (const slot of STUDY_SLOTS) {
      const course = (slots as any)[slot]
      if (STUDY_SUBJECTS.includes(course?.subject) && STUDY_STAGES.includes(course?.stage)) {
        day[slot] = { subject: course.subject, stage: course.stage }
      }
    }
    if (Object.keys(day).length) state.entries[date] = day
  }
  state.updatedAt = Number(input.updatedAt) || now
  return state
}

export function setStudyCourse(
  state: StudyScheduleState,
  date: string,
  slot: StudySlot,
  course: StudyCourse | null,
  now = Date.now(),
): StudyScheduleState {
  if (!isStudyDate(date)) throw new Error('日期无效')
  if (!STUDY_SLOTS.includes(slot)) throw new Error('时段无效')
  const next = normalizeStudySchedule(state, now)
  if (course) {
    if (!STUDY_SUBJECTS.includes(course.subject) || !STUDY_STAGES.includes(course.stage)) throw new Error('课程无效')
    next.entries[date] = { ...(next.entries[date] || {}), [slot]: course }
  } else if (next.entries[date]) {
    delete next.entries[date][slot]
    if (!Object.keys(next.entries[date]).length) delete next.entries[date]
  }
  next.updatedAt = now
  return next
}

export function studyScheduleRange(state: StudyScheduleState, startDate: string, endDate: string) {
  if (!isStudyDate(startDate) || !isStudyDate(endDate) || startDate > endDate) throw new Error('日期范围无效')
  const span = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000)
  if (span > 62) throw new Error('单次最多读取 63 天')
  return Object.fromEntries(Object.entries(state.entries).filter(([date]) => date >= startDate && date <= endDate))
}
