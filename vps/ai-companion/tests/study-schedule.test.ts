import { describe, expect, it } from 'vitest'
import { defaultStudySchedule, normalizeStudySchedule, seededStudySchedule, setStudyCourse, studyScheduleRange } from '../study-schedule.ts'

describe('study schedule', () => {
  it('sets, reads and clears a course', () => {
    const initial = defaultStudySchedule(1)
    const set = setStudyCourse(initial, '2026-08-11', 'morning', { subject: '言语', stage: '基础' }, 2)
    expect(studyScheduleRange(set, '2026-08-11', '2026-08-11')).toEqual({
      '2026-08-11': { morning: { subject: '言语', stage: '基础' } },
    })
    expect(setStudyCourse(set, '2026-08-11', 'morning', null, 3).entries).toEqual({})
  })

  it('accepts mock exams as a course stage', () => {
    const result = setStudyCourse(defaultStudySchedule(1), '2026-08-12', 'afternoon', { subject: '数资', stage: '模考' }, 2)
    expect(result.entries['2026-08-12']?.afternoon).toEqual({ subject: '数资', stage: '模考' })
  })

  it('seeds only formal daytime courses from the reference timetable', () => {
    const result = seededStudySchedule(1)
    expect(result.entries['2026-09-01']).toEqual({
      morning: { subject: '职测', stage: '基础' },
      afternoon: { subject: '职测', stage: '基础' },
    })
    expect(result.entries['2026-10-02']).toEqual({
      morning: { subject: '法律', stage: '基础' },
      afternoon: { subject: '非法', stage: '基础' },
    })
    expect(result.entries['2026-09-04']).toBeUndefined()
    expect(result.entries['2026-09-10']).toBeUndefined()
    expect(result.entries['2026-09-22']).toBeUndefined()
  })

  it('drops malformed persisted records', () => {
    expect(normalizeStudySchedule({ entries: {
      '2026-02-30': { morning: { subject: '言语', stage: '基础' } },
      '2026-08-12': { morning: { subject: '未知', stage: '基础' }, afternoon: { subject: '申论', stage: '强化班' } },
    } }).entries).toEqual({ '2026-08-12': { afternoon: { subject: '申论', stage: '强化班' } } })
  })
})
