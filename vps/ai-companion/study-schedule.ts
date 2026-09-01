// The timetable in the user's reference image is for the formal public-exam
// subjects. Keep the old preparation subjects accepted below so a previously
// saved schedule is not discarded when the vocabulary changes.
export const STUDY_SUBJECTS = ['职测', '综测', '非法', '法律'] as const
export const LEGACY_STUDY_SUBJECTS = ['言语', '判推', '数资', '申论'] as const
export const ALL_STUDY_SUBJECTS = [...STUDY_SUBJECTS, ...LEGACY_STUDY_SUBJECTS] as const
export const STUDY_STAGES = ['基础', '带背', '背诵', '刷题', '强化班', '冲刺', '模考'] as const
export const STUDY_SLOTS = ['morning', 'afternoon'] as const

export type StudySubject = typeof ALL_STUDY_SUBJECTS[number]
export type StudyStage = typeof STUDY_STAGES[number]
export type StudySlot = typeof STUDY_SLOTS[number]
export type StudyCourse = { subject: StudySubject; stage: StudyStage }
export type StudyScheduleState = {
  entries: Record<string, Partial<Record<StudySlot, StudyCourse>>>
  updatedAt: number
}

type SeedCourse = {
  date: string
  subject: StudySubject
  stage: StudyStage
  slots?: readonly StudySlot[]
}

// Only the two daytime course blocks are represented here. Early self-study,
// evening exercises, mock/review blocks, special study, public holidays and
// other arrangements are intentionally left blank per the supplied timetable.
const FORMAL_SCHEDULE_SEED: readonly SeedCourse[] = [
  { date: '2026-09-01', subject: '职测', stage: '基础' },
  { date: '2026-09-02', subject: '职测', stage: '基础' },
  { date: '2026-09-03', subject: '职测', stage: '基础' },
  { date: '2026-09-12', subject: '综测', stage: '基础' },
  { date: '2026-09-13', subject: '综测', stage: '基础' },
  { date: '2026-09-14', subject: '综测', stage: '基础' },
  { date: '2026-09-19', subject: '综测', stage: '基础' },
  { date: '2026-09-20', subject: '综测', stage: '基础' },
  { date: '2026-09-25', subject: '法律', stage: '基础' },
  { date: '2026-09-26', subject: '法律', stage: '基础' },
  { date: '2026-09-27', subject: '法律', stage: '基础' },
  { date: '2026-09-28', subject: '法律', stage: '基础' },
  { date: '2026-10-02', subject: '法律', stage: '基础', slots: ['morning'] },
  { date: '2026-10-02', subject: '非法', stage: '基础', slots: ['afternoon'] },
  { date: '2026-10-03', subject: '非法', stage: '基础' },
  { date: '2026-10-04', subject: '非法', stage: '基础' },
  { date: '2026-10-05', subject: '非法', stage: '基础' },
  { date: '2026-10-06', subject: '非法', stage: '基础' },
  { date: '2026-10-07', subject: '非法', stage: '基础' },
  { date: '2026-10-10', subject: '法律', stage: '带背' },
  { date: '2026-10-11', subject: '法律', stage: '带背' },
  { date: '2026-10-12', subject: '法律', stage: '带背' },
  { date: '2026-10-13', subject: '法律', stage: '刷题' },
  { date: '2026-10-14', subject: '法律', stage: '刷题' },
  { date: '2026-10-17', subject: '非法', stage: '带背' },
  { date: '2026-10-18', subject: '非法', stage: '带背' },
  { date: '2026-10-19', subject: '非法', stage: '带背' },
  { date: '2026-10-20', subject: '非法', stage: '带背' },
  { date: '2026-10-21', subject: '非法', stage: '带背' },
  { date: '2026-10-24', subject: '非法', stage: '刷题' },
  { date: '2026-10-25', subject: '非法', stage: '刷题' },
  { date: '2026-10-26', subject: '非法', stage: '刷题' },
  { date: '2026-10-28', subject: '综测', stage: '刷题' },
  { date: '2026-10-29', subject: '综测', stage: '刷题' },
  { date: '2026-10-30', subject: '综测', stage: '刷题' },
  { date: '2026-11-01', subject: '法律', stage: '冲刺' },
  { date: '2026-11-02', subject: '法律', stage: '冲刺' },
  { date: '2026-11-03', subject: '法律', stage: '冲刺' },
  { date: '2026-11-05', subject: '非法', stage: '冲刺' },
  { date: '2026-11-06', subject: '非法', stage: '冲刺' },
  { date: '2026-11-07', subject: '非法', stage: '冲刺' },
  { date: '2026-11-08', subject: '非法', stage: '冲刺' },
  { date: '2026-11-10', subject: '综测', stage: '冲刺' },
  { date: '2026-11-11', subject: '综测', stage: '冲刺' },
]

function seededEntries() {
  const entries: StudyScheduleState['entries'] = {}
  for (const item of FORMAL_SCHEDULE_SEED) {
    const slots = item.slots || STUDY_SLOTS
    const day = entries[item.date] || {}
    for (const slot of slots) day[slot] = { subject: item.subject, stage: item.stage }
    entries[item.date] = day
  }
  return entries
}

// Used only when the server has no persisted schedule file yet. Once the
// first edit is saved, the file becomes authoritative and users can clear
// entries without them being re-created on restart.
export function seededStudySchedule(now = Date.now()): StudyScheduleState {
  return { entries: seededEntries(), updatedAt: now }
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
      if (ALL_STUDY_SUBJECTS.includes(course?.subject) && STUDY_STAGES.includes(course?.stage)) {
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
    if (!ALL_STUDY_SUBJECTS.includes(course.subject) || !STUDY_STAGES.includes(course.stage)) throw new Error('课程无效')
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
