import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export const READING_STORE_VERSION = 1
export const MAX_READING_SESSION_PAGES = 20
export const MAX_READING_BATCH_PAGES = 3
export const READING_BATCH_CHAR_BUDGET = 7000
export const MAX_ROLLING_STATE_CHARS = 5200

export type ReadingParagraph = { id: string; text: string }
export type ReadingChapter = { id: string; title: string; paragraphs: ReadingParagraph[] }
export type ReadingBook = {
  id: string
  title: string
  author?: string
  description?: string
  chapters: ReadingChapter[]
  importedAt?: number
  sourceFormat?: string
}

export type ReadingBlock = ReadingParagraph & {
  bookId: string
  chapterId: string
  chapterTitle: string
  chapterIndex: number
  paragraphIndex: number
  globalIndex: number
  pageNumber: number
  pageId: string
}

export type RollingBookState = {
  bookId: string
  currentPage: number
  currentParagraphId: string | null
  plotState: string
  importantPeople: string[]
  importantEvents: string[]
  openQuestions: string[]
  themesOrThoughts: string[]
  recentContext: string
  updatedAt: number
}

export type ReadingAnnotation = {
  id: string
  bookId: string
  sessionId: string
  kind: 'highlight' | 'annotate'
  pageId: string
  pageNumber: number
  paragraphId: string
  quote: string
  annotation: string
  createdAt: number
}

type PendingBatch = {
  id: string
  blockIds: string[]
  startPage: number
  endPage: number
  createdAt: number
}

export type ReadingSession = {
  id: string
  bookId: string
  approvedPages: number
  pagesRead: number
  startPage: number
  startParagraphId: string
  currentParagraphId: string
  nextParagraphId: string | null
  status: 'approved' | 'reading' | 'completed' | 'paused' | 'error'
  startedAt: number
  updatedAt: number
  completedAt: number | null
  summary: string
  batchCount: number
  pendingBatch: PendingBatch | null
}

type BookReadingState = {
  bookId: string
  currentPage: number
  currentParagraphId: string
  nextParagraphId: string | null
  readParagraphIds: string[]
  progress: number
  rolling: RollingBookState
  recentAnnotationIds: string[]
  activeSessionId: string | null
  updatedAt: number
}

type ReadingLogEntry = {
  id: string
  bookId: string
  sessionId: string
  action: string
  pageStart: number
  pageEnd: number
  paragraphId: string
  annotationIds: string[]
  createdAt: number
}

export type ReadingRequest = {
  id: string
  bookId: string
  title: string
  startPage: number
  startParagraphId: string
  requestedPages: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  sessionId: string | null
  createdAt: number
  resolvedAt: number | null
}

type StoreData = {
  version: number
  books: Record<string, { id: string; title: string; author: string; description: string; importedAt: number; sourceFormat: string; paragraphCount: number; pageCount: number }>
  states: Record<string, BookReadingState>
  sessions: Record<string, ReadingSession>
  annotations: Record<string, ReadingAnnotation>
  requests: Record<string, ReadingRequest>
  logs: ReadingLogEntry[]
}

export type ReadingBatch = {
  id: string
  sessionId: string
  bookId: string
  bookTitle: string
  startPage: number
  endPage: number
  previousContext: string
  blocks: ReadingBlock[]
  rolling: RollingBookState
  remainingApprovedPages: number
}

function safeId(value: unknown, fallback = 'book'): string {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)
  return normalized || fallback
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Math.floor(Number(value))
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function boundedText(value: unknown, max: number): string {
  return String(value || '').trim().slice(0, max)
}

function boundedList(value: unknown, maxItems = 12, maxChars = 220): string[] {
  if (!Array.isArray(value)) return []
  return value.map(item => boundedText(item, maxChars)).filter(Boolean).slice(0, maxItems)
}

function nextId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`
}

function atomicJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
  renameSync(temporary, path)
}

function normalizeBook(input: any): ReadingBook {
  const id = safeId(input?.id, nextId('book'))
  const chapters: ReadingChapter[] = (Array.isArray(input?.chapters) ? input.chapters : []).map((chapter: any, chapterIndex: number) => ({
    id: safeId(chapter?.id, `${id}-chapter-${chapterIndex + 1}`),
    title: boundedText(chapter?.title, 240) || `第 ${chapterIndex + 1} 章`,
    paragraphs: (Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : []).map((paragraph: any, paragraphIndex: number) => ({
      id: safeId(paragraph?.id, `${id}-${chapterIndex + 1}-${paragraphIndex + 1}`),
      text: boundedText(typeof paragraph === 'string' ? paragraph : paragraph?.text, 6000),
    })).filter((paragraph: ReadingParagraph) => paragraph.text.length > 0),
  })).filter((chapter: ReadingChapter) => chapter.paragraphs.length > 0)
  if (!chapters.length) throw new Error('book_has_no_readable_paragraphs')
  return {
    id,
    title: boundedText(input?.title, 240) || '未命名图书',
    author: boundedText(input?.author, 180) || '未知作者',
    description: boundedText(input?.description, 800),
    importedAt: Number(input?.importedAt) || Date.now(),
    sourceFormat: boundedText(input?.sourceFormat, 40) || 'structured',
    chapters,
  }
}

export function flattenReadingBook(book: ReadingBook): ReadingBlock[] {
  const blocks: ReadingBlock[] = []
  book.chapters.forEach((chapter, chapterIndex) => {
    chapter.paragraphs.forEach((paragraph, paragraphIndex) => {
      const globalIndex = blocks.length
      const pageNumber = Math.floor(globalIndex / 2) + 1
      blocks.push({
        ...paragraph,
        bookId: book.id,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterIndex,
        paragraphIndex,
        globalIndex,
        pageNumber,
        pageId: `${book.id}-page-${pageNumber}`,
      })
    })
  })
  return blocks
}

export function normalizeRollingBookState(value: any, fallback: { bookId: string; currentPage: number; currentParagraphId: string | null }): RollingBookState {
  const normalized: RollingBookState = {
    bookId: fallback.bookId,
    currentPage: fallback.currentPage,
    currentParagraphId: fallback.currentParagraphId,
    plotState: boundedText(value?.plotState ?? value?.plot_state, 1200),
    importantPeople: boundedList(value?.importantPeople ?? value?.important_people),
    importantEvents: boundedList(value?.importantEvents ?? value?.important_events),
    openQuestions: boundedList(value?.openQuestions ?? value?.open_questions, 10),
    themesOrThoughts: boundedList(value?.themesOrThoughts ?? value?.themes_or_thoughts, 10),
    recentContext: boundedText(value?.recentContext ?? value?.recent_context, 1500),
    updatedAt: Date.now(),
  }
  // A final hard cap protects recovery prompts even if many arrays are filled.
  while (JSON.stringify(normalized).length > MAX_ROLLING_STATE_CHARS) {
    if (normalized.recentContext.length > 300) normalized.recentContext = normalized.recentContext.slice(0, -200)
    else if (normalized.importantEvents.length > 4) normalized.importantEvents.pop()
    else if (normalized.importantPeople.length > 4) normalized.importantPeople.pop()
    else if (normalized.themesOrThoughts.length > 3) normalized.themesOrThoughts.pop()
    else if (normalized.openQuestions.length > 3) normalized.openQuestions.pop()
    else if (normalized.plotState.length > 300) normalized.plotState = normalized.plotState.slice(0, -200)
    else break
  }
  return normalized
}

function emptyStore(): StoreData {
  return { version: READING_STORE_VERSION, books: {}, states: {}, sessions: {}, annotations: {}, requests: {}, logs: [] }
}

export class ReadingStore {
  readonly root: string
  readonly dataFile: string
  readonly booksDir: string
  readonly batchesDir: string
  private data: StoreData

  constructor(root: string) {
    this.root = root
    this.dataFile = join(root, 'store.json')
    this.booksDir = join(root, 'books')
    this.batchesDir = join(root, 'batches')
    mkdirSync(this.booksDir, { recursive: true })
    mkdirSync(this.batchesDir, { recursive: true })
    // Batch files are disposable tool inputs. A process restart may leave one
    // behind, but the durable pending cursor is enough to regenerate it.
    for (const name of readdirSync(this.batchesDir)) {
      if (name.endsWith('.txt')) try { unlinkSync(join(this.batchesDir, name)) } catch {}
    }
    try {
      const parsed = JSON.parse(readFileSync(this.dataFile, 'utf8'))
      this.data = { ...emptyStore(), ...parsed, books: parsed.books || {}, states: parsed.states || {}, sessions: parsed.sessions || {}, annotations: parsed.annotations || {}, requests: parsed.requests || {}, logs: Array.isArray(parsed.logs) ? parsed.logs : [] }
    } catch {
      this.data = emptyStore()
    }
  }

  private save(): void {
    this.data.version = READING_STORE_VERSION
    atomicJson(this.dataFile, this.data)
  }

  importBook(input: unknown): ReadingBook {
    const book = normalizeBook(input)
    const blocks = flattenReadingBook(book)
    atomicJson(join(this.booksDir, `${safeId(book.id)}.json`), book)
    this.data.books[book.id] = {
      id: book.id,
      title: book.title,
      author: book.author || '',
      description: book.description || '',
      importedAt: book.importedAt || Date.now(),
      sourceFormat: book.sourceFormat || 'structured',
      paragraphCount: blocks.length,
      pageCount: blocks.at(-1)?.pageNumber || 0,
    }
    if (!this.data.states[book.id]) {
      const first = blocks[0]
      this.data.states[book.id] = {
        bookId: book.id,
        currentPage: first.pageNumber,
        currentParagraphId: first.id,
        nextParagraphId: first.id,
        readParagraphIds: [],
        progress: 0,
        rolling: normalizeRollingBookState({}, { bookId: book.id, currentPage: first.pageNumber, currentParagraphId: first.id }),
        recentAnnotationIds: [],
        activeSessionId: null,
        updatedAt: Date.now(),
      }
    }
    this.save()
    return book
  }

  getBook(bookId: string): ReadingBook | null {
    const id = safeId(bookId)
    try { return normalizeBook(JSON.parse(readFileSync(join(this.booksDir, `${id}.json`), 'utf8'))) } catch { return null }
  }

  listBooks() {
    return Object.values(this.data.books).sort((a, b) => b.importedAt - a.importedAt)
  }

  deleteBook(bookId: string): boolean {
    const id = safeId(bookId)
    if (!this.data.books[id]) return false
    delete this.data.books[id]
    delete this.data.states[id]
    for (const [sessionId, session] of Object.entries(this.data.sessions)) if (session.bookId === id) delete this.data.sessions[sessionId]
    for (const [annotationId, annotation] of Object.entries(this.data.annotations)) if (annotation.bookId === id) delete this.data.annotations[annotationId]
    for (const [requestId, request] of Object.entries(this.data.requests)) if (request.bookId === id) delete this.data.requests[requestId]
    this.data.logs = this.data.logs.filter(log => log.bookId !== id)
    try { unlinkSync(join(this.booksDir, `${id}.json`)) } catch {}
    this.save()
    return true
  }

  getReadingState(bookId: string) {
    const state = this.data.states[bookId]
    const book = this.data.books[bookId]
    if (!state || !book) return null
    const latestSession = Object.values(this.data.sessions)
      .filter(session => session.bookId === bookId)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null
    return {
      bookId,
      title: book.title,
      currentPage: state.currentPage,
      currentParagraphId: state.currentParagraphId,
      nextParagraphId: state.nextParagraphId,
      progress: state.progress,
      rollingSummary: state.rolling,
      recentAnnotationIds: state.recentAnnotationIds.slice(-5),
      activeSessionId: state.activeSessionId,
      session: latestSession ? {
        id: latestSession.id,
        approvedPages: latestSession.approvedPages,
        pagesRead: latestSession.pagesRead,
        startPage: latestSession.startPage,
        status: latestSession.status,
        updatedAt: latestSession.updatedAt,
        completedAt: latestSession.completedAt,
      } : null,
      updatedAt: state.updatedAt,
    }
  }

  getSession(sessionId: string): ReadingSession | null {
    return this.data.sessions[sessionId] || null
  }

  createReadingRequest(bookId: string, requestedPages: number, reason = ''): ReadingRequest {
    const book = this.data.books[bookId]
    const state = this.data.states[bookId]
    if (!book || !state) throw new Error('reading_book_not_found')
    const duplicate = Object.values(this.data.requests).find(request => request.bookId === bookId && request.status === 'pending')
    if (duplicate) return duplicate
    const cursorId = state.nextParagraphId || state.currentParagraphId
    const cursor = flattenReadingBook(this.getBook(bookId)!).find(block => block.id === cursorId)
    const request: ReadingRequest = {
      id: nextId('reading-request'),
      bookId,
      title: book.title,
      startPage: cursor?.pageNumber || state.currentPage,
      startParagraphId: cursorId,
      requestedPages: clampInt(requestedPages, 1, MAX_READING_SESSION_PAGES, 5),
      reason: boundedText(reason, 500),
      status: 'pending',
      sessionId: null,
      createdAt: Date.now(),
      resolvedAt: null,
    }
    this.data.requests[request.id] = request
    this.save()
    return request
  }

  listReadingRequests(status?: ReadingRequest['status']): ReadingRequest[] {
    return Object.values(this.data.requests)
      .filter(request => !status || request.status === status)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  approveReadingRequest(requestId: string, approvedPages?: number): { request: ReadingRequest; session: ReadingSession } {
    const request = this.data.requests[requestId]
    if (!request) throw new Error('reading_request_not_found')
    if (request.status === 'approved' && request.sessionId) {
      const existing = this.data.sessions[request.sessionId]
      if (existing) return { request, session: existing }
    }
    if (request.status === 'rejected') throw new Error('reading_request_already_rejected')
    const session = this.startSession(request.bookId, approvedPages ?? request.requestedPages)
    request.status = 'approved'
    request.sessionId = session.id
    request.resolvedAt = Date.now()
    this.save()
    return { request, session }
  }

  rejectReadingRequest(requestId: string): ReadingRequest {
    const request = this.data.requests[requestId]
    if (!request) throw new Error('reading_request_not_found')
    if (request.status === 'approved') throw new Error('reading_request_already_approved')
    request.status = 'rejected'
    request.resolvedAt = Date.now()
    this.save()
    return request
  }

  startSession(bookId: string, approvedPages: number, requestedSessionId?: string): ReadingSession {
    const book = this.getBook(bookId)
    const state = this.data.states[bookId]
    if (!book || !state) throw new Error('reading_book_not_found')
    if (requestedSessionId && this.data.sessions[requestedSessionId]) return this.data.sessions[requestedSessionId]
    const blocks = flattenReadingBook(book)
    const start = blocks.find(block => block.id === (state.nextParagraphId || state.currentParagraphId)) || blocks[0]
    const pages = clampInt(approvedPages, 1, MAX_READING_SESSION_PAGES, 5)
    const now = Date.now()
    const session: ReadingSession = {
      id: requestedSessionId ? safeId(requestedSessionId, nextId('reading-session')) : nextId('reading-session'),
      bookId,
      approvedPages: pages,
      pagesRead: 0,
      startPage: start.pageNumber,
      startParagraphId: start.id,
      currentParagraphId: start.id,
      nextParagraphId: start.id,
      status: 'approved',
      startedAt: now,
      updatedAt: now,
      completedAt: null,
      summary: '',
      batchCount: 0,
      pendingBatch: null,
    }
    this.data.sessions[session.id] = session
    state.activeSessionId = session.id
    state.updatedAt = now
    this.save()
    return session
  }

  prepareBatch(sessionId: string): ReadingBatch {
    const session = this.data.sessions[sessionId]
    if (!session) throw new Error('reading_session_not_found')
    if (session.status === 'completed') throw new Error('reading_session_completed')
    const book = this.getBook(session.bookId)
    const state = this.data.states[session.bookId]
    if (!book || !state) throw new Error('reading_book_not_found')
    const blocks = flattenReadingBook(book)
    const startIndex = Math.max(0, blocks.findIndex(block => block.id === (session.nextParagraphId || state.nextParagraphId || session.currentParagraphId)))
    const remainingPages = session.approvedPages - session.pagesRead
    if (remainingPages <= 0) throw new Error('reading_session_completed')
    const startPage = blocks[startIndex]?.pageNumber
    if (!startPage) throw new Error('reading_book_completed')
    const maxEndPage = startPage + Math.min(MAX_READING_BATCH_PAGES, remainingPages) - 1
    const selected: ReadingBlock[] = []
    let chars = 0
    for (let index = startIndex; index < blocks.length; index++) {
      const block = blocks[index]
      if (block.pageNumber > maxEndPage) break
      if (selected.length && chars + block.text.length > READING_BATCH_CHAR_BUDGET) break
      selected.push(block)
      chars += block.text.length
    }
    if (!selected.length) selected.push(blocks[startIndex])
    const batchId = session.pendingBatch?.id || nextId('reading-batch')
    const pendingBatch: PendingBatch = {
      id: batchId,
      blockIds: selected.map(block => block.id),
      startPage: selected[0].pageNumber,
      endPage: selected.at(-1)!.pageNumber,
      createdAt: session.pendingBatch?.createdAt || Date.now(),
    }
    session.pendingBatch = pendingBatch
    session.status = 'reading'
    session.updatedAt = Date.now()
    state.activeSessionId = session.id
    state.updatedAt = Date.now()
    this.save()
    const previous = blocks[startIndex - 1]
    return {
      id: batchId,
      sessionId: session.id,
      bookId: book.id,
      bookTitle: book.title,
      startPage: pendingBatch.startPage,
      endPage: pendingBatch.endPage,
      previousContext: previous?.text.slice(-600) || '',
      blocks: selected,
      rolling: state.rolling,
      remainingApprovedPages: remainingPages,
    }
  }

  writeBatchFile(batch: ReadingBatch): string {
    const path = join(this.batchesDir, `${safeId(batch.id)}.txt`)
    const body = [
      `书名：${batch.bookTitle}`,
      `批次：第 ${batch.startPage}–${batch.endPage} 页`,
      batch.previousContext ? `\n<previous_context>\n${batch.previousContext}\n</previous_context>` : '',
      ...batch.blocks.map(block => `\n<page number="${block.pageNumber}" id="${block.pageId}">\n<paragraph id="${block.id}">\n${block.text}\n</paragraph>\n</page>`),
    ].filter(Boolean).join('\n')
    writeFileSync(path, body, { mode: 0o600 })
    return path
  }

  commitBatch(input: any) {
    const sessionId = safeId(input?.sessionId ?? input?.session_id, '')
    const batchId = safeId(input?.batchId ?? input?.batch_id, '')
    const session = this.data.sessions[sessionId]
    if (!session) throw new Error('reading_session_not_found')
    const pending = session.pendingBatch
    if (!pending || pending.id !== batchId) throw new Error('reading_batch_mismatch')
    const book = this.getBook(session.bookId)
    const state = this.data.states[session.bookId]
    if (!book || !state) throw new Error('reading_book_not_found')
    const blocks = flattenReadingBook(book)
    const allowed = new Set(pending.blockIds)
    const endParagraphId = safeId(input?.endParagraphId ?? input?.end_paragraph_id, '')
    const endIndex = blocks.findIndex(block => block.id === endParagraphId && allowed.has(block.id))
    if (endIndex < 0) throw new Error('reading_end_paragraph_outside_batch')
    const startIndex = blocks.findIndex(block => block.id === pending.blockIds[0])
    const consumed = blocks.slice(startIndex, endIndex + 1).filter(block => allowed.has(block.id))
    const end = consumed.at(-1)!
    const next = blocks[endIndex + 1] || null
    const completedPages = Math.max(0, end.pageNumber - pending.startPage + (next?.pageNumber === end.pageNumber ? 0 : 1))
    const pagesRead = Math.min(session.approvedPages, session.pagesRead + completedPages)
    const now = Date.now()
    const newAnnotations: ReadingAnnotation[] = []
    const requestedNotes = [
      ...(Array.isArray(input?.highlights) ? input.highlights.map((item: any) => ({ ...item, kind: 'highlight' })) : []),
      ...(Array.isArray(input?.annotations) ? input.annotations.map((item: any) => ({ ...item, kind: 'annotate' })) : []),
    ].slice(0, 16)
    const byId = new Map(consumed.map(block => [block.id, block]))
    for (const note of requestedNotes) {
      const paragraph = byId.get(String((note?.paragraphId ?? note?.paragraph_id) || ''))
      const quote = boundedText(note?.quote, 500)
      if (!paragraph || !quote || !paragraph.text.includes(quote)) continue
      const annotationText = note.kind === 'annotate' ? boundedText(note?.annotation, 500) : ''
      const duplicate = Object.values(this.data.annotations).find(item => item.bookId === book.id && item.paragraphId === paragraph.id && item.kind === note.kind && item.quote === quote)
      if (duplicate) continue
      const annotation: ReadingAnnotation = {
        id: nextId('annotation'),
        bookId: book.id,
        sessionId,
        kind: note.kind,
        pageId: paragraph.pageId,
        pageNumber: paragraph.pageNumber,
        paragraphId: paragraph.id,
        quote,
        annotation: annotationText,
        createdAt: now,
      }
      this.data.annotations[annotation.id] = annotation
      newAnnotations.push(annotation)
    }
    const readIds = new Set(state.readParagraphIds)
    consumed.forEach(block => readIds.add(block.id))
    const totalChars = blocks.reduce((sum, block) => sum + block.text.replace(/\s/g, '').length, 0)
    const readChars = blocks.reduce((sum, block) => sum + (readIds.has(block.id) ? block.text.replace(/\s/g, '').length : 0), 0)
    state.currentPage = end.pageNumber
    state.currentParagraphId = end.id
    state.nextParagraphId = next?.id || null
    state.readParagraphIds = [...readIds]
    state.progress = totalChars ? Math.min(1, readChars / totalChars) : 0
    state.rolling = normalizeRollingBookState(input?.rollingState ?? input?.rolling_state, { bookId: book.id, currentPage: end.pageNumber, currentParagraphId: end.id })
    state.recentAnnotationIds = [...state.recentAnnotationIds, ...newAnnotations.map(item => item.id)].slice(-12)
    state.updatedAt = now
    session.pagesRead = pagesRead
    session.currentParagraphId = end.id
    session.nextParagraphId = next?.id || null
    session.batchCount += 1
    session.pendingBatch = null
    session.updatedAt = now
    const completed = pagesRead >= session.approvedPages || !next
    if (completed) {
      session.status = 'completed'
      session.completedAt = now
      session.summary = boundedText(input?.sessionSummary ?? input?.session_summary, 3000) || `本轮阅读《${book.title}》第 ${session.startPage}–${end.pageNumber} 页，新增 ${newAnnotations.length} 条批注。`
      state.activeSessionId = null
    } else session.status = 'approved'
    const log: ReadingLogEntry = {
      id: nextId('reading-log'),
      bookId: book.id,
      sessionId,
      action: completed ? 'session_complete' : 'batch_complete',
      pageStart: pending.startPage,
      pageEnd: end.pageNumber,
      paragraphId: end.id,
      annotationIds: newAnnotations.map(item => item.id),
      createdAt: now,
    }
    this.data.logs.push(log)
    this.data.logs = this.data.logs.slice(-5000)
    this.save()
    try { unlinkSync(join(this.batchesDir, `${safeId(batchId)}.txt`)) } catch {}
    return { completed, state: this.getReadingState(book.id), session: { ...session }, annotations: newAnnotations, log }
  }

  failBatch(sessionId: string, message: string) {
    const session = this.data.sessions[sessionId]
    if (!session) return null
    const failedBatchId = session.pendingBatch?.id
    session.status = 'error'
    session.updatedAt = Date.now()
    session.pendingBatch = null
    this.data.logs.push({
      id: nextId('reading-log'), bookId: session.bookId, sessionId, action: `error:${boundedText(message, 200)}`,
      pageStart: session.startPage, pageEnd: session.startPage + session.pagesRead, paragraphId: session.currentParagraphId,
      annotationIds: [], createdAt: Date.now(),
    })
    this.save()
    if (failedBatchId) try { unlinkSync(join(this.batchesDir, `${safeId(failedBatchId)}.txt`)) } catch {}
    return session
  }

  getAnnotations(bookId: string, pageStart?: number, pageEnd?: number): ReadingAnnotation[] {
    return Object.values(this.data.annotations).filter(item => (
      item.bookId === bookId
      && (pageStart == null || item.pageNumber >= pageStart)
      && (pageEnd == null || item.pageNumber <= pageEnd)
    )).sort((a, b) => a.createdAt - b.createdAt)
  }

  getAnnotation(annotationId: string): ReadingAnnotation | null {
    return this.data.annotations[annotationId] || null
  }

  getSessionSummaries(bookId: string, limit = 20) {
    return Object.values(this.data.sessions)
      .filter(session => session.bookId === bookId && session.summary)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, clampInt(limit, 1, 100, 20))
      .map(session => ({ id: session.id, startPage: session.startPage, pagesRead: session.pagesRead, summary: session.summary, completedAt: session.completedAt }))
  }
}
