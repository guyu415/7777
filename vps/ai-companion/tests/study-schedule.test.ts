import { describe, expect, it } from 'vitest'
import { defaultStudySchedule, normalizeStudySchedule, setStudyCourse, studyScheduleRange } from '../study-schedule.ts'

describe('study schedule', () => {
  it('sets, reads and clears a course', () => {
    const initial = defaultStudySchedule(1)
    const set = setStudyCourse(initial, '2026-08-11', 'morning', { subject: '言语', stage: '基础' }, 2)
    expect(studyScheduleRange(set, '2026-08-11', '2026-08-11')).toEqual({
      '2026-08-11': { morning: { subject: '言语', stage: '基础' } },
    })
    expect(setStudyCourse(set, '2026-08-11', 'morning', null, 3).entries).toEqual({})
  })

  it('drops malformed persisted records', () => {
    expect(normalizeStudySchedule({ entries: {
      '2026-02-30': { morning: { subject: '言语', stage: '基础' } },
      '2026-08-12': { morning: { subject: '未知', stage: '基础' }, afternoon: { subject: '申论', stage: '强化班' } },
    } }).entries).toEqual({ '2026-08-12': { afternoon: { subject: '申论', stage: '强化班' } } })
  })
})
