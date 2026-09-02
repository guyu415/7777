import { useStore } from '../store'
import { READING_BOOKS, countBookCharacters, flattenBook } from '../data/readingBooks'
import { readOneParagraph } from './aiReading'
import {
  addReadingUsage,
  clampApprovedPages,
  getPageNumber,
  validateReadingQuota,
} from './readingSessions'

// A proactive task may continue while the reader route is closed. Keep one
// in-flight runner per session so reconnects/replayed push messages cannot
// duplicate model calls or spend the same allowance twice.
const activeRuns = new Map()

function makeId(prefix = 'reading') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function charsReadForIds(blocks, ids) {
  const read = new Set(ids || [])
  return blocks.reduce((total, block) => total + (read.has(block.id) ? block.text.replace(/\s/g, '').length : 0), 0)
}

function allAnnotations(readingState) {
  return [
    ...(readingState?.highlights || []),
    ...(readingState?.annotations || []),
  ]
}

function getReadingConfig(store) {
  const session = store.sessions?.find(item => item.id === store.currentSessionId) || store.sessions?.[0]
  const provider = store.providers?.find(item => item.id === store.selectedProviderId)
  return {
    apiKey: session?.apiKey || provider?.apiKey || store.apiKey,
    apiBaseUrl: session?.baseUrl || provider?.baseUrl || store.apiBaseUrl,
    model: session?.model || store.selectedModelId || provider?.models?.[0] || store.model,
    providerName: provider?.id || '',
    workerUrl: store.workerUrl,
    useWorkerProxy: store.useWorkerProxy,
  }
}

function addDuration(session, startedAt, now = Date.now()) {
  return {
    durationMs: (Number(session?.durationMs) || 0) + Math.max(0, now - startedAt),
    lastUpdatedAt: now,
  }
}

function stopForQuota(store, session, readingState, blocks, runStartedAt, reason = 'quota') {
  const now = Date.now()
  const index = Math.max(0, blocks.findIndex(block => block.id === readingState.currentParagraphId))
  const nextParagraph = blocks[index + 1]
  const approvedPages = clampApprovedPages(session.approvedPages, 1)
  store.upsertReadingSession({
    ...session,
    status: 'completed',
    pagesRead: approvedPages,
    currentParagraphId: readingState.currentParagraphId,
    currentPageId: blocks[index]?.pageId || session.currentPageId,
    nextParagraphId: readingState.nextParagraphId || nextParagraph?.id || null,
    completedAt: now,
    ...addDuration(session, runStartedAt, now),
  })
  store.updateReadingState({
    status: 'complete',
    completionReason: reason,
    activity: '本轮额度已读完',
    pauseReason: `本轮已读 ${approvedPages} 页，下一轮会从保存的位置继续。`,
    lastReadAt: now,
  })
  store.updateReadingState({
    readingLog: [...(store.readingState?.readingLog || []), {
      id: makeId('log'),
      action: 'quota',
      label: '本轮额度已读完',
      paragraphId: readingState.currentParagraphId,
      pageId: blocks[index]?.pageId || null,
      pageNumber: blocks[index]?.pageNumber || null,
      createdAt: now,
    }].slice(-200),
  })
}

function stopForBook(store, session, readingState, paragraph, readParagraphIds, totalChars, runStartedAt) {
  const now = Date.now()
  store.upsertReadingSession({
    ...session,
    status: 'completed',
    pagesRead: Math.min(clampApprovedPages(session.approvedPages, 1), Math.max(Number(session.pagesRead) || 0, getPageNumber(paragraph) - getPageNumber({ pageNumber: session.startPage }) + 1)),
    currentParagraphId: paragraph.id,
    currentPageId: paragraph.pageId,
    nextParagraphId: null,
    completedAt: now,
    ...addDuration(session, runStartedAt, now),
  })
  store.updateReadingState({
    status: 'complete',
    completionReason: 'book',
    currentParagraphId: paragraph.id,
    currentChapterId: paragraph.chapterId,
    currentPageId: paragraph.pageId,
    readParagraphIds,
    progressChars: totalChars,
    nextParagraphId: null,
    activity: '读完了这一本',
    pauseReason: '',
    lastReadAt: now,
    readingLog: [...(store.readingState?.readingLog || []), {
      id: makeId('log'),
      action: 'complete',
      label: '读完了这一本',
      paragraphId: paragraph.id,
      chapterId: paragraph.chapterId,
      chapterIndex: paragraph.chapterIndex,
      paragraphIndex: paragraph.paragraphIndex,
      pageId: paragraph.pageId,
      pageNumber: paragraph.pageNumber,
      createdAt: now,
    }].slice(-200),
  })
}

function addBackgroundNote(store, paragraph, action, now) {
  if (!['highlight', 'annotate'].includes(action.action)) return
  const state = store.readingState || {}
  const kind = action.action === 'annotate' && action.annotation ? 'annotate' : 'highlight'
  const quote = action.quote || paragraph.text.slice(0, 70)
  const existing = allAnnotations(state).find(note => note.paragraphId === paragraph.id && note.kind === kind && note.quote === quote)
  if (existing) return
  const note = {
    id: makeId('note'),
    kind,
    paragraphId: paragraph.id,
    chapterId: paragraph.chapterId,
    chapterIndex: paragraph.chapterIndex,
    paragraphIndex: paragraph.paragraphIndex,
    pageId: paragraph.pageId,
    pageNumber: paragraph.pageNumber,
    chapterTitle: paragraph.chapterTitle,
    quote,
    annotation: kind === 'annotate' ? action.annotation : '',
    interest: action.interest,
    createdAt: now,
  }
  store.updateReadingState({
    ...(kind === 'highlight' ? { highlights: [...(state.highlights || []), note] } : { annotations: [...(state.annotations || []), note] }),
  })
  return note
}

function addBackgroundLog(store, paragraph, action, now) {
  const state = store.readingState || {}
  store.updateReadingState({
    readingLog: [...(state.readingLog || []), {
      id: makeId('log'),
      action: action.action,
      label: action.action === 'annotate' ? '写下了一条批注' : action.action === 'highlight' ? '划了一句话' : '继续阅读',
      paragraphId: paragraph.id,
      chapterId: paragraph.chapterId,
      chapterIndex: paragraph.chapterIndex,
      paragraphIndex: paragraph.paragraphIndex,
      pageId: paragraph.pageId,
      pageNumber: paragraph.pageNumber,
      chapterTitle: paragraph.chapterTitle,
      quote: action.quote || '',
      annotation: action.annotation || '',
      createdAt: now,
    }].slice(-200),
  })
}

export function stopProactiveReading(sessionId) {
  if (!sessionId) return
  activeRuns.get(sessionId)?.abort()
}

export function isProactiveReadingActive(sessionId) {
  return Boolean(sessionId && activeRuns.has(sessionId))
}

export function runProactiveReadingInBackground({ sessionId, bookId } = {}) {
  if (!sessionId || activeRuns.has(sessionId)) return activeRuns.get(sessionId) || null
  // The visible reader owns its own timeline and model loop. A proactive
  // session created while that route is open will be picked up there instead.
  if (globalThis.document?.querySelector?.('.ai-reading')) return null

  const controller = new AbortController()
  const promise = (async () => {
    const initialStore = useStore.getState()
    const initialSession = initialStore.readingSessions?.find(item => item.sessionId === sessionId)
    if (!initialSession || initialSession.triggerType !== 'proactive' || !['approved', 'reading'].includes(initialSession.status)) return
    const book = READING_BOOKS.find(item => item.id === bookId || item.id === initialSession.bookId) || READING_BOOKS[0]
    const blocks = flattenBook(book)
    const totalChars = countBookCharacters(book)
    const runStartedAt = Date.now()
    const startedAt = initialSession.startedAt || runStartedAt
    let session = {
      ...initialSession,
      status: 'reading',
      startedAt,
      lastUpdatedAt: runStartedAt,
    }
    initialStore.upsertReadingSession(session)
    initialStore.updateReadingState({
      status: 'reading',
      activeSessionId: sessionId,
      activity: '正在阅读……',
      pauseReason: '',
      error: '',
      lastReadAt: runStartedAt,
    })

    try {
      while (!controller.signal.aborted) {
        const store = useStore.getState()
        const state = store.readingState || {}
        session = store.readingSessions?.find(item => item.sessionId === sessionId)
        if (!session || store.readingState?.activeSessionId !== sessionId) break
        if (['pause', 'error'].includes(state.status)) {
          const now = Date.now()
          store.upsertReadingSession({ ...session, status: 'paused', ...addDuration(session, runStartedAt, now) })
          break
        }
        const index = Math.max(0, blocks.findIndex(block => block.id === state.currentParagraphId))
        const paragraph = blocks[index] || blocks[0]
        const previousParagraph = blocks[index - 1]
        if (!paragraph) break
        const quota = validateReadingQuota({
          sessionId: session.sessionId,
          approvedPages: session.approvedPages,
          pagesRead: session.pagesRead,
          pageNumber: getPageNumber(paragraph),
          startPage: session.startPage,
        })
        if (!quota.ok) {
          stopForQuota(store, session, state, blocks, runStartedAt)
          break
        }

        store.updateReadingState({
          status: 'reading',
          currentParagraphId: paragraph.id,
          currentChapterId: paragraph.chapterId,
          currentPageId: paragraph.pageId,
          currentPage: paragraph.pageNumber,
          activity: '正在阅读……',
          lastReadAt: Date.now(),
        })
        const cachedAction = state.actionCache?.[paragraph.id]
        const action = cachedAction || await readOneParagraph({
          paragraph,
          previousParagraph,
          index,
          config: {
            ...getReadingConfig(store),
            readingQuota: {
              sessionId: session.sessionId,
              approvedPages: session.approvedPages,
              pagesRead: session.pagesRead,
              pageNumber: getPageNumber(paragraph),
              startPage: session.startPage,
            },
          },
          signal: controller.signal,
        })
        if (controller.signal.aborted) break
        const now = Date.now()
        if (!cachedAction) {
          if (action.action !== 'pause') {
            store.updateReadingState({ actionCache: { ...(state.actionCache || {}), [paragraph.id]: action } })
          }
          session = addReadingUsage(session, action.usage)
          store.upsertReadingSession(session)
        }
        if (action.action === 'pause') {
          store.updateReadingState({ status: 'pause', activity: '在这里停了一下', pauseReason: 'AI 选择在这一段停留一会儿。', lastReadAt: now })
          store.upsertReadingSession({ ...session, status: 'paused', currentParagraphId: paragraph.id, currentPageId: paragraph.pageId, ...addDuration(session, runStartedAt, now) })
          addBackgroundLog(store, paragraph, action, now)
          break
        }

        const note = addBackgroundNote(store, paragraph, action, now)
        addBackgroundLog(store, paragraph, action, now)
        const nextReadIds = Array.from(new Set([...(store.readingState?.readParagraphIds || []), paragraph.id]))
        const nextParagraph = blocks[index + 1]
        const nextProgress = charsReadForIds(blocks, nextReadIds)
        const pageComplete = !nextParagraph || getPageNumber(nextParagraph) !== getPageNumber(paragraph)
        const pagesRead = pageComplete
          ? Math.max(Number(session.pagesRead) || 0, getPageNumber(paragraph) - getPageNumber({ pageNumber: session.startPage }) + 1)
          : Number(session.pagesRead) || 0
        store.updateReadingState({
          status: 'reading',
          currentParagraphId: nextParagraph?.id || paragraph.id,
          currentChapterId: nextParagraph?.chapterId || paragraph.chapterId,
          currentPageId: nextParagraph?.pageId || paragraph.pageId,
          currentPage: nextParagraph?.pageNumber || paragraph.pageNumber,
          readParagraphIds: nextReadIds,
          progressChars: nextProgress,
          nextParagraphId: null,
          activity: note ? (note.kind === 'annotate' ? '写下了一条批注' : '划了一句话') : '继续阅读',
          lastReadAt: now,
        })
        session = {
          ...useStore.getState().readingSessions?.find(item => item.sessionId === sessionId),
          status: 'reading',
          currentParagraphId: nextParagraph?.id || paragraph.id,
          currentPageId: nextParagraph?.pageId || paragraph.pageId,
          pagesRead,
          nextParagraphId: null,
        }
        if (!nextParagraph) {
          stopForBook(store, session, store.readingState, paragraph, nextReadIds, totalChars, runStartedAt)
          break
        }
        if (pageComplete && pagesRead >= clampApprovedPages(session.approvedPages, 1)) {
          const latestState = useStore.getState().readingState
          store.upsertReadingSession({ ...session, status: 'completed', pagesRead: clampApprovedPages(session.approvedPages, 1), currentParagraphId: paragraph.id, currentPageId: paragraph.pageId, nextParagraphId: nextParagraph.id, completedAt: now, ...addDuration(session, runStartedAt, now) })
          store.updateReadingState({ ...latestState, status: 'complete', currentParagraphId: paragraph.id, currentChapterId: paragraph.chapterId, currentPageId: paragraph.pageId, currentPage: paragraph.pageNumber, nextParagraphId: nextParagraph.id, completionReason: 'quota', activity: '本轮额度已读完', pauseReason: `本轮已读 ${session.approvedPages} 页，下一轮会从第 ${nextParagraph.pageNumber} 页继续。`, lastReadAt: now })
          break
        }
        store.upsertReadingSession(session)
      }
    } catch (error) {
      if (error?.name === 'AbortError') return
      const store = useStore.getState()
      const current = store.readingSessions?.find(item => item.sessionId === sessionId)
      const now = Date.now()
      if (['reading_quota_exhausted', 'reading_page_limit'].includes(error?.code) && current) {
        stopForQuota(store, current, store.readingState || {}, blocks, runStartedAt)
        return
      }
      if (current) store.upsertReadingSession({ ...current, status: 'paused', ...addDuration(current, runStartedAt, now) })
      store.updateReadingState({ status: 'error', activity: '阅读暂时停住了', error: error?.message || '模型没有返回可用的阅读动作。', pauseReason: '可以重试，AI 会从当前段落继续。' })
    }
  })()
  activeRuns.set(sessionId, promise)
  promise.finally(() => activeRuns.delete(sessionId))
  return promise
}
