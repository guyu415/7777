import { describe, expect, it } from 'vitest'
import { validateReadingQuotaHeaders, validateReadingQuotaValues } from './scheduled-message-worker.js'

describe('Worker reading quota guard', () => {
  it('rejects a request that would cross the approved page count', () => {
    const headers = new Headers({
      'X-Reading-Session-Id': 'session-1',
      'X-Reading-Approved-Pages': '5',
      'X-Reading-Pages-Read': '5',
      'X-Reading-Page-Number': '5',
      'X-Reading-Start-Page': '1',
    })
    expect(validateReadingQuotaHeaders(headers)).toMatchObject({ ok: false, code: 'reading_quota_exhausted', status: 409 })
  })

  it('rejects approved_pages above the hard maximum even outside HTTP', () => {
    expect(validateReadingQuotaValues({ sessionId: 's', approvedPages: 21, pagesRead: 0, pageNumber: 1, startPage: 1 })).toMatchObject({ ok: false, code: 'invalid_approved_pages' })
  })
})
