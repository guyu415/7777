import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock3,
  Gauge,
  Highlighter,
  Heart,
  Library,
  Pause,
  PenLine,
  Play,
  MessageCircle,
  RotateCcw,
  ScrollText,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { deleteReadingBook, getReadingBooks, saveReadingBook, useStore } from '../store'
import {
  READING_BOOKS,
  countBookCharacters,
  createInitialReadingState,
  flattenBook,
} from '../data/readingBooks'
import { stopProactiveReading } from '../services/proactiveReading'
import { parseReadingBookFile } from '../services/readingLibrary'
import {
  deleteCompanionReadingBook,
  createCompanionReadingAnnotation,
  getCompanionReadingAnnotations,
  getCompanionReadingState,
  likeCompanionReadingAnnotation,
  replyToCompanionReadingAnnotation,
  runResidentReadingBatch,
  startCompanionReadingSession,
  syncReadingBookToCompanion,
} from '../services/companion'
import {
  approveReadingSession,
  clampApprovedPages,
  createReadingSession,
  getPageNumber,
  READING_SPEEDS,
} from '../services/readingSessions'

const SPEED_OPTIONS = [READING_SPEEDS.slow, READING_SPEEDS.normal, READING_SPEEDS.fast]
// Survives route/component unmounts for the lifetime of the web app. The
// server remains authoritative; this map only keeps the local controller
// reachable if the user comes back and explicitly presses pause.
const activeResidentReadingSessions = new Map()

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
        className={`ai-reading__mark ai-reading__mark--${note.kind || 'highlight'} ${note.author === 'user' ? 'is-user' : ''} ${selectedId === note.id ? 'is-selected' : ''}`}
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

function InlineReadingNote({ note, expanded, onToggle, onLike, onReply }) {
  const [reply, setReply] = useState('')
  const [saving, setSaving] = useState(false)
  const isAnnotation = note.kind === 'annotate'
  const isMine = note.author === 'user'

  const submitReply = async event => {
    event.preventDefault()
    const text = reply.trim()
    if (!text || saving) return
    setSaving(true)
    try {
      const saved = await onReply(note, text)
      if (saved !== false) setReply('')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`ai-reading__inline-note ${expanded ? 'is-expanded' : ''}`}>
      <button type="button" className="ai-reading__inline-note-main" onClick={onToggle}>
        <span className="ai-reading__inline-note-icon">
          {isAnnotation ? <PenLine size={13} /> : <Highlighter size={13} />}
        </span>
        <span className="ai-reading__inline-note-body">
          <span className="ai-reading__inline-note-meta">
            {isMine ? (isAnnotation ? '我的批注' : '我的高亮') : (isAnnotation ? 'AI 批注' : '值得留意')} · {formatTime(note.createdAt)}
          </span>
          {isAnnotation && note.annotation && (
            <span className={`ai-reading__inline-note-text ${expanded ? '' : 'is-folded'}`}>{note.annotation}</span>
          )}
        </span>
        <span className="ai-reading__inline-note-chevron">{expanded ? '收起' : '展开'}</span>
      </button>
      {expanded && !isMine && (
        <div className="ai-reading__note-interactions">
          <div className="ai-reading__note-actions">
            <button type="button" className={note.liked ? 'is-liked' : ''} onClick={() => onLike(note)}>
              <Heart size={13} fill={note.liked ? 'currentColor' : 'none'} />{note.liked ? '已喜欢' : '喜欢'}
            </button>
            <span><MessageCircle size={13} />回复 {note.replies?.length || 0}</span>
          </div>
          {!!note.replies?.length && (
            <div className="ai-reading__note-replies">
              {note.replies.map(item => <p key={item.id}><small>你 · {formatTime(item.createdAt)}</small>{item.text}</p>)}
            </div>
          )}
          <form className="ai-reading__reply-form" onSubmit={submitReply}>
            <input value={reply} onChange={event => setReply(event.target.value)} maxLength={500} placeholder={isAnnotation ? '回复这条批注…' : '回复这处高亮…'} />
            <button type="submit" disabled={!reply.trim() || saving} aria-label="发送回复"><Send size={13} /></button>
          </form>
        </div>
      )}
    </div>
  )
}

function ParagraphBlock({ block, status, notes, selectedId, onSelect, onOpenNote, onLikeNote, onReplyNote }) {
  const hasNotes = notes.length > 0
  // A highlight is already visible in the正文 itself. Do not repeat a blank
  // "值得留意" card under every paragraph; only reveal its interaction card
  // when the user taps the highlighted words. Written annotations stay below.
  const visibleNotes = notes.filter(note => note.kind === 'annotate' || note.id === selectedId)
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
        {!!visibleNotes.length && (
          <div className="ai-reading__note-stack">
            {visibleNotes.map(note => {
              const expanded = selectedId === note.id
              return (
                <InlineReadingNote
                  key={note.id}
                  note={note}
                  expanded={expanded}
                  onToggle={() => onOpenNote(expanded ? null : note.id)}
                  onLike={onLikeNote}
                  onReply={onReplyNote}
                />
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
                  <small>{note.author === 'user' ? (note.kind === 'annotate' ? '我的批注' : '我的高亮') : (note.kind === 'annotate' ? 'AI 批注' : '值得留意')} · {formatLocator(note)} · {formatTime(note.createdAt)}</small>
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

function BookLibraryOverlay({ books, activeBookId, onSelect, onDelete, onImport, onClose }) {
  return (
    <div className="ai-reading__overlay" role="dialog" aria-modal="true" aria-label="我的书架">
      <button className="ai-reading__overlay-backdrop" type="button" onClick={onClose} aria-label="关闭" />
      <section className="ai-reading__sheet ai-reading__library-sheet">
        <div className="ai-reading__sheet-handle" aria-hidden="true" />
        <header className="ai-reading__sheet-header">
          <div><strong>我的书架</strong><span>{books.length} 本图书 · 独立保存，不进入聊天上下文</span></div>
          <button type="button" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>
        <div className="ai-reading__library-actions">
          <button type="button" onClick={onImport}><Upload size={15} />导入图书</button>
          <small>支持 TXT、Markdown、JSON、EPUB，单本不超过 20 MB</small>
        </div>
        <div className="ai-reading__sheet-body">
          {books.map(book => (
            <div key={book.id} className={`ai-reading__library-book ${book.id === activeBookId ? 'is-active' : ''}`}>
              <button type="button" className="ai-reading__library-select" onClick={() => onSelect(book)}>
                <span><BookOpen size={16} /></span>
                <span><strong>《{book.title}》</strong><small>{book.author || '未知作者'} · {book.chapters.length} 章</small></span>
              </button>
              {book.importedAt && (
                <button type="button" className="ai-reading__library-delete" onClick={() => onDelete(book)} aria-label={`删除《${book.title}》`}><Trash2 size={15} /></button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

export default function AIReading({ theme, onBack }) {
  const {
    readingState,
    updateReadingState,
    readingSessions,
    upsertReadingSession,
    updateReadingSession,
    switchReadingBook,
  } = useStore(useShallow(state => ({
    readingState: state.readingState,
    updateReadingState: state.updateReadingState,
    readingSessions: state.readingSessions,
    upsertReadingSession: state.upsertReadingSession,
    updateReadingSession: state.updateReadingSession,
    switchReadingBook: state.switchReadingBook,
  })))

  const [importedBooks, setImportedBooks] = useState([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [importNotice, setImportNotice] = useState('')
  const fileInputRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    getReadingBooks().then(items => {
      if (!cancelled) setImportedBooks((items || []).sort((a, b) => (b.importedAt || 0) - (a.importedAt || 0)))
    }).catch(error => { if (!cancelled) setImportNotice(`书架读取失败：${error.message}`) })
    return () => { cancelled = true }
  }, [])

  const allBooks = useMemo(() => [...importedBooks, ...READING_BOOKS], [importedBooks])
  const state = readingState || createInitialReadingState()
  const book = allBooks.find(item => item.id === state.bookId) || READING_BOOKS[0]
  const blocks = useMemo(() => flattenBook(book), [book])
  const totalChars = useMemo(() => countBookCharacters(book), [book])
  const currentIndex = Math.max(0, blocks.findIndex(block => block.id === state.currentParagraphId))
  const currentBlock = blocks[currentIndex] || blocks[0]
  const readingSession = readingSessions?.find(item => item.sessionId === state.activeSessionId) || null
  const currentPage = getPageNumber(currentBlock)
  const totalPages = Math.max(currentPage, getPageNumber(blocks.at(-1)))

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
  const preciseProgress = totalChars ? (readChars / totalChars) * 100 : 0
  const progress = Math.round(preciseProgress)
  const progressLabel = preciseProgress > 0 && preciseProgress < 1 ? '<1%' : `${progress}%`
  const progressWidth = preciseProgress > 0 ? Math.max(0.8, preciseProgress) : 0
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

  const [panel, setPanel] = useState(null)
  const [selectedNoteId, setSelectedNoteId] = useState(null)
  const [progressCollapsed, setProgressCollapsed] = useState(false)
  const [textSelection, setTextSelection] = useState(null)
  const [selectionMode, setSelectionMode] = useState('actions')
  const [annotationDraft, setAnnotationDraft] = useState('')
  const [savingUserMark, setSavingUserMark] = useState(false)
  const [followAi, setFollowAi] = useState(true)
  const rootRef = useRef(null)
  const paragraphRefs = useRef({})
  const readingStateRef = useRef(state)
  const runRef = useRef(0)
  const abortRef = useRef(null)
  const runningRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const sessionRunStartedAtRef = useRef(null)

  useEffect(() => {
    readingStateRef.current = state
  }, [state])

  // Native long-press selection stays intact; we only capture its exact text
  // and owning paragraph for a compact action bar above the reading controls.
  useEffect(() => {
    let timer = null
    const capture = () => {
      clearTimeout(timer)
      timer = window.setTimeout(() => {
        const selection = window.getSelection?.()
        if (!selection || selection.isCollapsed || !selection.rangeCount) return
        const anchor = selection.anchorNode?.nodeType === Node.ELEMENT_NODE ? selection.anchorNode : selection.anchorNode?.parentElement
        const focus = selection.focusNode?.nodeType === Node.ELEMENT_NODE ? selection.focusNode : selection.focusNode?.parentElement
        const start = anchor?.closest?.('[data-paragraph-id]')
        const end = focus?.closest?.('[data-paragraph-id]')
        if (!start || start !== end || !rootRef.current?.contains(start)) return
        const quote = selection.toString().trim().slice(0, 1200)
        if (!quote) return
        setTextSelection({ paragraphId: start.dataset.paragraphId, quote })
        setSelectionMode('actions')
        setAnnotationDraft('')
      }, 120)
    }
    document.addEventListener('selectionchange', capture)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', capture)
    }
  }, [book.id])

  // A full browser restart cannot retain a JavaScript promise, but it must
  // never erase the server-owned session or cursor. The authoritative state
  // hydration below decides whether there is work to resume.
  useEffect(() => {
    if (!runningRef.current
      && !activeResidentReadingSessions.has(state.activeSessionId)
      && (state.status === 'reading' || state.status === 'highlight' || state.status === 'annotate')) {
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

  // Deliberately no unmount cleanup that aborts the reading controller: route
  // changes and screen switches are presentation events, while the approved
  // resident reading task must keep running in the background.

  const patchReading = useCallback((updates) => {
    const next = { ...readingStateRef.current, ...updates }
    readingStateRef.current = next
    updateReadingState(updates)
  }, [updateReadingState])

  const replaceResidentNote = useCallback(updated => {
    if (!updated?.id) return
    const live = readingStateRef.current
    patchReading({
      highlights: (live.highlights || []).map(note => note.id === updated.id ? { ...note, ...updated } : note),
      annotations: (live.annotations || []).map(note => note.id === updated.id ? { ...note, ...updated } : note),
    })
  }, [patchReading])

  const likeReadingNote = useCallback(async note => {
    const nextLiked = !note.liked
    replaceResidentNote({ ...note, liked: nextLiked })
    try {
      const result = await likeCompanionReadingAnnotation(note.id, nextLiked)
      replaceResidentNote(result.annotation)
    } catch (error) {
      replaceResidentNote(note)
      setImportNotice(`点赞没有保存：${error?.message || '连接失败'}`)
    }
  }, [replaceResidentNote])

  const replyToReadingNote = useCallback(async (note, text) => {
    try {
      const result = await replyToCompanionReadingAnnotation(note.id, text)
      replaceResidentNote(result.annotation)
      return true
    } catch (error) {
      setImportNotice(`回复没有保存：${error?.message || '连接失败'}`)
      return false
    }
  }, [replaceResidentNote])

  const addResidentNote = useCallback(note => {
    if (!note?.id) return
    const block = blocks.find(item => item.id === note.paragraphId)
    const located = {
      ...note,
      chapterId: block?.chapterId || null,
      chapterTitle: block?.chapterTitle || '',
      chapterIndex: block?.chapterIndex,
      paragraphIndex: block?.paragraphIndex,
    }
    const live = readingStateRef.current
    const key = note.kind === 'annotate' ? 'annotations' : 'highlights'
    patchReading({ [key]: [...(live[key] || []).filter(item => item.id !== note.id), located] })
  }, [blocks, patchReading])

  const clearTextSelection = useCallback(() => {
    try { window.getSelection?.()?.removeAllRanges() } catch { /* iOS can revoke selection during scroll. */ }
    setTextSelection(null)
    setSelectionMode('actions')
    setAnnotationDraft('')
  }, [])

  const saveSelectedText = useCallback(async (kind, annotation = '') => {
    if (!textSelection || savingUserMark) return
    setSavingUserMark(true)
    try {
      const result = await createCompanionReadingAnnotation({
        bookId: book.id,
        paragraphId: textSelection.paragraphId,
        quote: textSelection.quote,
        kind,
        annotation,
      })
      addResidentNote(result.annotation)
      setSelectedNoteId(result.annotation.id)
      clearTextSelection()
    } catch (error) {
      setImportNotice(`标记没有保存：${error?.message || '连接失败'}`)
    } finally {
      setSavingUserMark(false)
    }
  }, [addResidentNote, book.id, clearTextSelection, savingUserMark, textSelection])

  const selectBook = useCallback((nextBook) => {
    runRef.current += 1
    abortRef.current?.abort()
    runningRef.current = false
    const saved = useStore.getState().readingBookStates?.[nextBook.id] || createInitialReadingState(nextBook)
    readingStateRef.current = saved
    switchReadingBook(nextBook)
    setSelectedNoteId(null)
    setFollowAi(true)
    setLibraryOpen(false)
    setImportNotice('')
  }, [switchReadingBook])

  const importBook = useCallback(async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImportNotice('正在导入……')
    try {
      const imported = await parseReadingBookFile(file)
      await syncReadingBookToCompanion(imported)
      await saveReadingBook(imported)
      setImportedBooks(current => [imported, ...current.filter(item => item.id !== imported.id)])
      selectBook(imported)
      setImportNotice(`《${imported.title}》已交给常驻 Claude Code 的书架`)
    } catch (error) {
      setImportNotice(error?.message || '图书导入失败。')
    }
  }, [selectBook])

  const removeImportedBook = useCallback(async (targetBook) => {
    if (!window.confirm(`从独立书架删除《${targetBook.title}》及其阅读记录？`)) return
    try {
      await deleteCompanionReadingBook(targetBook.id)
      await deleteReadingBook(targetBook.id)
      setImportedBooks(current => current.filter(item => item.id !== targetBook.id))
      if (readingStateRef.current.bookId === targetBook.id) selectBook(READING_BOOKS[0])
    } catch (error) {
      setImportNotice(`删除失败：${error.message}`)
    }
  }, [selectBook])

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

  const applyResidentState = useCallback((remoteState, remoteNotes, statusOverride) => {
    if (!remoteState || remoteState.bookId !== book.id) return
    const currentIndex = blocks.findIndex(block => block.id === remoteState.currentParagraphId)
    const current = blocks[Math.max(0, currentIndex)] || blocks[0]
    const progressValue = Math.max(0, Math.min(1, Number(remoteState.progress) || 0))
    const readParagraphIds = progressValue > 0 && currentIndex >= 0
      ? blocks.slice(0, currentIndex + 1).map(block => block.id)
      : []
    const locatedNotes = Array.isArray(remoteNotes) ? remoteNotes.map(note => {
      const block = blocks.find(item => item.id === note.paragraphId)
      return {
        ...note,
        chapterId: block?.chapterId || null,
        chapterTitle: block?.chapterTitle || '',
        chapterIndex: block?.chapterIndex,
        paragraphIndex: block?.paragraphIndex,
      }
    }) : null
    const updates = {
      currentParagraphId: current?.id || remoteState.currentParagraphId,
      currentChapterId: current?.chapterId || null,
      currentPageId: current?.pageId || null,
      currentPage: remoteState.currentPage || current?.pageNumber || 1,
      nextParagraphId: remoteState.nextParagraphId || null,
      // Keep the most recent completed session selected for quota/summary UI;
      // ensureResidentSession still creates a new session because its status
      // is completed, while the server remains authoritative about activity.
      activeSessionId: remoteState.activeSessionId || remoteState.session?.id || null,
      readParagraphIds,
      progressChars: Math.round(totalChars * progressValue),
      lastReadAt: remoteState.updatedAt || Date.now(),
      ...(statusOverride ? { status: statusOverride } : {}),
    }
    if (locatedNotes) {
      updates.highlights = locatedNotes.filter(note => note.kind === 'highlight')
      updates.annotations = locatedNotes.filter(note => note.kind === 'annotate')
    }
    patchReading(updates)
  }, [blocks, book.id, patchReading, totalChars])

  // VPS Reading Store is authoritative. On refresh or after /clear we load
  // only the compact cursor/rolling state and explicitly query annotations;
  // no previous正文 or chat transcript is needed to restore the reader.
  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      try {
        let remoteState
        try {
          remoteState = await getCompanionReadingState(book.id)
        } catch (error) {
          if (error?.status !== 404) throw error
          const imported = await syncReadingBookToCompanion(book)
          remoteState = imported.state
        }
        const { annotations: remoteNotes = [] } = await getCompanionReadingAnnotations(book.id)
        if (cancelled || runningRef.current || readingStateRef.current.bookId !== book.id) return
        const bookCompleted = !remoteState.nextParagraphId
        const quotaCompleted = remoteState.session?.status === 'completed' && !bookCompleted
        const restoredStatus = bookCompleted || quotaCompleted
          ? 'complete'
          : remoteState.progress > 0 ? 'pause' : 'idle'
        applyResidentState(remoteState, remoteNotes, restoredStatus)
        if (remoteState.session) {
          const existing = useStore.getState().readingSessions?.find(item => item.sessionId === remoteState.session.id) || {}
          upsertReadingSession({
            ...existing,
            sessionId: remoteState.session.id,
            bookId: book.id,
            approvedPages: remoteState.session.approvedPages,
            pagesRead: remoteState.session.pagesRead,
            startPage: remoteState.session.startPage,
            endPage: remoteState.session.startPage + remoteState.session.approvedPages - 1,
            status: remoteState.session.status,
            completedAt: remoteState.session.completedAt,
            lastUpdatedAt: remoteState.session.updatedAt,
          })
        }
        patchReading({
          completionReason: bookCompleted ? 'book' : quotaCompleted ? 'quota' : '',
          activity: bookCompleted
            ? ACTIVITY_LABELS.complete
            : quotaCompleted ? ACTIVITY_LABELS.quota : remoteState.progress > 0 ? '已从独立书签恢复' : '等常驻 Claude Code 翻开这一页',
          pauseReason: quotaCompleted
            ? `本轮已读 ${remoteState.session.approvedPages} 页，下一轮从独立书签继续。`
            : remoteState.progress > 0 ? '页码、批注和阅读认知已从 Reading Store 恢复。' : '',
          error: '',
        })
      } catch (error) {
        if (!cancelled) setImportNotice(`阅读状态恢复失败：${error?.message || '无法连接常驻 Claude Code'}`)
      }
    }
    void hydrate()
    return () => { cancelled = true }
  }, [applyResidentState, book, patchReading, upsertReadingSession])

  // WebSocket delivery is immediate in the normal case; this lightweight
  // poll is the recovery path for a reconnect or a mobile browser that
  // suspended event delivery while the resident agent committed the batch.
  useEffect(() => {
    if (!['reading', 'highlight', 'annotate'].includes(state.status)) return undefined
    let cancelled = false
    const syncCommittedProgress = async () => {
      try {
        const remoteState = await getCompanionReadingState(book.id)
        if (cancelled || remoteState.updatedAt <= (readingStateRef.current.lastReadAt || 0)) return
        const noteResult = await getCompanionReadingAnnotations(book.id)
        if (cancelled) return
        const remoteStatus = remoteState.session?.status === 'completed' ? 'complete' : 'reading'
        applyResidentState(remoteState, noteResult.annotations || [], remoteStatus)
      } catch { /* WebSocket/reconnect path remains active. */ }
    }
    const timer = window.setInterval(syncCommittedProgress, 3000)
    const onVisibility = () => { if (!document.hidden) void syncCommittedProgress() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [applyResidentState, book.id, state.status])

  const ensureResidentSession = useCallback(async (liveState) => {
    const store = useStore.getState()
    let localSession = store.readingSessions?.find(item => item.sessionId === liveState.activeSessionId)
    if (!localSession || !['pending', 'approved', 'reading', 'paused'].includes(localSession.status)) {
      const startId = liveState.nextParagraphId || liveState.currentParagraphId || blocks[0]?.id
      const startParagraph = blocks.find(block => block.id === startId) || blocks[0]
      if (!startParagraph) return null
      const pagesAvailable = Math.max(1, getPageNumber(blocks.at(-1)) - getPageNumber(startParagraph) + 1)
      const approvedPages = Math.min(5, pagesAvailable)
      localSession = approveReadingSession(createReadingSession({
        triggerType: 'manual', bookId: book.id, startParagraph,
        approvedPages, requestedPages: approvedPages,
      }), approvedPages)
      upsertReadingSession(localSession)
    }

    await syncReadingBookToCompanion(book)
    const response = await startCompanionReadingSession({
      bookId: book.id,
      approvedPages: clampApprovedPages(localSession.approvedPages, 5),
      sessionId: localSession.sessionId,
    })
    const remote = response.session
    const mirrored = {
      ...localSession,
      sessionId: remote.id,
      bookId: remote.bookId,
      approvedPages: remote.approvedPages,
      pagesRead: remote.pagesRead,
      startPage: remote.startPage,
      endPage: remote.startPage + remote.approvedPages - 1,
      startParagraphId: remote.startParagraphId,
      currentParagraphId: remote.currentParagraphId,
      nextParagraphId: remote.nextParagraphId,
      status: remote.status,
      startedAt: remote.startedAt,
      completedAt: remote.completedAt,
      summary: remote.summary,
      batchCount: remote.batchCount,
      lastUpdatedAt: remote.updatedAt,
    }
    upsertReadingSession(mirrored)
    applyResidentState(response.state, undefined, remote.status === 'completed' ? 'complete' : 'reading')
    patchReading({ activeSessionId: remote.status === 'completed' ? null : remote.id, error: '', completionReason: '' })
    return mirrored
  }, [applyResidentState, blocks, book, patchReading, upsertReadingSession])

  const runReading = useCallback(async () => {
    if (runningRef.current || activeResidentReadingSessions.has(readingStateRef.current.activeSessionId) || !blocks.length) return
    const token = ++runRef.current
    const controller = new AbortController()
    abortRef.current = controller
    runningRef.current = true
    const runStartedAt = Date.now()
    sessionRunStartedAtRef.current = runStartedAt
    try {
      const session = await ensureResidentSession(readingStateRef.current)
      if (!session || token !== runRef.current || controller.signal.aborted) return
      activeResidentReadingSessions.set(session.sessionId, controller)
      if (session.status === 'completed') {
        const recovered = await getCompanionReadingState(book.id)
        const isBookComplete = !recovered.nextParagraphId
        applyResidentState(recovered, undefined, 'complete')
        patchReading({
          completionReason: isBookComplete ? 'book' : 'quota',
          activity: isBookComplete ? ACTIVITY_LABELS.complete : ACTIVITY_LABELS.quota,
          pauseReason: isBookComplete ? '' : `本轮已读 ${session.approvedPages} 页，下一轮会从保存的位置继续。`,
        })
        return
      }

      patchReading({
        status: 'reading', activity: '常驻 Claude Code 正在阅读……',
        pauseReason: '', error: '', activeSessionId: session.sessionId,
      })
      writeReadingSession(session.sessionId, { status: 'reading', startedAt: session.startedAt || runStartedAt })

      while (token === runRef.current && !controller.signal.aborted) {
        const result = await runResidentReadingBatch({
          sessionId: session.sessionId,
          signal: controller.signal,
          onPhase: phase => {
            if (token !== runRef.current || controller.signal.aborted) return
            if (phase.phase === 'reading') {
              patchReading({ activity: `常驻 Claude Code 正在读第 ${phase.pageStart}–${phase.pageEnd} 页……` })
            } else if (phase.phase === 'saving') {
              patchReading({ activity: `已读完第 ${phase.pageStart || state.currentPage} 页附近，正在保存书签与批注……` })
            }
          },
        })
        if (token !== runRef.current || controller.signal.aborted) break
        const remoteSession = result.session
        const existingNotes = allAnnotations(readingStateRef.current)
        const notesById = new Map(existingNotes.map(note => [note.id, note]))
        for (const note of result.annotations || []) notesById.set(note.id, note)
        const allNotes = [...notesById.values()]
        const isBookComplete = result.completed && !result.state?.nextParagraphId
        applyResidentState(result.state, allNotes, result.completed ? 'complete' : 'reading')
        const completedAt = result.completed ? (remoteSession.completedAt || Date.now()) : null
        upsertReadingSession({
          ...session,
          sessionId: remoteSession.id,
          approvedPages: remoteSession.approvedPages,
          pagesRead: remoteSession.pagesRead,
          startPage: remoteSession.startPage,
          endPage: remoteSession.startPage + remoteSession.approvedPages - 1,
          currentParagraphId: remoteSession.currentParagraphId,
          nextParagraphId: remoteSession.nextParagraphId,
          status: result.completed ? 'completed' : 'reading',
          completedAt,
          summary: remoteSession.summary,
          batchCount: remoteSession.batchCount,
          modelCalls: remoteSession.batchCount,
          newAnnotations: allNotes.filter(note => note.sessionId === remoteSession.id).length,
          durationMs: result.completed ? Math.max(0, completedAt - runStartedAt) : Math.max(0, Date.now() - runStartedAt),
          lastUpdatedAt: remoteSession.updatedAt,
        })
        if (result.log) addLog({
          ...result.log,
          action: result.completed ? (isBookComplete ? 'complete' : 'quota') : 'continue',
          label: result.completed ? (isBookComplete ? ACTIVITY_LABELS.complete : ACTIVITY_LABELS.quota) : `读完第 ${result.log.pageStart}–${result.log.pageEnd} 页`,
        })
        patchReading({
          activity: result.completed
            ? (isBookComplete ? ACTIVITY_LABELS.complete : ACTIVITY_LABELS.quota)
            : `已持久化第 ${result.log?.pageStart || result.state.currentPage}–${result.log?.pageEnd || result.state.currentPage} 页，继续下一批`,
          completionReason: result.completed ? (isBookComplete ? 'book' : 'quota') : '',
          pauseReason: result.completed && !isBookComplete
            ? `本轮已读 ${remoteSession.approvedPages} 页，下一轮会从第 ${result.state.currentPage + 1} 页附近继续。`
            : '',
          activeSessionId: remoteSession.id,
          lastReadAt: Date.now(),
        })
        if (result.completed) break
      }
    } catch (error) {
      if (error?.name !== 'AbortError' && token === runRef.current) {
        try {
          const [remoteState, noteResult] = await Promise.all([
            getCompanionReadingState(book.id),
            getCompanionReadingAnnotations(book.id),
          ])
          applyResidentState(remoteState, noteResult.annotations || [], 'error')
        } catch { /* the last local snapshot remains usable */ }
        patchReading({
          status: 'error', activity: ACTIVITY_LABELS.error,
          error: error?.message || '常驻 Claude Code 暂时无法继续阅读。',
          pauseReason: '书签停在上一批成功提交的位置，可以直接重试。',
        })
      }
    } finally {
      for (const [sessionId, activeController] of activeResidentReadingSessions) {
        if (activeController === controller) activeResidentReadingSessions.delete(sessionId)
      }
      if (token === runRef.current) {
        runningRef.current = false
        abortRef.current = null
        sessionRunStartedAtRef.current = null
      }
    }
  }, [addLog, applyResidentState, blocks.length, book.id, ensureResidentSession, patchReading, upsertReadingSession, writeReadingSession])

  const pauseReading = useCallback(() => {
    if (!runningRef.current && readingStateRef.current.status !== 'reading' && readingStateRef.current.status !== 'highlight' && readingStateRef.current.status !== 'annotate') return
    runRef.current += 1
    activeResidentReadingSessions.get(readingStateRef.current.activeSessionId)?.abort()
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
    activeResidentReadingSessions.get(readingStateRef.current.activeSessionId)?.abort()
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
        <div className="ai-reading__topbar-actions">
          <button type="button" className="ai-reading__library-open" onClick={() => setLibraryOpen(true)} aria-label="打开书架"><Library size={16} /><span>书架</span></button>
          <button type="button" className="ai-reading__import" onClick={() => fileInputRef.current?.click()} aria-label="导入图书"><Upload size={16} /><span>导入</span></button>
        </div>
        <input ref={fileInputRef} className="ai-reading__file-input" type="file" accept=".txt,.md,.markdown,.json,.epub,text/plain,text/markdown,application/json,application/epub+zip" onChange={importBook} />
      </header>

      {importNotice && <div className="ai-reading__import-notice" role="status">{importNotice}</div>}

      <section className={`ai-reading__progress-card ${progressCollapsed ? 'is-collapsed' : ''}`} aria-label="阅读进度">
        <button type="button" className="ai-reading__progress-toggle" onClick={() => setProgressCollapsed(value => !value)} aria-expanded={!progressCollapsed}>
          <span className="ai-reading__progress-title">
            {!progressCollapsed && <small>AI 正在读</small>}
            <strong>《{book.title}》</strong>
          </span>
          <span className={`ai-reading__status-dot is-${status}`} aria-label={ACTIVITY_LABELS[status] || status} />
          {progressCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
        {!progressCollapsed && <>
          <div className="ai-reading__progress-copy">
            <span>第 {chapterNumber} 章 · 第 {currentPage} / {totalPages} 页 · {progressLabel}</span>
            <span>{formatNumber(readChars)} / {formatNumber(totalChars)} 字</span>
          </div>
          <div className="ai-reading__progress-track" aria-label={`已读 ${progressLabel}`}>
            <span style={{ width: `${progressWidth}%` }} />
          </div>
          <div className="ai-reading__meta-line">
            <span><Highlighter size={12} /> 批注 {annotations.length} 条</span>
            <span><Clock3 size={12} /> 最近 {formatTime(state.lastReadAt)}</span>
            {readingSession && <span className="ai-reading__quota">本轮 {Math.min(readingSession.pagesRead || 0, readingSession.approvedPages || 0)} / {readingSession.approvedPages} 页</span>}
            <span className="ai-reading__activity" title={state.error || state.pauseReason || ''}><i /> {state.activity || '等 AI 翻开这一页'}</span>
          </div>
        </>}
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
                    onLikeNote={likeReadingNote}
                    onReplyNote={replyToReadingNote}
                  />
                </div>
              )
            })}
          </section>
        ))}
        <div className="ai-reading__end-mark"><span />这本书的下一页，还没有被翻开<span /></div>
      </div>

      {!followAi && (
        <button type="button" className="ai-reading__floating-locate" onClick={() => scrollToCurrent(true)} aria-label="回到 AI 当前阅读位置" title="回到 AI 当前阅读位置">
          <ArrowDownToLine size={16} />
        </button>
      )}

      {textSelection && (
        <div className="ai-reading__selection-tools" role="toolbar" aria-label="标记选中的文字">
          <button type="button" className="ai-reading__selection-close" onClick={clearTextSelection} aria-label="取消选择"><X size={13} /></button>
          <q>{textSelection.quote}</q>
          {selectionMode === 'actions' ? (
            <div className="ai-reading__selection-actions">
              <button type="button" disabled={savingUserMark} onClick={() => void saveSelectedText('highlight')}><Highlighter size={14} />高亮</button>
              <button type="button" onClick={() => setSelectionMode('annotate')}><PenLine size={14} />写批注</button>
            </div>
          ) : (
            <form onSubmit={event => { event.preventDefault(); if (annotationDraft.trim()) void saveSelectedText('annotate', annotationDraft.trim()) }}>
              <input autoFocus value={annotationDraft} maxLength={500} onChange={event => setAnnotationDraft(event.target.value)} placeholder="写下你的批注…" />
              <button type="submit" disabled={!annotationDraft.trim() || savingUserMark} aria-label="保存批注"><Send size={14} /></button>
            </form>
          )}
        </div>
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
      {libraryOpen && (
        <BookLibraryOverlay
          books={allBooks}
          activeBookId={book.id}
          onSelect={selectBook}
          onDelete={removeImportedBook}
          onImport={() => fileInputRef.current?.click()}
          onClose={() => setLibraryOpen(false)}
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
        .ai-reading__topbar { flex: 0 0 auto; display: grid; grid-template-columns: 38px 1fr auto; align-items: center; gap: 5px; padding: calc(var(--safe-top) + 8px) 14px 5px; }
        .ai-reading__back, .ai-reading__locate { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%; color: var(--reading-muted); background: rgba(255,255,255,.42); cursor: pointer; }
        .ai-reading__back:active, .ai-reading__locate:active { transform: scale(.94); }
        .ai-reading__locate { justify-self: end; color: var(--reading-primary-dark); background: color-mix(in srgb, var(--reading-primary) 10%, rgba(255,255,255,.55)); }
        .ai-reading__topbar-actions { display: flex; align-items: center; gap: 5px; }
        .ai-reading__topbar-actions button { height: 32px; display: inline-flex; align-items: center; gap: 4px; padding: 0 8px; border: 0; border-radius: 11px; color: var(--reading-primary-dark); font-size: 9px; background: rgba(255,255,255,.48); cursor: pointer; }
        .ai-reading__topbar-actions button:active { transform: scale(.95); }
        .ai-reading__file-input { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
        .ai-reading__import-notice { flex: 0 0 auto; margin: 0 16px 4px; overflow: hidden; color: var(--reading-primary-dark); font-size: 9px; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__topbar-title { min-width: 0; text-align: center; }
        .ai-reading__topbar-title span { display: flex; justify-content: center; align-items: center; gap: 5px; color: var(--reading-primary-dark); font-size: 13px; font-weight: 650; letter-spacing: .08em; }
        .ai-reading__topbar-title small { display: block; margin-top: 3px; color: var(--reading-muted); font-size: 9px; }
        .ai-reading__progress-card { flex: 0 0 auto; align-self: stretch; margin: 4px 15px 0; padding: 12px 15px 11px; border: 1px solid rgba(255,255,255,.58); border-radius: 22px 20px 24px 19px; background: rgba(255,255,255,.37); box-shadow: 0 9px 24px rgba(90,91,120,.055), inset 0 1px 0 rgba(255,255,255,.68); backdrop-filter: blur(13px); -webkit-backdrop-filter: blur(13px); transition: width 180ms ease, padding 180ms ease, border-radius 180ms ease; }
        .ai-reading__progress-card.is-collapsed { width: fit-content; max-width: calc(100% - 68px); align-self: center; padding: 7px 11px; border-radius: 999px; }
        .ai-reading__progress-toggle { width: 100%; display: flex; align-items: center; gap: 9px; padding: 0; border: 0; color: #505d67; text-align: left; background: transparent; cursor: pointer; }
        .ai-reading__progress-title { min-width: 0; flex: 1; }
        .ai-reading__progress-title small { display: block; margin-bottom: 3px; color: var(--reading-muted); font-size: 9px; font-weight: 400; letter-spacing: .13em; }
        .ai-reading__progress-title strong { display: block; overflow: hidden; font: 500 20px/1.25 'ZCOOL XiaoWei', serif; letter-spacing: .035em; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__progress-card.is-collapsed .ai-reading__progress-toggle { width: auto; }
        .ai-reading__progress-card.is-collapsed .ai-reading__progress-title { flex: 0 1 auto; }
        .ai-reading__progress-card.is-collapsed .ai-reading__progress-title strong { font-size: 14px; }
        .ai-reading__progress-toggle > svg { flex: 0 0 auto; color: #9aa3a9; }
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
        .ai-reading__paragraph p { margin: 0; color: #5f6b73; font: 15px/2 'Noto Sans SC', 'PingFang SC', sans-serif; letter-spacing: .015em; text-align: justify; text-wrap: pretty; text-shadow: 0 1px 0 rgba(255,255,255,.27); user-select: text; -webkit-user-select: text; }
        .ai-reading__paragraph.is-unread { opacity: .78; }
        .ai-reading__paragraph.is-read { opacity: .91; }
        .ai-reading__paragraph.is-current { background: rgba(255,255,255,.29); box-shadow: inset 2px 0 0 color-mix(in srgb, var(--reading-primary) 37%, transparent); }
        .ai-reading__paragraph.is-reading { background: linear-gradient(90deg, color-mix(in srgb, var(--reading-primary) 9%, transparent), rgba(255,255,255,.18)); box-shadow: inset 2px 0 0 color-mix(in srgb, var(--reading-primary) 63%, transparent); animation: ai-reading-paragraph-breathe 2.8s ease-in-out infinite; }
        .ai-reading__paragraph.is-reading .ai-reading__paragraph-index { color: var(--reading-primary-dark); opacity: .95; }
        .ai-reading__paragraph.is-reading p { color: #596770; }
        .ai-reading__reading-caret { display: inline-block; width: 6px; height: 6px; margin: 0 0 2px 5px; border-radius: 50%; background: var(--reading-primary); opacity: .6; animation: ai-reading-caret 1.3s ease-in-out infinite; }
        .ai-reading__mark { padding: 0 2px; border: 0; border-radius: 4px; color: inherit; font: inherit; line-height: inherit; text-align: inherit; cursor: pointer; background: linear-gradient(transparent 58%, rgba(255,213,123,.42) 58%, rgba(255,213,123,.42) 91%, transparent 91%); }
        .ai-reading__mark--annotate { background: rgba(242,184,205,.25); text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--reading-primary) 65%, #ae8797); text-decoration-thickness: 1px; text-underline-offset: 4px; }
        .ai-reading__mark--highlight.is-user { background: linear-gradient(transparent 58%, color-mix(in srgb, var(--reading-primary) 24%, #ffe6a8) 58%, color-mix(in srgb, var(--reading-primary) 24%, #ffe6a8) 91%, transparent 91%); }
        .ai-reading__mark.is-selected { background-color: rgba(255,218,133,.39); box-shadow: 0 0 0 3px rgba(255,218,133,.16); }
        .ai-reading__note-stack { display: grid; gap: 6px; margin: 8px 0 0; }
        .ai-reading__inline-note { width: 100%; overflow: hidden; border-left: 2px solid color-mix(in srgb, var(--reading-primary) 52%, transparent); border-radius: 0 9px 9px 0; color: #7b7e87; background: rgba(255,246,218,.33); }
        .ai-reading__inline-note.is-expanded { background: rgba(255,246,218,.53); }
        .ai-reading__inline-note-main { display: flex; align-items: flex-start; gap: 7px; width: 100%; padding: 7px 8px; border: 0; color: inherit; text-align: left; background: transparent; cursor: pointer; }
        .ai-reading__inline-note-main:active { background: rgba(255,255,255,.24); }
        .ai-reading__inline-note-icon { display: grid; place-items: center; flex: 0 0 auto; width: 22px; height: 22px; color: #c49c57; border-radius: 50%; background: rgba(255,255,255,.54); }
        .ai-reading__inline-note-body { min-width: 0; flex: 1; }
        .ai-reading__inline-note-meta { display: block; color: #b29a75; font-size: 9px; letter-spacing: .03em; }
        .ai-reading__inline-note-text { display: block; margin-top: 3px; color: #77746f; font-size: 11px; line-height: 1.6; }
        .ai-reading__inline-note-text.is-folded { display: -webkit-box; overflow: hidden; -webkit-line-clamp: 1; -webkit-box-orient: vertical; }
        .ai-reading__inline-note-chevron { flex: 0 0 auto; padding-top: 12px; color: #baa891; font-size: 9px; }
        .ai-reading__note-interactions { display: grid; gap: 7px; padding: 0 8px 8px 37px; }
        .ai-reading__note-actions { display: flex; align-items: center; gap: 12px; color: #a8957d; font-size: 9px; }
        .ai-reading__note-actions button, .ai-reading__note-actions span { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; color: inherit; font-size: inherit; background: transparent; }
        .ai-reading__note-actions button { cursor: pointer; }
        .ai-reading__note-actions button.is-liked { color: #d17f94; }
        .ai-reading__note-replies { display: grid; gap: 5px; }
        .ai-reading__note-replies p { display: grid; gap: 2px; margin: 0; padding: 5px 7px; border-radius: 8px; color: #747276; font-size: 10px; line-height: 1.45; background: rgba(255,255,255,.4); }
        .ai-reading__note-replies small { color: #b1a28f; font-size: 8px; }
        .ai-reading__reply-form { display: flex; align-items: center; gap: 5px; }
        .ai-reading__reply-form input { min-width: 0; height: 29px; flex: 1; padding: 0 9px; border: 1px solid rgba(173,153,124,.17); border-radius: 10px; outline: none; color: #6f7075; font-size: 10px; background: rgba(255,255,255,.53); }
        .ai-reading__reply-form input:focus { border-color: color-mix(in srgb, var(--reading-primary) 42%, transparent); }
        .ai-reading__reply-form button { width: 29px; height: 29px; display: grid; place-items: center; flex: 0 0 auto; border: 0; border-radius: 9px; color: white; background: var(--reading-primary-dark); cursor: pointer; }
        .ai-reading__reply-form button:disabled { opacity: .35; }
        .ai-reading__end-mark { display: flex; align-items: center; gap: 8px; justify-content: center; margin: 31px 0 8px; color: #b4bab9; font-size: 9px; letter-spacing: .07em; }
        .ai-reading__end-mark span { width: 22px; height: 1px; background: rgba(131,156,148,.32); }
        .ai-reading__floating-locate { position: absolute; z-index: 4; right: 7px; bottom: 127px; width: 31px; height: 36px; display: grid; place-items: center; padding: 0; border: 1px solid rgba(255,255,255,.58); border-radius: 12px 0 0 12px; color: var(--reading-primary-dark); background: rgba(255,255,255,.69); box-shadow: 0 6px 15px rgba(73,85,97,.11); backdrop-filter: blur(9px); -webkit-backdrop-filter: blur(9px); animation: ai-reading-float-in 180ms ease-out both; }
        .ai-reading__selection-tools { position: absolute; z-index: 7; left: 50%; bottom: calc(104px + var(--safe-bottom)); width: min(330px, calc(100% - 32px)); display: grid; gap: 7px; padding: 9px 10px; border: 1px solid rgba(255,255,255,.67); border-radius: 16px; color: #706f75; background: rgba(255,253,251,.89); box-shadow: 0 10px 28px rgba(74,66,78,.16); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); transform: translateX(-50%); animation: ai-reading-float-in 160ms ease-out both; }
        .ai-reading__selection-close { position: absolute; top: 5px; right: 5px; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; color: #a49da0; background: transparent; }
        .ai-reading__selection-tools > q { display: block; overflow: hidden; padding-right: 24px; color: #8a7d76; font-size: 10px; line-height: 1.45; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__selection-actions { display: flex; gap: 7px; }
        .ai-reading__selection-actions button { height: 31px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: 1; border: 0; border-radius: 10px; color: var(--reading-primary-dark); font-size: 10px; background: color-mix(in srgb, var(--reading-primary) 10%, rgba(255,255,255,.74)); }
        .ai-reading__selection-tools form { display: flex; align-items: center; gap: 6px; }
        .ai-reading__selection-tools form input { min-width: 0; height: 32px; flex: 1; padding: 0 10px; border: 1px solid color-mix(in srgb, var(--reading-primary) 22%, transparent); border-radius: 10px; outline: none; color: #686b70; font-size: 11px; background: rgba(255,255,255,.72); }
        .ai-reading__selection-tools form button { width: 32px; height: 32px; display: grid; place-items: center; flex: 0 0 auto; border: 0; border-radius: 10px; color: white; background: var(--reading-primary-dark); }
        .ai-reading__selection-tools button:disabled { opacity: .42; }
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
        .ai-reading__library-actions { display: flex; align-items: center; gap: 9px; padding: 10px 15px; border-bottom: 1px solid rgba(130,140,150,.1); }
        .ai-reading__library-actions button { display: inline-flex; align-items: center; gap: 5px; height: 34px; padding: 0 12px; border: 0; border-radius: 11px; color: white; font-size: 11px; background: linear-gradient(135deg, color-mix(in srgb, var(--reading-primary) 88%, white), var(--reading-primary-dark)); }
        .ai-reading__library-actions small { color: #a8afb2; font-size: 8px; line-height: 1.4; }
        .ai-reading__library-book { display: flex; align-items: center; gap: 6px; border-bottom: 1px solid rgba(130,140,150,.1); border-radius: 12px; }
        .ai-reading__library-book.is-active { background: color-mix(in srgb, var(--reading-primary) 7%, transparent); }
        .ai-reading__library-select { min-width: 0; flex: 1; display: flex; align-items: center; gap: 10px; padding: 11px 7px; border: 0; color: #66727a; text-align: left; background: transparent; }
        .ai-reading__library-select > span:first-child { width: 31px; height: 31px; flex: 0 0 auto; display: grid; place-items: center; border-radius: 10px; color: var(--reading-primary-dark); background: rgba(255,255,255,.62); }
        .ai-reading__library-select > span:last-child { min-width: 0; }
        .ai-reading__library-select strong, .ai-reading__library-select small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ai-reading__library-select strong { font-size: 12px; font-weight: 600; }
        .ai-reading__library-select small { margin-top: 4px; color: #a3aaae; font-size: 9px; }
        .ai-reading__library-delete { width: 32px; height: 32px; flex: 0 0 auto; display: grid; place-items: center; margin-right: 6px; border: 0; border-radius: 10px; color: #b99a9a; background: rgba(255,255,255,.46); }
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
