import { getReadingBooks, useStore } from '../store'
import { READING_BOOKS, countBookCharacters, flattenBook } from '../data/readingBooks'
import {
  getCompanionReadingAnnotations,
  runResidentReadingBatch,
  startCompanionReadingSession,
  syncReadingBookToCompanion,
} from './companion'
import { clampApprovedPages } from './readingSessions'

// Proactive reading uses the exact same resident Claude Code + Reading Store
// path as the visible reader. It does not need an open route, a browser model,
// or any conversation-history text. One controller per durable session also
// prevents replayed proactive events from spending the same approval twice.
const activeRuns = new Map()

function locateNotes(notes, blocks) {
  return (notes || []).map(note => {
    const block = blocks.find(item => item.id === note.paragraphId)
    return {
      ...note,
      chapterId: block?.chapterId || null,
      chapterTitle: block?.chapterTitle || '',
      chapterIndex: block?.chapterIndex,
      paragraphIndex: block?.paragraphIndex,
    }
  })
}

function mirrorState(store, book, blocks, remoteState, notes, status) {
  const index = blocks.findIndex(block => block.id === remoteState.currentParagraphId)
  const current = blocks[Math.max(0, index)] || blocks[0]
  const progress = Math.max(0, Math.min(1, Number(remoteState.progress) || 0))
  const located = locateNotes(notes, blocks)
  store.updateReadingState({
    bookId: book.id,
    status,
    currentParagraphId: current?.id || remoteState.currentParagraphId,
    currentChapterId: current?.chapterId || null,
    currentPageId: current?.pageId || null,
    currentPage: remoteState.currentPage || current?.pageNumber || 1,
    nextParagraphId: remoteState.nextParagraphId || null,
    activeSessionId: remoteState.activeSessionId || remoteState.session?.id || null,
    readParagraphIds: progress > 0 && index >= 0 ? blocks.slice(0, index + 1).map(block => block.id) : [],
    progressChars: Math.round(countBookCharacters(book) * progress),
    highlights: located.filter(note => note.kind === 'highlight'),
    annotations: located.filter(note => note.kind === 'annotate'),
    lastReadAt: remoteState.updatedAt || Date.now(),
  })
}

export function stopProactiveReading(sessionId) {
  activeRuns.get(sessionId)?.controller.abort()
}

export function isProactiveReadingActive(sessionId) {
  return Boolean(sessionId && activeRuns.has(sessionId))
}

export function runProactiveReadingInBackground({ sessionId, bookId } = {}) {
  if (!sessionId) return null
  if (activeRuns.has(sessionId)) return activeRuns.get(sessionId).promise
  if (globalThis.document?.querySelector?.('.ai-reading')) return null

  const controller = new AbortController()
  const promise = (async () => {
    const initialStore = useStore.getState()
    const localSession = initialStore.readingSessions?.find(item => item.sessionId === sessionId)
    if (!localSession || localSession.triggerType !== 'proactive' || !['approved', 'reading'].includes(localSession.status)) return
    const imported = await getReadingBooks().catch(() => [])
    const book = [...imported, ...READING_BOOKS].find(item => item.id === (bookId || localSession.bookId))
    if (!book) throw new Error('reading_book_not_found')
    const blocks = flattenBook(book)
    const startedAt = Date.now()

    try {
      await syncReadingBookToCompanion(book)
      const started = await startCompanionReadingSession({
        bookId: book.id,
        approvedPages: clampApprovedPages(localSession.approvedPages, 5),
        sessionId,
      })
      let remoteSession = started.session
      initialStore.upsertReadingSession({ ...localSession, status: 'reading', startedAt: remoteSession.startedAt, lastUpdatedAt: Date.now() })
      initialStore.updateReadingState({
        bookId: book.id, status: 'reading', activeSessionId: sessionId,
        activity: '常驻 Claude Code 正在阅读……', pauseReason: '', error: '',
      })

      while (!controller.signal.aborted && remoteSession.status !== 'completed') {
        const result = await runResidentReadingBatch({ sessionId, signal: controller.signal })
        remoteSession = result.session
        const noteResult = await getCompanionReadingAnnotations(book.id)
        const store = useStore.getState()
        mirrorState(store, book, blocks, result.state, noteResult.annotations || [], result.completed ? 'complete' : 'reading')
        const isBookComplete = result.completed && !result.state.nextParagraphId
        store.upsertReadingSession({
          ...localSession,
          sessionId: remoteSession.id,
          bookId: remoteSession.bookId,
          approvedPages: remoteSession.approvedPages,
          pagesRead: remoteSession.pagesRead,
          startPage: remoteSession.startPage,
          endPage: remoteSession.startPage + remoteSession.approvedPages - 1,
          currentParagraphId: remoteSession.currentParagraphId,
          nextParagraphId: remoteSession.nextParagraphId,
          status: result.completed ? 'completed' : 'reading',
          startedAt: remoteSession.startedAt,
          completedAt: remoteSession.completedAt,
          summary: remoteSession.summary,
          batchCount: remoteSession.batchCount,
          modelCalls: remoteSession.batchCount,
          newAnnotations: (noteResult.annotations || []).filter(note => note.sessionId === sessionId).length,
          durationMs: Math.max(0, (remoteSession.completedAt || Date.now()) - startedAt),
          lastUpdatedAt: remoteSession.updatedAt,
        })
        store.updateReadingState({
          activity: result.completed ? (isBookComplete ? '读完了这一本' : '本轮额度已读完') : '继续阅读',
          completionReason: result.completed ? (isBookComplete ? 'book' : 'quota') : '',
          pauseReason: result.completed && !isBookComplete ? `本轮已读 ${remoteSession.approvedPages} 页，下一轮从独立书签继续。` : '',
          activeSessionId: sessionId,
          readingLog: [...(store.readingState?.readingLog || []), {
            ...result.log,
            action: result.completed ? (isBookComplete ? 'complete' : 'quota') : 'continue',
            label: result.completed ? (isBookComplete ? '读完了这一本' : '本轮额度已读完') : `读完第 ${result.log?.pageStart}–${result.log?.pageEnd} 页`,
          }].slice(-200),
        })
        if (result.completed) break
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      const store = useStore.getState()
      store.upsertReadingSession({ ...localSession, status: 'paused', lastUpdatedAt: Date.now() })
      store.updateReadingState({
        status: 'error', activity: '阅读暂时停住了',
        error: error?.message || '常驻 Claude Code 暂时无法继续阅读。',
        pauseReason: '书签仍停在上一次持久化成功的位置。',
      })
    }
  })()
  activeRuns.set(sessionId, { controller, promise })
  promise.finally(() => activeRuns.delete(sessionId))
  return promise
}
