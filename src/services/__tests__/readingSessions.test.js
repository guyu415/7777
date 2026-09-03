import { describe, expect, it } from 'vitest'
import { READING_BOOKS, flattenBook } from '../../data/readingBooks'
import {
  approveReadingSession,
  createReadingSession,
  makeChatReadingRequest,
  parseReadingRequestMarker,
  validateReadingQuota,
} from '../readingSessions'

describe('reading session quota', () => {
  const blocks = flattenBook(READING_BOOKS[0])

  it('assigns stable page metadata to ordered paragraphs', () => {
    expect(blocks[0]).toMatchObject({ pageNumber: 1, pageId: 'lily-garden-notes-page-1', globalIndex: 0 })
    expect(blocks[2]).toMatchObject({ pageNumber: 1, globalIndex: 2 })
    expect(blocks.find(block => block.pageNumber === 2)?.globalIndex).toBeGreaterThan(2)
  })

  it('hard clamps every approved page value to 20', () => {
    const session = createReadingSession({ startParagraph: blocks[0], approvedPages: 50, requestedPages: 50, now: 100 })
    expect(session.approvedPages).toBe(20)
    expect(session.endPage).toBe(20)
  })

  it('keeps a pending chat request separate until the user approves it', () => {
    const pending = createReadingSession({ startParagraph: blocks[0], approvedPages: 10, requestId: 'request-1', now: 100 })
    expect(pending).toMatchObject({ status: 'pending', requestId: 'request-1', approvedPages: 10 })
    expect(approveReadingSession(pending, 3, 200)).toMatchObject({ status: 'approved', approvedPages: 3, requestedPages: 10, approvedAt: 200 })
  })

  it('rejects a model turn after the approved page quota', () => {
    expect(validateReadingQuota({ sessionId: 's', approvedPages: 5, pagesRead: 5, pageNumber: 5, startPage: 1 }).ok).toBe(false)
    expect(validateReadingQuota({ sessionId: 's', approvedPages: 5, pagesRead: 4, pageNumber: 6, startPage: 1 }).ok).toBe(false)
    expect(validateReadingQuota({ sessionId: 's', approvedPages: 5, pagesRead: 4, pageNumber: 5, startPage: 1 }).ok).toBe(true)
  })

  it('turns a chat marker into a concrete request without approving it', () => {
    const marker = parseReadingRequestMarker('[READING_REQUEST bookId=lily-garden-notes pages=7]')
    const request = makeChatReadingRequest({ book: READING_BOOKS[0], readingState: { currentParagraphId: blocks[2].id }, marker, now: 100 })
    expect(request).toMatchObject({ triggerType: 'chat_request', startPage: 1, requestedPages: 7 })
    expect(request.approvedPages).toBeUndefined()
  })
})
