import { DEFAULT_READING_BOOK_ID, flattenBook } from '../data/readingBooks'

// Shared execution constants. These are quota rules, not UI hints.
export const MAX_READING_SESSION_PAGES = 20
export const DEFAULT_CHAT_READING_PAGES = 5
export const DEFAULT_PROACTIVE_READING_PAGES = 5

export const READING_SPEEDS = {
  slow: { id: 'slow', label: '悠闲', detail: '约 3–4 分钟 / 页', pageDurationMs: 210000 },
  normal: { id: 'normal', label: '正常', detail: '约 90 秒 / 页', pageDurationMs: 90000 },
  fast: { id: 'fast', label: '快速', detail: '约 30–60 秒 / 页', pageDurationMs: 45000 },
}

const READING_REQUEST_RE = /\[READING_REQUEST\b([^\]]*)\]/i

function finiteInteger(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.floor(number) : null
}

export function clampApprovedPages(value, fallback = DEFAULT_CHAT_READING_PAGES) {
  const parsed = finiteInteger(value)
  const safeFallback = finiteInteger(fallback) || DEFAULT_CHAT_READING_PAGES
  return Math.max(1, Math.min(MAX_READING_SESSION_PAGES, parsed == null ? safeFallback : parsed))
}

export function getPageNumber(block) {
  return Math.max(1, finiteInteger(block?.pageNumber) || 1)
}

export function getPageCount(book) {
  return flattenBook(book).reduce((max, block) => Math.max(max, getPageNumber(block)), 0)
}

export function getSessionEndPage(session) {
  const start = Math.max(1, finiteInteger(session?.startPage) || 1)
  const approved = clampApprovedPages(session?.approvedPages, 1)
  return start + approved - 1
}

export function isReadingQuotaReached(session, paragraph) {
  if (!session) return true
  const pagesRead = Math.max(0, finiteInteger(session.pagesRead) || 0)
  const page = getPageNumber(paragraph)
  return pagesRead >= clampApprovedPages(session.approvedPages, 1) || page > getSessionEndPage(session)
}

export function createReadingSession({
  triggerType = 'manual',
  bookId = DEFAULT_READING_BOOK_ID,
  startParagraph,
  approvedPages = DEFAULT_CHAT_READING_PAGES,
  requestedPages = approvedPages,
  requestId = null,
  now = Date.now(),
  sessionId = null,
} = {}) {
  const startPage = getPageNumber(startParagraph)
  const approved = clampApprovedPages(approvedPages)
  return {
    sessionId: sessionId || `reading-session-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    triggerType: ['proactive', 'chat_request', 'manual'].includes(triggerType) ? triggerType : 'manual',
    bookId,
    startPage,
    startPageId: startParagraph?.pageId || null,
    endPage: startPage + approved - 1,
    requestedPages: clampApprovedPages(requestedPages, approved),
    approvedPages: approved,
    pagesRead: 0,
    startParagraphId: startParagraph?.id || null,
    currentParagraphId: startParagraph?.id || null,
    currentPageId: startParagraph?.pageId || null,
    nextParagraphId: null,
    status: 'pending',
    requestedAt: now,
    approvedAt: null,
    startedAt: null,
    completedAt: null,
    lastUpdatedAt: now,
    durationMs: 0,
    newAnnotations: 0,
    modelCalls: 0,
    inputChars: 0,
    outputChars: 0,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    totalTokens: 0,
    requestId,
  }
}

export function approveReadingSession(session, approvedPages, now = Date.now()) {
  const approved = clampApprovedPages(approvedPages, session?.requestedPages)
  return {
    ...session,
    approvedPages: approved,
    endPage: (finiteInteger(session?.startPage) || 1) + approved - 1,
    status: 'approved',
    approvedAt: now,
    lastUpdatedAt: now,
  }
}

export function estimateTokensFromChars(value) {
  const chars = Math.max(0, Number(value) || 0)
  return chars ? Math.ceil(chars / 4) : 0
}

export function addReadingUsage(session, usage = {}) {
  const modelCalls = Math.max(0, Number(usage.modelCalls) || 0)
  const inputChars = Math.max(0, Number(usage.inputChars) || 0)
  const outputChars = Math.max(0, Number(usage.outputChars) || 0)
  const estimatedInputTokens = Math.max(0, Number(usage.estimatedInputTokens) || estimateTokensFromChars(inputChars))
  const estimatedOutputTokens = Math.max(0, Number(usage.estimatedOutputTokens) || estimateTokensFromChars(outputChars))
  return {
    ...session,
    modelCalls: (Number(session?.modelCalls) || 0) + modelCalls,
    inputChars: (Number(session?.inputChars) || 0) + inputChars,
    outputChars: (Number(session?.outputChars) || 0) + outputChars,
    estimatedInputTokens: (Number(session?.estimatedInputTokens) || 0) + estimatedInputTokens,
    estimatedOutputTokens: (Number(session?.estimatedOutputTokens) || 0) + estimatedOutputTokens,
    totalTokens: (Number(session?.totalTokens) || 0) + estimatedInputTokens + estimatedOutputTokens,
    lastUpdatedAt: Date.now(),
  }
}

export function parseReadingRequestMarker(content) {
  const match = String(content || '').match(READING_REQUEST_RE)
  if (!match) return null
  const fields = {}
  for (const field of match[1].matchAll(/([a-zA-Z]+)\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s]+)/g)) {
    fields[field[1].toLowerCase()] = field[2].replace(/^['\"]|['\"]$/g, '')
  }
  const pages = finiteInteger(fields.pages ?? fields.pagecount ?? fields.page)
  return {
    marker: match[0],
    bookId: fields.bookid || null,
    pages: clampApprovedPages(pages),
  }
}

export function stripReadingRequestMarker(content) {
  return String(content || '').replace(READING_REQUEST_RE, '').replace(/[ \t]+\n/g, '\n').trim()
}

export function readingRequestPrompt({ book, readingState } = {}) {
  const currentParagraphId = readingState?.nextParagraphId || readingState?.currentParagraphId || '当前段落'
  const currentPage = getPageNumber(flattenBook(book).find(block => block.id === currentParagraphId)) || finiteInteger(readingState?.currentPage) || 1
  const title = book?.title || '当前书籍'
  return `【AI 自主阅读申请规则】
在普通聊天里，如果你产生“想继续读书/看看后面几页”的意图，禁止直接读取正文，也不要声称已经读过。你必须先向用户提出申请，并明确一个具体页数（1–20 页；默认建议 5 页；剧情确认可申请 2–3 页，正常继续可申请 5–10 页）。在你自然的聊天文字末尾追加一次机器可读标记：[READING_REQUEST bookId=${book?.id || DEFAULT_READING_BOOK_ID} pages=N]，把 N 换成你实际提出的具体页数；UI 会把它转换成用户可批准的申请卡片，不要向用户解释标记格式。申请必须说明你想从《${title}》继续看，当前游标约为第 ${currentPage} 页（paragraph_id=${currentParagraphId}）。
若用户没有明确批准，绝对不要开始读取正文；每一次新阅读意图都要重新申请，过去的批准不是永久授权。页数最多 20，想读更多必须拆成下一次申请。不要为阅读申请输出大段解释。`
}

export function makeChatReadingRequest({ book, readingState, marker, sourceMessageId = null, now = Date.now() } = {}) {
  const blocks = flattenBook(book)
  const startId = readingState?.nextParagraphId || readingState?.currentParagraphId || blocks[0]?.id
  const startParagraph = blocks.find(block => block.id === startId) || blocks[0]
  if (!startParagraph) return null
  const requestedPages = clampApprovedPages(marker?.pages)
  const pageCount = getPageCount(book)
  const endPage = Math.min(pageCount || getSessionEndPage({ startPage: getPageNumber(startParagraph), approvedPages: requestedPages }), getPageNumber(startParagraph) + requestedPages - 1)
  return {
    requestId: `reading-request-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    triggerType: 'chat_request',
    bookId: marker?.bookId || book?.id || DEFAULT_READING_BOOK_ID,
    title: book?.title || '当前书籍',
    startPage: getPageNumber(startParagraph),
    endPage,
    requestedPages,
    startParagraphId: startParagraph.id,
    requestedAt: now,
    sourceMessageId,
  }
}

export function makeProactiveReadingSession({ book, readingState, pages = DEFAULT_PROACTIVE_READING_PAGES, now = Date.now() } = {}) {
  const blocks = flattenBook(book)
  const startId = readingState?.nextParagraphId || readingState?.currentParagraphId || blocks[0]?.id
  const startParagraph = blocks.find(block => block.id === startId) || blocks[0]
  if (!startParagraph) return null
  const approved = clampApprovedPages(pages, DEFAULT_PROACTIVE_READING_PAGES)
  return approveReadingSession(createReadingSession({
    triggerType: 'proactive',
    bookId: book?.id || DEFAULT_READING_BOOK_ID,
    startParagraph,
    approvedPages: approved,
    requestedPages: approved,
    now,
  }), approved, now)
}

export function buildReadingQuotaHeaders(quota) {
  if (!quota?.sessionId) return {}
  return {
    'X-Reading-Session-Id': String(quota.sessionId),
    'X-Reading-Approved-Pages': String(clampApprovedPages(quota.approvedPages, 1)),
    'X-Reading-Pages-Read': String(Math.max(0, finiteInteger(quota.pagesRead) || 0)),
    'X-Reading-Page-Number': String(Math.max(1, finiteInteger(quota.pageNumber) || 1)),
    'X-Reading-Start-Page': String(Math.max(1, finiteInteger(quota.startPage) || 1)),
  }
}

// Browser-side guard mirrored by the Worker before an upstream model call.
export function validateReadingQuota({ sessionId, approvedPages, pagesRead, pageNumber, startPage } = {}) {
  if (!sessionId) return { ok: true }
  const approved = finiteInteger(approvedPages)
  const read = finiteInteger(pagesRead)
  const page = finiteInteger(pageNumber)
  const start = finiteInteger(startPage)
  if (!approved || approved < 1 || approved > MAX_READING_SESSION_PAGES) {
    return { ok: false, code: 'invalid_approved_pages', message: 'approved_pages 必须在 1–20 页之间。' }
  }
  if (read == null || read < 0) return { ok: false, code: 'invalid_pages_read', message: 'pages_read 无效。' }
  if (!page || !start || page > start + approved - 1) {
    return { ok: false, code: 'reading_page_limit', message: '本次阅读已到达批准页数上限。' }
  }
  if (read >= approved) return { ok: false, code: 'reading_quota_exhausted', message: '本次阅读额度已用完。' }
  return { ok: true, approvedPages: approved, pagesRead: read, pageNumber: page, startPage: start }
}
