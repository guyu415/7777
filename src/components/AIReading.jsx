import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  BookOpen,
  ChevronLeft,
  Clock3,
  Gauge,
  Highlighter,
  Pause,
  PenLine,
  Play,
  RotateCcw,
  ScrollText,
  Sparkles,
  X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../store'
import {
  READING_BOOKS,
  countBookCharacters,
  createInitialReadingState,
  flattenBook,
} from '../data/readingBooks'
import { readOneParagraph } from '../services/aiReading'
import { stopProactiveReading } from '../services/proactiveReading'
import {
  addReadingUsage,
  approveReadingSession,
  clampApprovedPages,
  createReadingSession,
  getPageNumber,
  READING_SPEEDS,
  validateReadingQuota,
} from '../services/readingSessions'

const SPEED_OPTIONS = [READING_SPEEDS.slow, READING_SPEEDS.normal, READING_SPEEDS.fast]

const ACTIVITY_LABELS = {
  reading: '正在阅读……',
  continue: '继续阅读',
  highlight: '划了一句话',
  annotate: '写下了一条批注',
  pause: '在这里停了一下',
  complete: '读完了这一本',
  quota: '本轮额度已读完',
  error: '阅读暂时停住了',
}

function makeId(prefix = 'reading') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function formatTime(timestamp) {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round((Number(milliseconds) || 0) / 1000))
  if (seconds < 60) return `${seconds} 秒`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

function formatLocator(item) {
  if (Number.isFinite(item?.chapterIndex) && Number.isFinite(item?.paragraphIndex)) {
    return `${Number.isFinite(item?.pageNumber) ? `第 ${item.pageNumber} 页 · ` : ''}第 ${item.chapterIndex + 1} 章 · 第 ${item.paragraphIndex + 1} 段`
  }
  return item?.chapterTitle || item?.paragraphId || '正文'
}

function waitWithAbort(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const error = new Error('Aborted')
      error.name = 'AbortError'
      reject(error)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      const error = new Error('Aborted')
      error.name = 'AbortError'
      reject(error)
    }, { once: true })
  })
}

function allAnnotations(readingState) {
  return [
    ...(readingState?.highlights || []),
    ...(readingState?.annotations || []),
  ].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

function charsReadForIds(blocks, ids) {
  const read = new Set(ids || [])
  return blocks.reduce((total, block) => (
    total + (read.has(block.id) ? block.text.replace(/\s/g, '').length : 0)
  ), 0)
}

function renderMarkedText(text, notes, selectedId, onSelect) {
  const ranges = []
  for (const note of notes) {
    if (!note.quote) continue
    const start = text.indexOf(note.quote)
    if (start < 0) continue
    const end = start + note.quote.length
    // Overlapping model output should never make the book unreadable. Keep
    // the first exact range and let the second note remain available below.
    if (ranges.some(range => start < range.end && end > range.start)) continue
    ranges.push({ start, end, note })
  }
  ranges.sort((a, b) => a.start - b.start)

  if (!ranges.length) return text
  const parts = []
  let cursor = 0
  ranges.forEach(({ start, end, note }) => {
    if (start > cursor) parts.push(text.slice(cursor, start))
    parts.push(
      <button
        key={`${note.id}-${start}`}
        type="button"
        className={`ai-reading__mark ai-reading__mark--${note.kind || 'highlight'} ${selectedId === note.id ? 'is-selected' : ''}`}
        onClick={() => onSelect(note.id)}
        aria-label={note.annotation ? `查看批注：${note.annotation}` : '查看 AI 高亮'}
      >
        {text.slice(start, end)}
      </button>,
    )
    cursor = end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

function ParagraphBlock({ block, status, notes, selectedId, onSelect, onOpenNote }) {
  const selectedNote = notes.find(note => note.id === selectedId)
  const hasNotes = notes.length > 0
  return (
    <article
      className={`ai-reading__paragraph ${status ? `is-${status}` : ''} ${hasNotes ? 'has-note' : ''}`}
      data-paragraph-id={block.id}
    >
      <div className="ai-reading__paragraph-index" aria-hidden="true">
        {String(block.paragraphIndex + 1).padStart(2, '0')}
      </div>
      <div className="ai-reading__paragraph-copy">
        <p>{renderMarkedText(block.text, notes, selectedId, onSelect)}</p>
        {status === 'reading' && (
          <span className="ai-reading__reading-caret" aria-label="AI 正在阅读" />
        )}
        {hasNotes && (
          <div className="ai-reading__note-stack">
            {notes.map(note => {
              const expanded = selectedId === note.id
              return (
                <button
                  key={note.id}
                  type="button"
                  className={`ai-reading__inline-note ${expanded ? 'is-expanded' : ''}`}
                  onClick={() => onOpenNote(note.id)}
                >
                  <span className="ai-reading__inline-note-icon">
                    {note.kind === 'annotate' ? <PenLine size={13} /> : <Highlighter size={13} />}
                  </span>
                  <span className="ai-reading__inline-note-body">
                    <span className="ai-reading__inline-note-meta">
                      {note.kind === 'annotate' ? 'AI 批注' : 'AI 高亮'} · {formatTime(note.createdAt)}
                    </span>
                    <span className={`ai-reading__inline-note-text ${expanded ? '' : 'is-folded'}`}>
                      {note.annotation || '这一处值得留意。'}
                    </span>
                  </span>
                  <span className="ai-reading__inline-note-chevron">{expanded ? '收起' : '展开'}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </article>
  )
}

function ReadingOverlay({ type, notes, logs, onClose, onSelectNote }) {
  const [expandedLog, setExpandedLog] = useState(null)
  return (
    <div className="ai-reading__overlay" role="dialog" aria-modal="true" aria-label={type === 'notes' ? '全部 AI 批注' : '阅读日志'}>
      <button className="ai-reading__overlay-backdrop" type="button" onClick={onClose} aria-label="关闭" />
      <section className="ai-reading__sheet">
        <div className="ai-reading__sheet-handle" aria-hidden="true" />
        <header className="ai-reading__sheet-header">
          <div>
            <strong>{type === 'notes' ? '全部 AI 批注' : '阅读日志'}</strong>
            <span>{type === 'notes' ? `${notes.length} 条安静的标记` : `${logs.length} 次阅读动作`}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className="ai-reading__sheet-body">
          {type === 'notes' ? (
            notes.length ? notes.map(note => (
              <button key={note.id} type="button" className="ai-reading__sheet-note" onClick={() => onSelectNote(note.id)}>
                <span className="ai-reading__sheet-note-mark"><Highlighter size={14} /></span>
                <span>
                  <small>{note.kind === 'annotate' ? '批注' : '高亮'} · {formatLocator(note)} · {formatTime(note.createdAt)}</small>
                  <q>{note.quote}</q>
                  {note.annotation && <em>{note.annotation}</em>}
                </span>
              </button>
            )) : <EmptyPanel text="AI 还没有留下批注。它会在真正值得停留的地方才动笔。" />
          ) : (
            logs.length ? [...logs].reverse().map(entry => {
              const expanded = expandedLog === entry.id
              return (
                <button key={entry.id} type="button" className={`ai-reading__log-entry ${expanded ? 'is-expanded' : ''}`} onClick={() => setExpandedLog(expanded ? null : entry.id)}>
                  <span className="ai-reading__log-dot" />
                  <span className="ai-reading__log-copy">
                    <strong>{entry.label || ACTIVITY_LABELS[entry.action] || '阅读动作'}</strong>
                    <small>{formatTime(entry.createdAt)} · {formatLocator(entry)}</small>
                    {entry.quote && <q className={expanded ? '' : 'is-folded'}>{entry.quote}</q>}
                  </span>
                  {entry.quote && <span className="ai-reading__log-more">{expanded ? '收起' : '详情'}</span>}
                </button>
              )
            }) : <EmptyPanel text="从开始阅读起，AI 的每次停留都会在这里留下时间和正文定位。" />
          )}
        </div>
      </section>
    </div>
  )
}

function EmptyPanel({ text }) {
  return <div className="ai-reading__empty-panel"><Sparkles size={17} /><p>{text}</p></div>
}

export default function AIReading({ theme, onBack }) {
  const {
    readingState,
    updateReadingState,
    readingSessions,
    upsertReadingSession,
    updateReadingSession,
    sessions,
    currentSessionId,
    providers,
    selectedProviderId,
    selectedModelId,
    apiKey,
    apiBaseUrl,
    model,
    workerUrl,
    useWorkerProxy,
  } = useStore(useShallow(state => ({
    readingState: state.readingState,
    updateReadingState: state.updateReadingState,
    readingSessions: state.readingSessions,
    upsertReadingSession: state.upsertReadingSession,
    updateReadingSession: state.updateReadingSession,
    sessions: state.sessions,
    currentSessionId: state.currentSessionId,
    providers: state.providers,
    selectedProviderId: state.selectedProviderId,
    selectedModelId: state.selectedModelId,
    apiKey: state.apiKey,
    apiBaseUrl: state.apiBaseUrl,
    model: state.model,
    workerUrl: state.workerUrl,
    useWorkerProxy: state.useWorkerProxy,
  })))

  const state = readingState || createInitialReadingState()
  const book = READING_BOOKS.find(item => item.id === state.bookId) || READING_BOOKS[0]
  const blocks = useMemo(() => flattenBook(book), [book])
  const totalChars = useMemo(() => countBookCharacters(book), [book])
  const currentIndex = Math.max(0, blocks.findIndex(block => block.id === state.currentParagraphId))
  const currentBlock = blocks[currentIndex] || blocks[0]
  const readingSession = readingSessions?.find(item => item.sessionId === state.activeSessionId) || null
  const currentPage = getPageNumber(currentBlock)

  // If a proactive task was already running while the user was away, the
  // visible reader takes over its single session. Aborting the background
  // controller avoids a duplicate model request and leaves this timeline in
  // charge of the exact persisted paragraph cursor.
  useEffect(() => {
    if (readingSession?.triggerType === 'proactive' && readingSession.status === 'reading') {
      stopProactiveReading(readingSession.sessionId)
    }
  }, [readingSession?.sessionId, readingSession?.status])

  const readIds = state.readParagraphIds || []
  const readChars = Math.min(totalChars, Math.max(
    Number(state.progressChars) || 0,
    charsReadForIds(blocks, readIds),
  ))
  const progress = totalChars ? Math.round((readChars / totalChars) * 100) : 0
  const annotations = useMemo(() => allAnnotations(state), [state.annotations, state.highlights])
  const notesByParagraph = useMemo(() => {
    const result = new Map()
    annotations.forEach(note => {
      const existing = result.get(note.paragraphId) || []
      result.set(note.paragraphId, [...existing, note])
    })
    return result
  }, [annotations])
  const chapter = book.chapters.find(item => item.id === currentBlock?.chapterId) || book.chapters[0]
  const chapterNumber = Math.max(1, book.chapters.findIndex(item => item.id === chapter?.id) + 1)

  const session = sessions?.find(item => item.id === currentSessionId) || sessions?.[0]
  const provider = providers?.find(item => item.id === selectedProviderId)
  const readingConfig = useMemo(() => ({
    apiKey: session?.apiKey || provider?.apiKey || apiKey,
    apiBaseUrl: session?.baseUrl || provider?.baseUrl || apiBaseUrl,
    model: session?.model || selectedModelId || provider?.models?.[0] || model,
    providerName: provider?.id || '',
    workerUrl,
    useWorkerProxy,
  }), [session, provider, selectedModelId, apiKey, apiBaseUrl, model, workerUrl, useWorkerProxy])

  const [panel, setPanel] = useState(null)
  const [selectedNoteId, setSelectedNoteId] = useState(null)
  const [followAi, setFollowAi] = useState(true)
  const rootRef = useRef(null)
  const paragraphRefs = useRef({})
  const readingStateRef = useRef(state)
  const runRef = useRef(0)
  const abortRef = useRef(null)
  const runningRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const pageParagraphCountRef = useRef(new Map())
  const sessionRunStartedAtRef = useRef(null)

  useEffect(() => {
    readingStateRef.current = state
  }, [state])

  useEffect(() => {
    const counts = new Map()
    blocks.forEach(block => counts.set(block.pageNumber, (counts.get(block.pageNumber) || 0) + 1))
    pageParagraphCountRef.current = counts
  }, [blocks])

  // A refresh cannot keep an in-flight request alive. Turn a persisted
  // transient status into a safe pause while keeping the exact cursor.
  useEffect(() => {
    if (!runningRef.current && (state.status === 'reading' || state.status === 'highlight' || state.status === 'annotate')) {
      updateReadingState({
        status: 'pause',
        activity: '已保存阅读位置，等你继续',
        pauseReason: '页面重新打开后，AI 从原段落等待继续。',
      })
      if (state.activeSessionId) {
        const cursor = blocks.find(block => block.id === state.currentParagraphId)
        updateReadingSession(state.activeSessionId, {
          status: 'paused',
          currentParagraphId: state.currentParagraphId,
          currentPageId: cursor?.pageId || null,
          nextParagraphId: state.nextParagraphId || null,
        })
      }
    }
  }, [blocks, state.activeSessionId, state.currentParagraphId, state.nextParagraphId, state.status, updateReadingSession, updateReadingState])

  useEffect(() => () => {
    runRef.current += 1
    abortRef.current?.abort()
    runningRef.current = false
    const live = readingStateRef.current
    if (['reading', 'highlight', 'annotate'].includes(live.status)) {
      updateReadingState({
        status: 'pause',
        activity: '已保存阅读位置，等你继续',
        pauseReason: '离开页面后，AI 会从原段落继续。',
      })
      if (live.activeSessionId) {
        const cursor = blocks.find(block => block.id === live.currentParagraphId)
        const startedAt = sessionRunStartedAtRef.current
        const currentSession = useStore.getState().readingSessions?.find(item => item.sessionId === live.activeSessionId)
        updateReadingSession(live.activeSessionId, {
          status: 'paused',
          currentParagraphId: live.currentParagraphId,
          currentPageId: cursor?.pageId || null,
          nextParagraphId: live.nextParagraphId || null,
          ...(startedAt && currentSession
            ? { durationMs: (Number(currentSession.durationMs) || 0) + Math.max(0, Date.now() - startedAt) }
            : {}),
        })
      }
    }
  }, [blocks, updateReadingSession, updateReadingState])

  const patchReading = useCallback((updates) => {
    const next = { ...readingStateRef.current, ...updates }
    readingStateRef.current = next
    updateReadingState(updates)
  }, [updateReadingState])

  const addLog = useCallback((entry) => {
    const nextLog = [...(readingStateRef.current.readingLog || []), entry].slice(-200)
    patchReading({ readingLog: nextLog })
  }, [patchReading])

  const scrollToCurrent = useCallback((enableFollow = true) => {
    if (!currentBlock) return
    const element = paragraphRefs.current[currentBlock.id]
    if (!element) return
    if (enableFollow) setFollowAi(true)
    programmaticScrollRef.current = true
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    window.setTimeout(() => { programmaticScrollRef.current = false }, 700)
  }, [currentBlock])

  useEffect(() => {
    if (!followAi || !currentBlock || !runningRef.current) return undefined
    const timer = window.setTimeout(() => scrollToCurrent(false), 120)
    return () => window.clearTimeout(timer)
  }, [currentBlock?.id, followAi, scrollToCurrent])

  const writeReadingSession = useCallback((sessionId, updates) => {
    if (!sessionId) return null
    const current = useStore.getState().readingSessions?.find(item => item.sessionId === sessionId)
    if (!current) return null
    const next = { ...current, ...updates, lastUpdatedAt: Date.now() }
    upsertReadingSession(next)
    return next
  }, [upsertReadingSession])

  const ensureReadingSession = useCallback((liveState) => {
    const store = useStore.getState()
    const existing = store.readingSessions?.find(item => item.sessionId === liveState.activeSessionId)
    if (existing && ['pending', 'approved', 'reading', 'paused'].includes(existing.status)) return existing

    const startId = liveState.nextParagraphId || liveState.currentParagraphId || blocks[0]?.id
    const startParagraph = blocks.find(block => block.id === startId) || blocks[0]
    if (!startParagraph) return null
    const lastPage = getPageNumber(blocks[blocks.length - 1])
    const pagesAvailable = Math.max(1, lastPage - getPageNumber(startParagraph) + 1)
    const session = approveReadingSession(createReadingSession({
      triggerType: 'manual',
      bookId: book.id,
      startParagraph,
      approvedPages: Math.min(20, pagesAvailable),
      requestedPages: Math.min(20, pagesAvailable),
    }), Math.min(20, pagesAvailable))
    upsertReadingSession(session)
    patchReading({
      activeSessionId: session.sessionId,
      currentParagraphId: startParagraph.id,
      currentChapterId: startParagraph.chapterId,
      currentPageId: startParagraph.pageId,
      currentPage: startParagraph.pageNumber,
      nextParagraphId: null,
      completionReason: '',
    })
    return session
  }, [blocks, book.id, patchReading, upsertReadingSession])

  const runReading = useCallback(async () => {
    if (runningRef.current || !blocks.length) return
    const token = ++runRef.current
    const controller = new AbortController()
    abortRef.current = controller
    runningRef.current = true
    const started = readingStateRef.current
    if (started.status === 'complete' && started.completionReason !== 'quota') {
      runningRef.current = false
      abortRef.current = null
      return
    }
    const session = ensureReadingSession(started)
    if (!session) {
      runningRef.current = false
      abortRef.current = null
      return
    }
    const runStartedAt = Date.now()
    sessionRunStartedAtRef.current = runStartedAt
    const sessionStartTime = session.startedAt || runStartedAt
    writeReadingSession(session.sessionId, {
      status: 'reading',
      startedAt: sessionStartTime,
      currentParagraphId: started.currentParagraphId,
      currentPageId: blocks.find(block => block.id === started.currentParagraphId)?.pageId || session.currentPageId,
    })
    patchReading({
      status: 'reading',
      activity: '正在阅读……',
      pauseReason: '',
      error: '',
      lastReadAt: Date.now(),
      activeSessionId: session.sessionId,
    })

    try {
      while (token === runRef.current && !controller.signal.aborted) {
        const live = readingStateRef.current
        if (live.status === 'pause' || live.status === 'error' || live.status === 'complete') break
        const liveSession = useStore.getState().readingSessions?.find(item => item.sessionId === session.sessionId)
        if (!liveSession) break
        const index = Math.max(0, blocks.findIndex(block => block.id === live.currentParagraphId))
        const paragraph = blocks[index] || blocks[0]
        if (!paragraph) break
        const previousParagraph = blocks[index - 1]
        const nextParagraph = blocks[index + 1]
        const quota = validateReadingQuota({
          sessionId: liveSession.sessionId,
          approvedPages: liveSession.approvedPages,
          pagesRead: liveSession.pagesRead,
          pageNumber: getPageNumber(paragraph),
          startPage: liveSession.startPage,
        })
        if (!quota.ok) {
          const completedAt = Date.now()
          const elapsed = Math.max(0, completedAt - runStartedAt)
          sessionRunStartedAtRef.current = null
          writeReadingSession(liveSession.sessionId, {
            status: 'completed',
            pagesRead: clampApprovedPages(liveSession.approvedPages, 1),
            currentParagraphId: live.currentParagraphId,
            currentPageId: blocks.find(block => block.id === live.currentParagraphId)?.pageId || liveSession.currentPageId,
            completedAt,
            durationMs: (Number(liveSession.durationMs) || 0) + elapsed,
            nextParagraphId: live.nextParagraphId || live.currentParagraphId,
          })
          patchReading({
            status: 'complete',
            completionReason: 'quota',
            activity: ACTIVITY_LABELS.quota,
            pauseReason: `本轮已读 ${liveSession.approvedPages} 页，下一轮会从保存的位置继续。`,
            lastReadAt: completedAt,
          })
          addLog({ id: makeId('log'), action: 'quota', label: ACTIVITY_LABELS.quota, paragraphId: live.currentParagraphId, createdAt: completedAt })
          break
        }
        patchReading({
          status: 'reading',
          currentParagraphId: paragraph.id,
          currentChapterId: paragraph.chapterId,
          currentPageId: paragraph.pageId,
          currentPage: paragraph.pageNumber,
          activity: '正在阅读……',
          lastReadAt: Date.now(),
          error: '',
        })

        const cachedAction = readingStateRef.current.actionCache?.[paragraph.id]
        const action = cachedAction || await readOneParagraph({
          paragraph,
          previousParagraph,
          index,
          config: {
            ...readingConfig,
            readingQuota: {
              sessionId: liveSession.sessionId,
              approvedPages: liveSession.approvedPages,
              pagesRead: liveSession.pagesRead,
              pageNumber: getPageNumber(paragraph),
              startPage: liveSession.startPage,
            },
          },
          signal: controller.signal,
        })
        if (token !== runRef.current || controller.signal.aborted) break
        if (readingStateRef.current.status === 'pause') break

        if (!cachedAction) {
          // A model pause is a transient decision. Do not cache it forever or
          // the next explicit Continue would immediately pause on the same
          // paragraph again.
          if (action.action !== 'pause') {
            patchReading({ actionCache: { ...(readingStateRef.current.actionCache || {}), [paragraph.id]: action } })
          }
          const nextSession = addReadingUsage(liveSession, action.usage)
          upsertReadingSession(nextSession)
        }

        const now = Date.now()
        const logBase = {
          id: makeId('log'),
          paragraphId: paragraph.id,
          chapterId: paragraph.chapterId,
          chapterIndex: paragraph.chapterIndex,
          paragraphIndex: paragraph.paragraphIndex,
          pageId: paragraph.pageId,
          pageNumber: paragraph.pageNumber,
          chapterTitle: paragraph.chapterTitle,
          quote: action.quote || '',
          createdAt: now,
        }

        if (action.action === 'pause') {
          addLog({ ...logBase, action: 'pause', label: ACTIVITY_LABELS.pause })
          patchReading({
            status: 'pause',
            activity: ACTIVITY_LABELS.pause,
            pauseReason: 'AI 选择在这一段停留一会儿。',
            lastReadAt: now,
          })
          sessionRunStartedAtRef.current = null
          writeReadingSession(liveSession.sessionId, { status: 'paused', currentParagraphId: paragraph.id, currentPageId: paragraph.pageId, durationMs: (Number(liveSession.durationMs) || 0) + Math.max(0, now - runStartedAt) })
          break
        }

        if (action.action === 'highlight' || action.action === 'annotate') {
          patchReading({
            status: 'pause',
            activity: ACTIVITY_LABELS.pause,
            pauseReason: 'AI 正在决定要不要留下这一笔。',
            lastReadAt: now,
          })
          await waitWithAbort(320, controller.signal)
          if (token !== runRef.current || controller.signal.aborted) break
          const kind = action.action === 'annotate' && action.annotation ? 'annotate' : 'highlight'
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
            quote: action.quote || paragraph.text.slice(0, 70),
            annotation: kind === 'annotate' ? action.annotation : '',
            interest: action.interest,
            createdAt: now,
          }
          const previousNote = allAnnotations(readingStateRef.current).find(existing => (
            existing.paragraphId === note.paragraphId
            && existing.kind === note.kind
            && existing.quote === note.quote
          ))
          const key = kind === 'highlight' ? 'highlights' : 'annotations'
          patchReading({
            ...(previousNote ? {} : { [key]: [...(readingStateRef.current[key] || []), note] }),
            status: kind,
            activity: ACTIVITY_LABELS[kind],
            pauseReason: '',
            lastReadAt: now,
          })
          writeReadingSession(liveSession.sessionId, {
            status: kind === 'annotate' || kind === 'highlight' ? 'reading' : liveSession.status,
            currentParagraphId: paragraph.id,
            currentPageId: paragraph.pageId,
            newAnnotations: (Number(liveSession.newAnnotations) || 0) + (previousNote ? 0 : 1),
          })
          addLog({
            ...logBase,
            action: kind,
            label: ACTIVITY_LABELS[kind],
            quote: note.quote,
            annotation: note.annotation,
          })
          setSelectedNoteId(previousNote?.id || note.id)
          await waitWithAbort(900, controller.signal)
          if (token !== runRef.current || controller.signal.aborted) break
        } else {
          addLog({ ...logBase, action: 'continue', label: ACTIVITY_LABELS.continue })
          patchReading({ status: 'reading', activity: ACTIVITY_LABELS.continue, lastReadAt: now })
        }

        const nextReadIds = Array.from(new Set([...(readingStateRef.current.readParagraphIds || []), paragraph.id]))
        const nextProgress = charsReadForIds(blocks, nextReadIds)
        const pageComplete = !nextParagraph || getPageNumber(nextParagraph) !== getPageNumber(paragraph)
        const pagesRead = pageComplete
          ? Math.max(Number(liveSession.pagesRead) || 0, getPageNumber(paragraph) - getPageNumber({ pageNumber: liveSession.startPage }) + 1)
          : Number(liveSession.pagesRead) || 0
        if (!nextParagraph) {
          const completedAt = Date.now()
          sessionRunStartedAtRef.current = null
          writeReadingSession(liveSession.sessionId, {
            status: 'completed',
            pagesRead: Math.min(liveSession.approvedPages, pagesRead),
            currentParagraphId: paragraph.id,
            currentPageId: paragraph.pageId,
            nextParagraphId: null,
            completedAt,
            durationMs: (Number(liveSession.durationMs) || 0) + Math.max(0, completedAt - runStartedAt),
          })
          patchReading({
            status: 'complete',
            currentParagraphId: paragraph.id,
            currentPageId: paragraph.pageId,
            currentChapterId: paragraph.chapterId,
            readParagraphIds: nextReadIds,
            progressChars: totalChars,
            activity: ACTIVITY_LABELS.complete,
            completionReason: 'book',
            nextParagraphId: null,
            pauseReason: '',
            lastReadAt: Date.now(),
          })
          addLog({
            id: makeId('log'),
            action: 'complete',
            label: ACTIVITY_LABELS.complete,
            paragraphId: paragraph.id,
            chapterId: paragraph.chapterId,
            chapterIndex: paragraph.chapterIndex,
            paragraphIndex: paragraph.paragraphIndex,
            pageId: paragraph.pageId,
            pageNumber: paragraph.pageNumber,
            chapterTitle: paragraph.chapterTitle,
            createdAt: Date.now(),
          })
          break
        }

        if (pageComplete && pagesRead >= clampApprovedPages(liveSession.approvedPages, 1)) {
          const completedAt = Date.now()
          sessionRunStartedAtRef.current = null
          writeReadingSession(liveSession.sessionId, {
            status: 'completed',
            pagesRead: clampApprovedPages(liveSession.approvedPages, 1),
            currentParagraphId: paragraph.id,
            currentPageId: paragraph.pageId,
            nextParagraphId: nextParagraph.id,
            completedAt,
            durationMs: (Number(liveSession.durationMs) || 0) + Math.max(0, completedAt - runStartedAt),
          })
          patchReading({
            status: 'complete',
            currentParagraphId: paragraph.id,
            currentChapterId: paragraph.chapterId,
            currentPageId: paragraph.pageId,
            currentPage: paragraph.pageNumber,
            readParagraphIds: nextReadIds,
            progressChars: nextProgress,
            nextParagraphId: nextParagraph.id,
            completionReason: 'quota',
            activity: ACTIVITY_LABELS.quota,
            pauseReason: `本轮已读 ${liveSession.approvedPages} 页，下一轮会从第 ${nextParagraph.pageNumber} 页继续。`,
            lastReadAt: completedAt,
          })
          addLog({
            id: makeId('log'),
            action: 'quota',
            label: ACTIVITY_LABELS.quota,
            paragraphId: paragraph.id,
            pageNumber: paragraph.pageNumber,
            createdAt: completedAt,
          })
          break
        }

        patchReading({
          status: 'reading',
          currentParagraphId: nextParagraph.id,
          currentPageId: nextParagraph.pageId,
          currentChapterId: nextParagraph.chapterId,
          currentPage: nextParagraph.pageNumber,
          readParagraphIds: nextReadIds,
          progressChars: nextProgress,
          activity: ACTIVITY_LABELS.continue,
          lastReadAt: Date.now(),
        })
        writeReadingSession(liveSession.sessionId, {
          status: 'reading',
          currentParagraphId: nextParagraph.id,
          currentPageId: nextParagraph.pageId,
          pagesRead,
          nextParagraphId: null,
        })
        const speed = SPEED_OPTIONS.find(option => option.id === readingStateRef.current.speed) || SPEED_OPTIONS[1]
        const paragraphCountOnPage = pageParagraphCountRef.current.get(getPageNumber(paragraph)) || 1
        await waitWithAbort(Math.max(1000, Math.round(speed.pageDurationMs / paragraphCountOnPage)), controller.signal)
      }
    } catch (error) {
      if (error?.name !== 'AbortError' && token === runRef.current) {
        // The Worker is authoritative when a request races the page-boundary
        // update. Treat its hard-stop response as a normal completed session,
        // never as a retryable model error.
        if (['reading_quota_exhausted', 'reading_page_limit'].includes(error?.code)) {
          const quotaAt = Date.now()
          const live = readingStateRef.current
          const liveSession = useStore.getState().readingSessions?.find(item => item.sessionId === live.activeSessionId)
          const index = Math.max(0, blocks.findIndex(block => block.id === live.currentParagraphId))
          const nextParagraph = blocks[index + 1]
          sessionRunStartedAtRef.current = null
          if (liveSession) {
            writeReadingSession(liveSession.sessionId, {
              status: 'completed',
              pagesRead: clampApprovedPages(liveSession.approvedPages, 1),
              currentParagraphId: live.currentParagraphId,
              currentPageId: blocks[index]?.pageId || liveSession.currentPageId,
              nextParagraphId: live.nextParagraphId || nextParagraph?.id || null,
              completedAt: quotaAt,
              durationMs: (Number(liveSession.durationMs) || 0) + Math.max(0, quotaAt - runStartedAt),
            })
          }
          patchReading({
            status: 'complete',
            completionReason: 'quota',
            activity: ACTIVITY_LABELS.quota,
            pauseReason: liveSession ? `本轮已读 ${liveSession.approvedPages} 页，下一轮会从保存的位置继续。` : '本轮阅读额度已用完。',
            lastReadAt: quotaAt,
          })
          addLog({ id: makeId('log'), action: 'quota', label: ACTIVITY_LABELS.quota, paragraphId: live.currentParagraphId, createdAt: quotaAt })
          return
        }
        const message = error?.message || '模型没有返回可用的阅读动作。'
        const errorAt = Date.now()
        const runStartedAt = sessionRunStartedAtRef.current
        sessionRunStartedAtRef.current = null
        addLog({
          id: makeId('log'),
          action: 'error',
          label: '阅读遇到一点阻塞',
          paragraphId: readingStateRef.current.currentParagraphId,
          chapterId: readingStateRef.current.currentChapterId,
          createdAt: Date.now(),
        })
        patchReading({
          status: 'error',
          activity: ACTIVITY_LABELS.error,
          error: message,
          pauseReason: '可以重试，AI 会从当前段落继续。',
        })
        const liveSession = useStore.getState().readingSessions?.find(item => item.sessionId === readingStateRef.current.activeSessionId)
        if (liveSession) writeReadingSession(liveSession.sessionId, {
          status: 'paused',
          currentParagraphId: readingStateRef.current.currentParagraphId,
          ...(runStartedAt ? { durationMs: (Number(liveSession.durationMs) || 0) + Math.max(0, errorAt - runStartedAt) } : {}),
        })
      }
    } finally {
      if (token === runRef.current) {
        runningRef.current = false
        abortRef.current = null
      }
    }
  }, [addLog, blocks, ensureReadingSession, patchReading, readingConfig, totalChars, upsertReadingSession, writeReadingSession])

  const pauseReading = useCallback(() => {
    if (!runningRef.current && readingStateRef.current.status !== 'reading' && readingStateRef.current.status !== 'highlight' && readingStateRef.current.status !== 'annotate') return
    runRef.current += 1
    abortRef.current?.abort()
    runningRef.current = false
    const current = readingStateRef.current.currentParagraphId
    patchReading({
      status: 'pause',
      activity: '已暂停，停在这一段',
      pauseReason: `下次继续会从 ${current || '当前段落'} 接着读。`,
      lastReadAt: Date.now(),
    })
    const runStartedAt = sessionRunStartedAtRef.current
    sessionRunStartedAtRef.current = null
    const sessionUpdate = {
      status: 'paused',
      currentParagraphId: current,
      currentPageId: blocks.find(block => block.id === current)?.pageId || null,
      nextParagraphId: readingStateRef.current.nextParagraphId || null,
    }
    if (runStartedAt) {
      const liveSession = useStore.getState().readingSessions?.find(item => item.sessionId === readingStateRef.current.activeSessionId)
      sessionUpdate.durationMs = (Number(liveSession?.durationMs) || 0) + Math.max(0, Date.now() - runStartedAt)
    }
    writeReadingSession(readingStateRef.current.activeSessionId, sessionUpdate)
  }, [patchReading, writeReadingSession])

  const resetReading = useCallback(() => {
    runRef.current += 1
    abortRef.current?.abort()
    runningRef.current = false
    patchReading({ ...createInitialReadingState(book), speed: readingStateRef.current.speed })
    setSelectedNoteId(null)
    setFollowAi(true)
  }, [book, patchReading])

  const handleMainControl = () => {
    if (state.status === 'complete') {
      if (state.completionReason === 'quota') {
        if (readingSession?.triggerType === 'chat_request') return
        void runReading()
      } else {
        resetReading()
      }
      return
    }
    if (runningRef.current || ['reading', 'highlight', 'annotate'].includes(state.status)) {
      pauseReading()
    } else {
      void runReading()
    }
  }

  // An approved chat request is deliberately the only case that starts
  // without a second click. The session is already approved by the user;
  // this effect merely hands it to the same reader loop used by manual mode.
  useEffect(() => {
    if (state.status !== 'idle' || readingSession?.status !== 'approved') return undefined
    const timer = window.setTimeout(() => { void runReading() }, 0)
    return () => window.clearTimeout(timer)
  }, [readingSession?.sessionId, readingSession?.status, runReading, state.status])

  const handleSpeed = (speed) => {
    patchReading({ speed })
  }

  const selectNote = (noteId) => {
    setPanel(null)
    setSelectedNoteId(noteId)
    const note = annotations.find(item => item.id === noteId)
    if (note) {
      const element = paragraphRefs.current[note.paragraphId]
      if (element) {
        programmaticScrollRef.current = true
        element.scrollIntoView({ behavior: 'smooth', block: 'center' })
        window.setTimeout(() => { programmaticScrollRef.current = false }, 700)
      }
    }
  }

  const handleScroll = () => {
    if (!programmaticScrollRef.current) setFollowAi(false)
  }

  const status = state.status || 'idle'
  const isActive = runningRef.current || ['reading', 'highlight', 'annotate'].includes(status)
  const speed = SPEED_OPTIONS.find(option => option.id === state.speed) || SPEED_OPTIONS[1]
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#756ea8'

  return (
    <main
      className="ai-reading"
      style={{ '--reading-primary': primary, '--reading-primary-dark': primaryDark }}
    >
      <header className="ai-reading__topbar">
        <button type="button" className="ai-reading__back" onClick={onBack} aria-label="回到首页">
          <ChevronLeft size={20} />
        </button>
        <div className="ai-reading__topbar-title">
          <span><BookOpen size={14} /> AI 自主阅读</span>
          <small>你可以旁观，也可以随时翻页</small>
        </div>
        <button type="button" className="ai-reading__locate" onClick={() => scrollToCurrent(true)} aria-label="回到 AI 当前阅读位置" title="回到 AI 当前阅读位置">
          <ArrowDownToLine size={17} />
        </button>
      </header>

      <section className="ai-reading__progress-card" aria-label="阅读进度">
        <div className="ai-reading__book-line">
          <div>
            <span className="ai-reading__eyebrow">AI 正在读</span>
            <h1>《{book.title}》</h1>
          </div>
          <span className={`ai-reading__status-dot is-${status}`} aria-label={ACTIVITY_LABELS[status] || status} />
        </div>
        <div className="ai-reading__progress-copy">
          <span>第 {chapterNumber} 章 · 第 {currentPage} 页 · {progress}%</span>
          <span>{formatNumber(readChars)} / {formatNumber(totalChars)} 字</span>
        </div>
        <div className="ai-reading__progress-track" aria-label={`已读 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="ai-reading__meta-line">
          <span><Highlighter size={12} /> 批注 {annotations.length} 条</span>
          <span><Clock3 size={12} /> 最近 {formatTime(state.lastReadAt)}</span>
          {readingSession && <span className="ai-reading__quota">本轮 {Math.min(readingSession.pagesRead || 0, readingSession.approvedPages || 0)} / {readingSession.approvedPages} 页</span>}
          <span className="ai-reading__activity"><i /> {state.activity || '等 AI 翻开这一页'}</span>
        </div>
        {(state.pauseReason || state.error) && (
          <div className={`ai-reading__pause-note ${state.error ? 'is-error' : ''}`}>
            <span>{state.error ? '阅读遇到一点阻塞' : state.pauseReason}</span>
            {state.error && <small>{state.error}</small>}
          </div>
        )}
        <div className="ai-reading__model-line">
          <span className="ai-reading__model-pulse" />
          {readingConfig.apiKey ? '使用当前模型逐段阅读' : '未配置模型，使用本地逐段阅读引擎'}
          {readingSession && <small> · 本轮 {readingSession.modelCalls || 0} 次调用 · 约 {formatNumber(readingSession.totalTokens || 0)} tokens</small>}
        </div>
        {readingSession && (
          <div className="ai-reading__session-line" aria-label="本轮阅读统计">
            <span>本轮第 {readingSession.startPage}–{readingSession.endPage} 页</span>
            <span>已读 {Math.min(readingSession.pagesRead || 0, readingSession.approvedPages || 0)} / {readingSession.approvedPages} 页</span>
            <span>时长 {formatDuration(readingSession.durationMs)}</span>
            <span>新增批注 {readingSession.newAnnotations || 0}</span>
          </div>
        )}
      </section>

      <div className="ai-reading__body" ref={rootRef} onScroll={handleScroll}>
        <div className="ai-reading__body-intro">
          <span>{book.author}</span>
          <p>{book.description}</p>
        </div>
        {book.chapters.map(chapterItem => (
          <section className="ai-reading__chapter" key={chapterItem.id}>
            <div className="ai-reading__chapter-heading">
              <span>{String(book.chapters.indexOf(chapterItem) + 1).padStart(2, '0')}</span>
              <h2>{chapterItem.title.replace(/^第[一二三四五六七八九十]+章\s*/, '')}</h2>
            </div>
            {chapterItem.paragraphs.map(paragraph => {
              const paragraphStatus = paragraph.id === state.currentParagraphId
                ? status === 'pause' || status === 'error' || status === 'idle' || status === 'complete' ? 'current' : 'reading'
                : readIds.includes(paragraph.id) ? 'read' : 'unread'
              return (
                <div key={paragraph.id} ref={element => { paragraphRefs.current[paragraph.id] = element }}>
                  <ParagraphBlock
                    block={{ ...paragraph, paragraphIndex: chapterItem.paragraphs.indexOf(paragraph) }}
                    status={paragraphStatus}
                    notes={notesByParagraph.get(paragraph.id) || []}
                    selectedId={selectedNoteId}
                    onSelect={setSelectedNoteId}
                    onOpenNote={setSelectedNoteId}
                  />
                </div>
              )
            })}
          </section>
        ))}
        <div className="ai-reading__end-mark"><span />这本书的下一页，还没有被翻开<span /></div>
      </div>

      {!followAi && (
        <button type="button" className="ai-reading__floating-locate" onClick={() => scrollToCurrent(true)}>
          <ArrowDownToLine size={15} /> 回到 AI 当前阅读位置
        </button>
      )}

      <footer className="ai-reading__controls">
        <div className="ai-reading__control-row">
          <button type="button" className={`ai-reading__main-control ${isActive ? 'is-pause' : ''}`} onClick={handleMainControl}>
            {status === 'complete' && state.completionReason !== 'quota' ? <RotateCcw size={16} /> : isActive ? <Pause size={16} /> : <Play size={16} />}
            <span>{status === 'complete'
              ? state.completionReason === 'quota'
                ? readingSession?.triggerType === 'chat_request' ? '等待新申请' : '下一轮阅读'
                : '再读一遍'
              : isActive ? '暂停' : status === 'pause' || status === 'error' ? '继续' : '开始阅读'}</span>
          </button>
          <div className="ai-reading__speed-control">
            <Gauge size={14} />
            {SPEED_OPTIONS.map(option => (
              <button key={option.id} type="button" className={speed.id === option.id ? 'is-selected' : ''} onClick={() => handleSpeed(option.id)} aria-label={`${option.label}阅读`} title={option.detail}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ai-reading__secondary-row">
          <button type="button" onClick={() => setPanel('notes')}><Highlighter size={14} />全部批注 <b>{annotations.length}</b></button>
          <button type="button" onClick={() => setPanel('logs')}><ScrollText size={14} />阅读日志 <b>{(state.readingLog || []).length}</b></button>
          <span className="ai-reading__privacy"><Sparkles size={12} />不显示思维链</span>
        </div>
      </footer>

      {panel && (
        <ReadingOverlay
          type={panel}
          notes={annotations}
          logs={state.readingLog || []}
          onClose={() => setPanel(null)}
          onSelectNote={selectNote}
        />
      )}

      <style>{`
        .ai-reading {
          --reading-ink: #56616b;
          --reading-muted: #9aa3a9;
          --reading-paper: rgba(255,252,253,.74);
          position: relative;
          height: 100%;
          min-height: 0;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          color: var(--reading-ink);
          background: linear-gradient(180deg, rgba(255,250,252,.38), rgba(248,250,247,.13));
          isolation: isolate;
        }
        .ai-reading::before {
          content: '';
          position: absolute;
          z-index: -1;
          inset: 0;
          pointer-events: none;
          background: radial-gradient(circle at 84% 12%, color-mix(in srgb, var(--reading-primary) 10%, transparent), transparent 29%), radial-gradient(circle at 7% 76%, rgba(193,224,214,.16), transparent 32%);
        }
        .ai-reading button { font: inherit; }
        .ai-reading__topbar { flex: 0 0 auto; display: grid; grid-template-columns: 38px 1fr 38px; align-items: center; gap: 5px; padding: calc(var(--safe-top) + 8px) 14px 5px; }
        .ai-reading__back, .ai-reading__locate { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--reading-muted); background: rgba(255,255,255,.42); cursor: pointer; }
        .ai-reading__back:active, .ai-reading__locate:active { transform: scale(.94); }
        .ai-reading__locate { justify-self: end; color: var(--reading-primary-dark); background: color-mix(in srgb, var(--reading-primary) 10%, rgba(255,255,255,.55)); }
        .ai-reading__topbar-title { min-width: 0; text-align: center; }
        .ai-reading__topbar-title span { display: flex; justify-content: center; align-items: center; gap: 5px; color: var(--reading-primary-dark); font-size: 13px; font-weight: 650; letter-spacing: .08em; }
        .ai-reading__topbar-title small { display: block; margin-top: 3px; color: var(--reading-muted); font-size: 9px; }
        .ai-reading__progress-card { flex: 0 0 auto; margin: 4px 15px 0; padding: 13px 15px 12px; border: 1px solid rgba(255,255,255,.58); border-radius: 22px 20px 24px 19px; background: rgba(255,255,255,.37); box-shadow: 0 9px 24px rgba(90,91,120,.055), inset 0 1px 0 rgba(255,255,255,.68); backdrop-filter: blur(13px); -webkit-backdrop-filter: blur(13px); }
        .ai-reading__book-line { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .ai-reading__eyebrow { display: block; color: var(--reading-muted); font-size: 9px; letter-spacing: .13em; }
        .ai-reading__book-line h1 { margin: 3px 0 0; color: #505d67; font: 500 20px/1.25 'ZCOOL XiaoWei', serif; letter-spacing: .035em; }
        .ai-reading__status-dot { width: 10px; height: 10px; flex: 0 0 auto; margin: 5px 2px 0 0; border-radius: 50%; background: #c7cdd0; box-shadow: 0 0 0 4px rgba(199,205,208,.12); }
        .ai-reading__status-dot.is-reading, .ai-reading__status-dot.is-highlight, .ai-reading__status-dot.is-annotate { background: var(--reading-primary); box-shadow: 0 0 0 4px color-mix(in srgb, var(--reading-primary) 15%, transparent); animation: ai-reading-breathe 1.8s ease-in-out infinite; }
        .ai-reading__status-dot.is-pause { background: #c5a7a1; }
        .ai-reading__status-dot.is-complete { background: #7eb99c; }
        .ai-reading__status-dot.is-error { background: #d38f8f; }
        .ai-reading__progress-copy { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 13px; color: #7f8991; font-size: 10px; }
        .ai-reading__progress-track { height: 5px; margin-top: 7px; overflow: hidden; border-radius: 99px; background: rgba(118,133,140,.12); }
        .ai-reading__progress-track span { display: block; height: 100%; min-width: 2px; border-radius: inherit; background: linear-gradient(90deg, color-mix(in srgb, var(--reading-primary) 68%, white), #9fc7b0); transition: width 500ms ease; }
        .ai-reading__meta-line { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 9px; min-width: 0; margin-top: 9px; color: #a0a7ad; font-size: 9px; }
        .ai-reading__meta-line > span { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; }
        .ai-reading__quota { color: var(--reading-primary-dark); opacity: .78; }
        .ai-reading__activity { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; margin-left: auto; }
        .ai-reading__activity i { width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--reading-primary); opacity: .75; }
        .ai-reading__pause-note { display: grid; gap: 2px; margin-top: 9px; padding: 7px 9px; border-left: 2px solid rgba(190,160,151,.55); color: #9d8f8c; font-size: 10px; line-height: 1.45; background: rgba(255,247,243,.45); }
        .ai-reading__pause-note small { overflow: hidden; color: #b09e9a; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__pause-note.is-error { border-left-color: rgba(204,125,125,.65); color: #a77777; }
        .ai-reading__model-line { display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 8px; color: #b1b5b5; font-size: 9px; }
        .ai-reading__model-line small { overflow: hidden; color: #b4b7b7; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__model-pulse { width: 5px; height: 5px; border-radius: 50%; background: #a8c5b4; opacity: .72; }
        .ai-reading__session-line { display: flex; flex-wrap: wrap; gap: 3px 9px; margin-top: 7px; color: #a6abad; font-size: 8px; line-height: 1.35; }
        .ai-reading__session-line span { white-space: nowrap; }
        .ai-reading__body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding: 18px 20px 34px; scroll-behavior: smooth; background: linear-gradient(180deg, rgba(255,253,254,.16), rgba(255,253,254,.29)); }
        .ai-reading__body-intro { padding: 3px 4px 19px; border-bottom: 1px solid rgba(130,145,150,.12); }
        .ai-reading__body-intro span { color: var(--reading-primary-dark); font-size: 9px; letter-spacing: .15em; }
        .ai-reading__body-intro p { margin: 7px 0 0; color: #9aa1a5; font-size: 11px; line-height: 1.65; }
        .ai-reading__chapter { margin-top: 25px; }
        .ai-reading__chapter-heading { display: flex; align-items: baseline; gap: 9px; margin: 0 4px 12px; }
        .ai-reading__chapter-heading span { color: var(--reading-primary); font: italic 15px/1 'Ma Shan Zheng', cursive; opacity: .8; }
        .ai-reading__chapter-heading h2 { margin: 0; color: #64717a; font: 500 17px/1.3 'ZCOOL XiaoWei', serif; letter-spacing: .07em; }
        .ai-reading__paragraph { position: relative; display: flex; gap: 9px; margin: 0 -3px; padding: 10px 8px 11px 4px; border-radius: 16px; transition: background 300ms ease, opacity 300ms ease, transform 300ms ease; }
        .ai-reading__paragraph-index { flex: 0 0 18px; padding-top: 5px; color: #bcc3c5; font: italic 10px/1 'Ma Shan Zheng', cursive; text-align: center; opacity: .7; }
        .ai-reading__paragraph-copy { min-width: 0; flex: 1; }
        .ai-reading__paragraph p { margin: 0; color: #5f6b73; font: 15px/2 'Noto Sans SC', 'PingFang SC', sans-serif; letter-spacing: .015em; text-align: justify; text-wrap: pretty; text-shadow: 0 1px 0 rgba(255,255,255,.27); }
        .ai-reading__paragraph.is-unread { opacity: .78; }
        .ai-reading__paragraph.is-read { opacity: .91; }
        .ai-reading__paragraph.is-current { background: rgba(255,255,255,.29); box-shadow: inset 2px 0 0 color-mix(in srgb, var(--reading-primary) 37%, transparent); }
        .ai-reading__paragraph.is-reading { background: linear-gradient(90deg, color-mix(in srgb, var(--reading-primary) 9%, transparent), rgba(255,255,255,.18)); box-shadow: inset 2px 0 0 color-mix(in srgb, var(--reading-primary) 63%, transparent); animation: ai-reading-paragraph-breathe 2.8s ease-in-out infinite; }
        .ai-reading__paragraph.is-reading .ai-reading__paragraph-index { color: var(--reading-primary-dark); opacity: .95; }
        .ai-reading__paragraph.is-reading p { color: #596770; }
        .ai-reading__reading-caret { display: inline-block; width: 6px; height: 6px; margin: 0 0 2px 5px; border-radius: 50%; background: var(--reading-primary); opacity: .6; animation: ai-reading-caret 1.3s ease-in-out infinite; }
        .ai-reading__mark { padding: 0 2px; border: 0; border-radius: 4px; color: inherit; font: inherit; line-height: inherit; text-align: inherit; cursor: pointer; background: linear-gradient(transparent 58%, rgba(255,213,123,.42) 58%, rgba(255,213,123,.42) 91%, transparent 91%); }
        .ai-reading__mark--annotate { background: rgba(242,184,205,.25); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--reading-primary) 65%, #ae8797); text-decoration-thickness: 1px; text-underline-offset: 4px; }
        .ai-reading__mark.is-selected { background-color: rgba(255,218,133,.39); box-shadow: 0 0 0 3px rgba(255,218,133,.16); }
        .ai-reading__note-stack { display: grid; gap: 6px; margin: 8px 0 0; }
        .ai-reading__inline-note { display: flex; align-items: flex-start; gap: 7px; width: 100%; padding: 7px 8px; border: 0; border-left: 2px solid color-mix(in srgb, var(--reading-primary) 52%, transparent); border-radius: 0 9px 9px 0; color: #7b7e87; text-align: left; background: rgba(255,246,218,.33); cursor: pointer; }
        .ai-reading__inline-note:active { background: rgba(255,246,218,.52); }
        .ai-reading__inline-note.is-expanded { background: rgba(255,246,218,.53); }
        .ai-reading__inline-note-icon { display: grid; place-items: center; flex: 0 0 auto; width: 22px; height: 22px; color: #c49c57; border-radius: 50%; background: rgba(255,255,255,.54); }
        .ai-reading__inline-note-body { min-width: 0; flex: 1; }
        .ai-reading__inline-note-meta { display: block; color: #b29a75; font-size: 9px; letter-spacing: .03em; }
        .ai-reading__inline-note-text { display: block; margin-top: 3px; color: #77746f; font-size: 11px; line-height: 1.6; }
        .ai-reading__inline-note-text.is-folded { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
        .ai-reading__inline-note-chevron { flex: 0 0 auto; padding-top: 12px; color: #baa891; font-size: 9px; }
        .ai-reading__end-mark { display: flex; align-items: center; gap: 8px; justify-content: center; margin: 31px 0 8px; color: #b4bab9; font-size: 9px; letter-spacing: .07em; }
        .ai-reading__end-mark span { width: 22px; height: 1px; background: rgba(131,156,148,.32); }
        .ai-reading__floating-locate { position: absolute; z-index: 4; right: 17px; bottom: 127px; display: inline-flex; align-items: center; gap: 5px; padding: 8px 10px; border: 1px solid rgba(255,255,255,.65); border-radius: 99px; color: var(--reading-primary-dark); font-size: 10px; background: rgba(255,255,255,.78); box-shadow: 0 7px 17px rgba(73,85,97,.13); backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px); animation: ai-reading-float-in 180ms ease-out both; }
        .ai-reading__controls { flex: 0 0 auto; padding: 8px 14px max(10px, var(--safe-bottom)); border-top: 1px solid rgba(255,255,255,.38); background: rgba(255,250,252,.46); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
        .ai-reading__control-row { display: flex; align-items: center; gap: 9px; }
        .ai-reading__main-control { min-width: 102px; height: 37px; display: inline-flex; align-items: center; justify-content: center; gap: 7px; padding: 0 14px; border: 0; border-radius: 13px; color: white; font-size: 12px; font-weight: 650; background: linear-gradient(135deg, color-mix(in srgb, var(--reading-primary) 88%, white), var(--reading-primary-dark)); box-shadow: 0 6px 13px color-mix(in srgb, var(--reading-primary) 21%, transparent); cursor: pointer; }
        .ai-reading__main-control.is-pause { color: var(--reading-primary-dark); background: rgba(255,255,255,.64); box-shadow: none; }
        .ai-reading__main-control:active { transform: translateY(1px); }
        .ai-reading__speed-control { display: flex; align-items: center; gap: 2px; min-width: 0; padding: 3px 4px 3px 7px; color: #a3a9ad; border: 1px solid rgba(155,165,169,.14); border-radius: 12px; background: rgba(255,255,255,.31); }
        .ai-reading__speed-control > button { width: 28px; height: 27px; padding: 0; border: 0; border-radius: 9px; color: #9da4a8; font-size: 10px; background: transparent; cursor: pointer; }
        .ai-reading__speed-control > button.is-selected { color: var(--reading-primary-dark); font-weight: 700; background: rgba(255,255,255,.66); box-shadow: 0 2px 6px rgba(89,98,110,.08); }
        .ai-reading__secondary-row { display: flex; align-items: center; gap: 11px; min-height: 25px; margin-top: 4px; }
        .ai-reading__secondary-row button { display: inline-flex; align-items: center; gap: 4px; padding: 3px 0; border: 0; color: #8e999e; font-size: 10px; background: transparent; cursor: pointer; }
        .ai-reading__secondary-row button b { min-width: 14px; color: var(--reading-primary-dark); font-size: 9px; font-weight: 600; }
        .ai-reading__privacy { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; color: #b2b5b6; font-size: 9px; white-space: nowrap; }
        .ai-reading__overlay { position: fixed; z-index: 1200; inset: 0; display: flex; align-items: flex-end; justify-content: center; }
        .ai-reading__overlay-backdrop { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: rgba(57,49,65,.19); backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
        .ai-reading__sheet { position: relative; width: min(100%, 448px); height: min(74svh, 620px); display: flex; flex-direction: column; overflow: hidden; border: 1px solid rgba(255,255,255,.65); border-bottom: 0; border-radius: 27px 27px 0 0; background: rgba(253,251,253,.96); box-shadow: 0 -14px 40px rgba(73,60,84,.17); animation: ai-reading-sheet-in 230ms cubic-bezier(.2,.8,.2,1) both; }
        .ai-reading__sheet-handle { width: 44px; height: 4px; flex: 0 0 auto; margin: 10px auto 1px; border-radius: 99px; background: rgba(123,132,137,.24); }
        .ai-reading__sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 10px 17px 12px; border-bottom: 1px solid rgba(130,140,150,.12); }
        .ai-reading__sheet-header strong { display: block; color: #626d75; font-size: 15px; font-weight: 650; }
        .ai-reading__sheet-header span { display: block; margin-top: 3px; color: #a7adb1; font-size: 10px; }
        .ai-reading__sheet-header button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; border-radius: 50%; color: #8c969b; background: #f2eff4; cursor: pointer; }
        .ai-reading__sheet-body { flex: 1; min-height: 0; overflow-y: auto; padding: 9px 14px max(22px, var(--safe-bottom)); -webkit-overflow-scrolling: touch; }
        .ai-reading__sheet-note, .ai-reading__log-entry { width: 100%; display: flex; align-items: flex-start; gap: 9px; padding: 12px 7px; border: 0; border-bottom: 1px solid rgba(130,140,150,.1); color: #69747b; text-align: left; background: transparent; cursor: pointer; }
        .ai-reading__sheet-note-mark { display: grid; place-items: center; width: 27px; height: 27px; flex: 0 0 auto; color: #bd985e; border-radius: 9px; background: #fff5d9; }
        .ai-reading__sheet-note > span:last-child { min-width: 0; display: grid; gap: 5px; }
        .ai-reading__sheet-note small { color: #b0a58e; font-size: 9px; }
        .ai-reading__sheet-note q { overflow: hidden; color: #686f74; font-size: 12px; line-height: 1.55; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__sheet-note em { color: #9c8d78; font-size: 11px; font-style: normal; line-height: 1.55; }
        .ai-reading__log-entry { align-items: center; }
        .ai-reading__log-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--reading-primary); opacity: .65; }
        .ai-reading__log-copy { min-width: 0; flex: 1; display: grid; gap: 4px; }
        .ai-reading__log-copy strong { color: #69747b; font-size: 12px; font-weight: 550; }
        .ai-reading__log-copy small { color: #a7afb1; font-size: 9px; }
        .ai-reading__log-copy q { overflow: hidden; color: #9a9185; font-size: 11px; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__log-copy q.is-folded { max-width: 85%; }
        .ai-reading__log-entry.is-expanded q { white-space: normal; }
        .ai-reading__log-more { flex: 0 0 auto; color: #b3a58e; font-size: 9px; }
        .ai-reading__empty-panel { min-height: 180px; display: grid; place-items: center; align-content: center; gap: 9px; padding: 25px; color: #b4abae; text-align: center; }
        .ai-reading__empty-panel svg { color: var(--reading-primary); opacity: .7; }
        .ai-reading__empty-panel p { max-width: 245px; margin: 0; font-size: 12px; line-height: 1.7; }
        @keyframes ai-reading-breathe { 0%,100% { opacity: .62; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.13); } }
        @keyframes ai-reading-paragraph-breathe { 0%,100% { background-position: 0 0; } 50% { background: linear-gradient(90deg, color-mix(in srgb, var(--reading-primary) 13%, transparent), rgba(255,255,255,.2)); } }
        @keyframes ai-reading-caret { 0%,100% { opacity: .18; transform: scale(.8); } 50% { opacity: .8; transform: scale(1.15); } }
        @keyframes ai-reading-float-in { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes ai-reading-sheet-in { from { opacity: 0; transform: translateY(100%); } to { opacity: 1; transform: translateY(0); } }
        @media (prefers-reduced-motion: reduce) { .ai-reading__status-dot, .ai-reading__paragraph.is-reading, .ai-reading__reading-caret, .ai-reading__sheet, .ai-reading__floating-locate { animation: none; } .ai-reading__body { scroll-behavior: auto; } }
        @media (max-height: 700px) { .ai-reading__topbar { padding-top: calc(var(--safe-top) + 5px); } .ai-reading__progress-card { padding-top: 10px; padding-bottom: 9px; } .ai-reading__progress-copy { margin-top: 8px; } .ai-reading__meta-line { margin-top: 6px; } .ai-reading__body { padding-top: 12px; } .ai-reading__controls { padding-top: 5px; } }
      `}</style>
    </main>
  )
}
