import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Heart, Loader2, Trash2 } from 'lucide-react'
import { addAnniversaryEvent, deleteAnniversaryEvent, getAnniversaryRange, COMPANION_LOGIN_URL, COMPANION_RETURN_URL } from '../../services/companion'
import { chinaDate, formatDateOnly, Panel } from './careShared'
import MonthCalendar, { ymd } from './MonthCalendar'

function formatTime(ts) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}

export default function AnniversaryWindow({ theme, onClose }) {
  const today = chinaDate()
  const [entries, setEntries] = useState(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [loadAuthRequired, setLoadAuthRequired] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(() => { const [y, m] = today.split('-').map(Number); return { year: y, monthIndex: m - 1 } })
  const [selectedDate, setSelectedDate] = useState(today)
  const [draft, setDraft] = useState('')
  const primary = theme?.primary || '#c97fa8'

  useEffect(() => {
    let live = true
    setError('')
    setLoadAuthRequired(false)
    const start = ymd(cursor.year, cursor.monthIndex, 1)
    const end = ymd(cursor.year, cursor.monthIndex, new Date(Date.UTC(cursor.year, cursor.monthIndex + 1, 0)).getUTCDate())
    getAnniversaryRange(start, end).then((res) => { if (live) setEntries(res.entries || {}) }).catch((e) => {
      if (!live) return
      setLoadAuthRequired(e?.status === 401)
      setError(e?.status === 401 ? '登录状态已过期，纪念日记录都还在。' : (e.message || '纪念日加载失败'))
    })
    return () => { live = false }
  }, [cursor.year, cursor.monthIndex, loadNonce])

  const dayEvents = useMemo(() => (entries?.[selectedDate] || []).slice().sort((a, b) => a.ts - b.ts), [entries, selectedDate])

  function changeMonth(delta) {
    setCursor(({ year, monthIndex }) => {
      const next = new Date(Date.UTC(year, monthIndex + delta, 1))
      return { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() }
    })
  }

  async function submitEvent(e) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await addAnniversaryEvent(selectedDate, text)
      setEntries((prev) => ({ ...(prev || {}), [selectedDate]: res.entries }))
      setDraft('')
    } catch (e) { setError(e.message || '写入失败') }
    setBusy(false)
  }

  async function removeEvent(id) {
    setError('')
    try {
      const res = await deleteAnniversaryEvent(selectedDate, id)
      setEntries((prev) => {
        const next = { ...(prev || {}) }
        if (res.entries?.length) next[selectedDate] = res.entries
        else delete next[selectedDate]
        return next
      })
    } catch (e) { setError(e.message || '删除失败') }
  }

  if (!entries) return (
    <div className="h-full flex flex-col" style={{ background: 'linear-gradient(180deg,rgba(255,247,251,.76),rgba(239,248,245,.72))' }}>
      <header className="flex items-center gap-3 px-4 shrink-0" style={{ paddingTop: 'calc(var(--safe-top) + 10px)', paddingBottom: 10 }}>
        <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: 0, background: `${primary}14`, color: primary }} aria-label="返回"><ArrowLeft size={18} /></button>
        <div className="font-semibold text-[16px]" style={{ color: '#294b70' }}>纪念日</div>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center px-7 text-center" style={{ color: primary }}>
        {error ? (
          <>
            <div className="text-sm" style={{ color: '#8a6670' }}>{error}</div>
            <button
              type="button"
              onClick={() => {
                if (loadAuthRequired) {
                  sessionStorage.setItem('resumeCareHubAfterLogin', '1')
                  window.location.assign(`${COMPANION_LOGIN_URL}?return=${encodeURIComponent(COMPANION_RETURN_URL)}`)
                  return
                }
                setLoadNonce((v) => v + 1)
              }}
              className="mt-4 px-5 py-2 rounded-full text-xs"
              style={{ border: 0, color: '#fff', background: primary }}
            >
              {loadAuthRequired ? '重新登录并返回' : '重新进入'}
            </button>
          </>
        ) : <><Loader2 className="animate-spin" /><div className="mt-3 text-xs">正在打开纪念日…</div></>}
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col" style={{
      backgroundImage: 'linear-gradient(180deg, rgba(255,247,251,.48), rgba(255,244,249,.34)), url(/backgrounds/care-hub-pink.webp)',
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed',
    }}>
      <header className="flex items-center gap-3 px-4 pt-3 pb-2 shrink-0" style={{ background: 'rgba(255,255,255,.72)', backdropFilter: 'blur(18px)', borderBottom: '1px solid rgba(120,160,210,.13)' }}>
        <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: 0, background: `${primary}14`, color: primary }} aria-label="返回"><ArrowLeft size={18} /></button>
        <div className="flex-1">
          <div className="font-semibold text-[16px]" style={{ color: '#294b70' }}>纪念日</div>
          <div className="text-[11px]" style={{ color: '#7d98b4' }}>记下有纪念意义的事情或约定</div>
        </div>
      </header>

      {error && <div className="mx-4 mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: '#fff0f0', color: '#bf5b5b' }}>{error}</div>}

      <main className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
        <Panel>
          <MonthCalendar
            year={cursor.year}
            monthIndex={cursor.monthIndex}
            today={today}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevMonth={() => changeMonth(-1)}
            onNextMonth={() => changeMonth(1)}
            primary={primary}
            renderDay={(date, isSelected) => {
              const count = entries[date]?.length
              if (!count) return <span style={{ height: 6 }} />
              return <Heart size={7} fill={isSelected ? '#fff' : primary} style={{ color: isSelected ? '#fff' : primary }} />
            }}
          />
        </Panel>

        <Panel>
          <div className="text-sm font-semibold mb-3" style={{ color: '#46657c' }}>{formatDateOnly(selectedDate)}{selectedDate === today ? ' · 今天' : ''}</div>
          {dayEvents.length === 0 ? (
            <div className="text-center text-xs py-4" style={{ color: '#9aabba' }}>这天还没有记事</div>
          ) : (
            <div className="space-y-2 mb-3">
              {dayEvents.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 rounded-2xl px-3 py-2.5" style={{ background: `${primary}0c` }}>
                  <Heart size={13} className="mt-0.5 shrink-0" style={{ color: primary }} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] leading-5 whitespace-pre-wrap" style={{ color: '#455267' }}>{ev.text}</div>
                    <div className="text-[10px] mt-1" style={{ color: '#9aabba' }}>{formatTime(ev.ts)}</div>
                  </div>
                  <button onClick={() => removeEvent(ev.id)} style={{ color: '#c9b2c0' }} aria-label="删除"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={submitEvent} className="flex gap-2 pt-2" style={{ borderTop: dayEvents.length ? '1px solid #edf2f5' : 'none' }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="写下这天有纪念意义的事情或约定…"
              rows={2}
              className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
              style={{ background: '#f5f8fa' }}
            />
            <button disabled={!draft.trim() || busy} className="rounded-xl px-4 text-white text-xs font-medium disabled:opacity-40 self-end" style={{ border: 0, background: primary }}>{busy ? <Loader2 size={14} className="animate-spin" /> : '记下'}</button>
          </form>
        </Panel>
      </main>
    </div>
  )
}
