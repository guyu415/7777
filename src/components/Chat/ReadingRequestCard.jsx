import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, Clock3, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store'
import { READING_BOOKS, flattenBook } from '../../data/readingBooks'
import { approveReadingSession, clampApprovedPages, createReadingSession, getPageCount } from '../../services/readingSessions'

function openReaderRoute() {
  const params = new URLSearchParams(window.location.search)
  params.set('view', 'aiReading')
  window.history.pushState({}, '', `${window.location.pathname}?${params}${window.location.hash}`)
}

export default function ReadingRequestCard({ theme }) {
  const {
    pendingReadingRequest,
    setPendingReadingRequest,
    rejectReadingRequest,
    upsertReadingSession,
    updateReadingState,
    setCurrentView,
  } = useStore(useShallow(state => ({
    pendingReadingRequest: state.pendingReadingRequest,
    setPendingReadingRequest: state.setPendingReadingRequest,
    rejectReadingRequest: state.rejectReadingRequest,
    upsertReadingSession: state.upsertReadingSession,
    updateReadingState: state.updateReadingState,
    setCurrentView: state.setCurrentView,
  })))
  const [editing, setEditing] = useState(false)
  const [pages, setPages] = useState(5)

  useEffect(() => {
    if (pendingReadingRequest) setPages(clampApprovedPages(pendingReadingRequest.requestedPages))
  }, [pendingReadingRequest?.requestId, pendingReadingRequest?.requestedPages])

  const book = useMemo(() => (
    READING_BOOKS.find(item => item.id === pendingReadingRequest?.bookId) || READING_BOOKS[0]
  ), [pendingReadingRequest?.bookId])
  const blocks = useMemo(() => flattenBook(book), [book])
  const start = blocks.find(block => block.id === pendingReadingRequest?.startParagraphId) || blocks[0]
  if (!pendingReadingRequest || !start) return null

  const requestedPages = clampApprovedPages(pendingReadingRequest.requestedPages)
  const selectedPages = clampApprovedPages(pages, requestedPages)
  const pageCount = getPageCount(book)
  const endPage = Math.min(pageCount || start.pageNumber + selectedPages - 1, start.pageNumber + selectedPages - 1)
  const estimatedMinutes = Math.max(1, Math.round(selectedPages * 1.5))
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#756ea8'

  const allowReading = () => {
    const now = Date.now()
    const pendingSession = useStore.getState().readingSessions?.find(item => (
      item.sessionId === pendingReadingRequest.sessionId || item.requestId === pendingReadingRequest.requestId
    )) || createReadingSession({
      triggerType: 'chat_request',
      bookId: book.id,
      startParagraph: start,
      approvedPages: selectedPages,
      requestedPages,
      requestId: pendingReadingRequest.requestId,
      now,
    })
    const session = approveReadingSession(pendingSession, selectedPages, now)
    upsertReadingSession(session)
    updateReadingState({
      bookId: book.id,
      status: 'idle',
      activeSessionId: session.sessionId,
      currentChapterId: start.chapterId,
      currentParagraphId: start.id,
      currentPageId: start.pageId,
      currentPage: start.pageNumber,
      nextParagraphId: null,
      completionReason: '',
      pauseReason: '',
      error: '',
    })
    setPendingReadingRequest(null)
    setCurrentView('aiReading')
    openReaderRoute()
  }

  const decline = () => {
    rejectReadingRequest(pendingReadingRequest.requestId)
    setEditing(false)
  }

  return (
    <aside
      className="reading-request-card"
      aria-label="AI 自主阅读申请"
      style={{ '--request-primary': primary, '--request-primary-dark': primaryDark }}
    >
      <div className="reading-request-card__head">
        <span className="reading-request-card__icon"><BookOpen size={15} /></span>
        <div>
          <strong>AI 想继续读《{book.title}》</strong>
          <small>这次阅读需要你的明确允许</small>
        </div>
        <button type="button" onClick={decline} aria-label="暂时不读"><X size={16} /></button>
      </div>
      <div className="reading-request-card__plan">
        <span>计划从第 {start.pageNumber} 页开始</span>
        <span>预计结束：第 {endPage} 页</span>
        <span><Clock3 size={12} />约 {estimatedMinutes} 分钟</span>
      </div>
      {editing ? (
        <div className="reading-request-card__editor">
          <label htmlFor="reading-pages">申请阅读</label>
          <input
            id="reading-pages"
            type="number"
            inputMode="numeric"
            min="1"
            max="20"
            value={pages}
            onChange={event => setPages(event.target.value)}
            aria-label="申请阅读页数"
          />
          <span>页（最多 20 页）</span>
        </div>
      ) : (
        <div className="reading-request-card__requested">申请阅读：<b>{requestedPages} 页</b></div>
      )}
      <div className="reading-request-card__actions">
        <button type="button" className="reading-request-card__allow" onClick={allowReading}><Check size={15} />允许阅读</button>
        <button type="button" className="reading-request-card__edit" onClick={() => setEditing(value => !value)}>{editing ? '收起修改' : '修改页数'}</button>
        <button type="button" className="reading-request-card__decline" onClick={decline}>暂时不读</button>
      </div>
      <style>{`
        .reading-request-card { position: fixed; z-index: 70; left: 50%; bottom: calc(var(--safe-bottom) + 72px); width: min(calc(100vw - 24px), 390px); transform: translateX(-50%); padding: 13px 14px 12px; border: 1px solid rgba(255,255,255,.72); border-radius: 19px; color: #69717b; background: rgba(255,252,254,.94); box-shadow: 0 12px 36px rgba(90,65,85,.19), 0 2px 7px rgba(90,65,85,.08); backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px); animation: reading-request-in 220ms ease-out both; }
        .reading-request-card__head { display: flex; align-items: center; gap: 8px; }
        .reading-request-card__head > div { min-width: 0; flex: 1; }
        .reading-request-card__head strong { display: block; overflow: hidden; color: #626b75; font-size: 12px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
        .reading-request-card__head small { display: block; margin-top: 3px; color: #a2a6ad; font-size: 9px; }
        .reading-request-card__head > button { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 0; border-radius: 50%; color: #a2a6ad; background: rgba(120,130,140,.08); cursor: pointer; }
        .reading-request-card__icon { display: grid; place-items: center; width: 29px; height: 29px; flex: 0 0 auto; color: var(--request-primary-dark); border-radius: 10px; background: color-mix(in srgb, var(--request-primary) 15%, white); }
        .reading-request-card__plan { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 9px; margin: 10px 0 8px 37px; color: #929ba2; font-size: 10px; line-height: 1.35; }
        .reading-request-card__plan span:last-child { display: inline-flex; align-items: center; gap: 3px; grid-column: 1 / -1; color: #aaa19d; }
        .reading-request-card__requested { margin: 7px 0 10px 37px; color: #8b9298; font-size: 10px; }
        .reading-request-card__requested b { color: var(--request-primary-dark); font-weight: 650; }
        .reading-request-card__editor { display: flex; align-items: center; gap: 6px; margin: 7px 0 10px 37px; color: #8b9298; font-size: 10px; }
        .reading-request-card__editor input { width: 48px; height: 27px; padding: 0 5px; border: 1px solid color-mix(in srgb, var(--request-primary) 38%, white); border-radius: 8px; color: #626b75; text-align: center; background: white; outline: none; }
        .reading-request-card__actions { display: flex; align-items: center; gap: 7px; }
        .reading-request-card__actions button { height: 31px; padding: 0 10px; border: 0; border-radius: 10px; font-size: 10px; cursor: pointer; white-space: nowrap; }
        .reading-request-card__allow { display: inline-flex; align-items: center; gap: 4px; color: white; background: linear-gradient(135deg, color-mix(in srgb, var(--request-primary) 88%, white), var(--request-primary-dark)); box-shadow: 0 4px 10px color-mix(in srgb, var(--request-primary) 24%, transparent); }
        .reading-request-card__edit { color: var(--request-primary-dark); background: color-mix(in srgb, var(--request-primary) 11%, white); }
        .reading-request-card__decline { margin-left: auto; color: #a09a9f; background: rgba(120,130,140,.08); }
        @keyframes reading-request-in { from { opacity: 0; transform: translate(-50%, 10px) scale(.97); } to { opacity: 1; transform: translate(-50%, 0) scale(1); } }
      `}</style>
    </aside>
  )
}
