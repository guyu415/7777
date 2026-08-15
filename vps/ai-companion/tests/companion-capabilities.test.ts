import { describe, expect, test } from 'bun:test'
import { writeDiaryLetter } from '../diary-writer.ts'
import { coreMcpInstructions } from '../mcp-core-instructions.ts'
import { defaultCareHubState } from '../care-hub.ts'
import { studyPlanDetails } from '../study-plans.ts'

describe('resident capability discovery', () => {
  test('keeps the essential capability index ahead of Claude Code instruction truncation', () => {
    const text = coreMcpInstructions('web')
    expect(text.length).toBeLessThan(2048)
    for (const capability of ['diary_write', 'search_chat_history', 'galatea', 'get_study_schedule', 'get_plans', 'play_fishing']) {
      expect(text).toContain(capability)
    }
  })

  test('writes diary letters through the VPS-authenticated Worker path', async () => {
    let captured: { url?: string; init?: RequestInit } = {}
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      captured = { url: String(url), init }
      return Response.json({ ok: true, letter: { id: 'drive-file-1' } })
    }) as typeof fetch

    const result = await writeDiaryLetter(
      'https://worker.example/diary/write',
      'test-vps-key',
      { content: '今晚的风很轻。', mood: '😌', date: '2026-08-12' },
      fakeFetch,
    )

    expect(result).toEqual({ ok: true, id: 'drive-file-1' })
    expect(captured.url).toBe('https://worker.example/diary/write')
    expect((captured.init?.headers as Record<string, string>)['X-VPS-Key']).toBe('test-vps-key')
    expect(JSON.parse(String(captured.init?.body))).toEqual({ content: '今晚的风很轻。', mood: '😌', date: '2026-08-12' })
  })

  test('does not call the Worker without its VPS key', async () => {
    let called = false
    const fakeFetch = (async () => {
      called = true
      return Response.json({ ok: true })
    }) as typeof fetch
    expect(await writeDiaryLetter('https://worker.example/diary/write', '', { content: 'x' }, fakeFetch))
      .toEqual({ ok: false, error: 'vps_service_key_missing' })
    expect(called).toBe(false)
  })

  test('returns concrete plans instead of only an aggregate count', () => {
    const state = defaultCareHubState()
    state.study.goals = [
      { id: 'daily', title: '背诵申论素材', schedule: 'daily', completedDates: ['2026-08-12'], done: false, createdAt: 1 },
      { id: 'late', title: '完成行测套题', schedule: 'once', targetDate: '2026-08-11', done: false, createdAt: 2 },
      { id: 'done', title: '整理错题', schedule: 'once', done: true, createdAt: 3 },
    ]
    const result = studyPlanDetails(state, '2026-08-12')
    expect(result.plans.map((plan) => plan.title)).toEqual(['背诵申论素材', '完成行测套题'])
    expect(result.plans[0]).toMatchObject({ appliesToday: true, completedToday: true })
    expect(result.plans[1]).toMatchObject({ overdue: true, targetDate: '2026-08-11' })
  })
})
