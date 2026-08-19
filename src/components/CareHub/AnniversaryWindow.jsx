import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Feather, Loader2, Trash2 } from 'lucide-react'
import { addAnniversaryEvent, deleteAnniversaryEvent, getAnniversaryRange, COMPANION_LOGIN_URL, COMPANION_RETURN_URL } from '../../services/companion'
import { chinaDate, formatDateOnly, Panel } from './careShared'
import MonthCalendar, { ymd } from './MonthCalendar'

const BADGE_COLORS = ['#cfead2', '#fbe7ac', '#cfe3f5', '#f8d3dc']
const BADGE_SHAPES = ['50%', '42% 58% 53% 47% / 45% 42% 58% 55%', '30%']
const WEEKDAY_ICONS = ['⭐', '⭐', '🍀', '❤️', '⭐', '🎀', '❤️']
const BUNTING_COLORS = ['#f8d3dc', '#fbe7ac', '#cfead2', '#cfe3f5', '#e3d6f5']

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
  const primary = theme?.primary || '#8a6bc4'

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
    <div className="h-full flex flex-col" style={{ background: 'linear-gradient(180deg,#ffd9e4 0%,#faf3e6 45%,#e3f2e4 100%)' }}>
      <header className="flex items-center gap-3 px-4 shrink-0" style={{ paddingTop: 'calc(var(--safe-top) + 10px)', paddingBottom: 10 }}>
        <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: 0, background: 'rgba(255,255,255,.85)', color: '#c97fa8' }} aria-label="返回"><ArrowLeft size={18} /></button>
        <div className="font-semibold text-[16px]" style={{ color: '#3a6247', fontFamily: "'ZCOOL XiaoWei', serif" }}>纪念日</div>
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
    <div className="anniversary-window h-full flex flex-col" style={{ background: 'linear-gradient(180deg,#ffd9e4 0%,#faf3e6 38%,#e3f2e4 100%)' }}>
      <header className="anniversary-window__header relative shrink-0 px-5 overflow-hidden" style={{ paddingTop: 'calc(var(--safe-top) + 18px)', paddingBottom: 22 }}>
        <span className="anniversary-window__deco" style={{ top: 6, right: 74, fontSize: 26 }}>⭐</span>
        <span className="anniversary-window__deco" style={{ top: -6, right: 14, fontSize: 46, transform: 'rotate(8deg)' }}>🍯</span>
        <span className="anniversary-window__deco" style={{ top: 34, right: 42, fontSize: 34 }}>☁️</span>
        <span className="anniversary-window__deco" style={{ bottom: -22, left: -12, fontSize: 34, transform: 'rotate(-10deg)' }}>📔</span>
        <button type="button" onClick={onClose} className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center mb-3" style={{ border: 0, background: 'rgba(255,255,255,.85)', color: '#c97fa8', boxShadow: '0 4px 14px rgba(180,130,150,.18)' }} aria-label="返回"><ArrowLeft size={18} /></button>
        <div className="relative z-10 text-[26px] font-bold" style={{ color: '#3a6247', fontFamily: "'ZCOOL XiaoWei', serif" }}>纪念日</div>
        <div className="relative z-10 text-[12px] mt-1" style={{ color: '#5c7a63' }}>记下有纪念意义的事情或约定</div>
      </header>

      {error && <div className="mx-4 mb-2 rounded-xl px-3 py-2 text-xs shrink-0" style={{ background: '#fff0f0', color: '#bf5b5b' }}>{error}</div>}

      <main className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-3">
        <div className="anniversary-window__card rounded-3xl p-4" style={{ background: '#fdf8ee', border: '1px solid #f0e3c8' }}>
          <MonthCalendar
            year={cursor.year}
            monthIndex={cursor.monthIndex}
            today={today}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevMonth={() => changeMonth(-1)}
            onNextMonth={() => changeMonth(1)}
            primary={primary}
            cellStyle={(date, isSelected) => {
              if (isSelected) return { borderRadius: '50%', boxShadow: `0 4px 14px ${primary}55` }
              const day = Number(date.slice(8, 10))
              const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
              return {
                background: BADGE_COLORS[day % BADGE_COLORS.length],
                borderRadius: BADGE_SHAPES[(day + weekday) % BADGE_SHAPES.length],
                color: '#4d6b52',
              }
            }}
            renderDay={(date, isSelected) => {
              const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
              const hasEvent = !!entries[date]?.length
              return (
                <>
                  <span className="text-[9px] leading-none" style={{ opacity: isSelected ? .9 : .55 }}>{WEEKDAY_ICONS[weekday]}</span>
                  {hasEvent && <span className="anniversary-window__has-event" style={{ background: isSelected ? '#fff' : primary }} />}
                </>
              )
            }}
          />
        </div>

        <Panel>
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold" style={{ color: '#3a6247', fontFamily: "'ZCOOL XiaoWei', serif", fontSize: 15 }}>{formatDateOnly(selectedDate)}{selectedDate === today ? ' · 今天' : ''}</div>
            <div className="anniversary-window__bunting" aria-hidden="true">
              {BUNTING_COLORS.map((c, i) => <span key={i} style={{ background: c }} />)}
            </div>
          </div>
          {dayEvents.length === 0 ? (
            <div className="anniversary-window__empty">📔 这一天还没有记录</div>
          ) : (
            <div className="space-y-2 mb-3">
              {dayEvents.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 rounded-2xl px-3 py-2.5" style={{ background: `${primary}0c` }}>
                  <span className="mt-0.5 shrink-0 text-sm">💗</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] leading-5 whitespace-pre-wrap" style={{ color: '#455267' }}>{ev.text}</div>
                    <div className="text-[10px] mt-1" style={{ color: '#9aabba' }}>{formatTime(ev.ts)}</div>
                  </div>
                  <button onClick={() => removeEvent(ev.id)} style={{ border: 0, background: 'transparent', color: '#c9b2c0' }} aria-label="删除"><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}
          <form onSubmit={submitEvent} className="flex gap-2 pt-3 mt-1" style={{ borderTop: '1px dashed #e3d6c8' }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="写下这一天有纪念意义的事情或约定…"
              rows={2}
              className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none resize-none"
              style={{ background: '#e3ece4', color: '#3f5a45' }}
            />
            <button disabled={!draft.trim() || busy} className="rounded-full px-4 flex items-center gap-1.5 text-white text-xs font-medium disabled:opacity-40 self-end" style={{ border: 0, background: primary }}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Feather size={13} />}记下</button>
          </form>
        </Panel>
      </main>

      <style>{`
        .anniversary-window__deco { position: absolute; filter: drop-shadow(0 3px 6px rgba(150,110,90,.15)); pointer-events: none; }
        .anniversary-window__has-event { display: block; width: 5px; height: 5px; border-radius: 50%; margin-top: 1px; }
        .anniversary-window__empty {
          text-align: center; font-size: 12px; color: #5c7a63; padding: 18px 10px;
          border: 1.5px dashed #f0b8c8; border-radius: 16px; background: rgba(255,255,255,.5);
        }
        .anniversary-window__bunting { display: flex; gap: 3px; }
        .anniversary-window__bunting span {
          width: 11px; height: 13px;
          clip-path: polygon(0 0, 100% 0, 50% 100%);
        }
      `}</style>
    </div>
  )
}
