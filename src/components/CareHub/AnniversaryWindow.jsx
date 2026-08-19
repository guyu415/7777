import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookHeart, Feather, Heart, Loader2, Trash2 } from 'lucide-react'
import { addAnniversaryEvent, deleteAnniversaryEvent, getAnniversaryRange, COMPANION_LOGIN_URL, COMPANION_RETURN_URL } from '../../services/companion'
import { chinaDate, formatDateOnly } from './careShared'
import MonthCalendar, { ymd } from './MonthCalendar'

const BADGE_COLORS = ['#e2f0df', '#fff1c9', '#e7eef9', '#fde5ed', '#eee6fb']
const BADGE_BORDERS = ['#bfdcbc', '#f0d88e', '#bfd3ec', '#f1bdcf', '#d3c0ed']
const BADGE_SHAPES = [
  '50%',
  '42% 58% 53% 47% / 45% 42% 58% 55%',
  '31% 69% 58% 42% / 42% 52% 48% 58%',
  '48% 52% 44% 56% / 57% 42% 58% 43%',
]
const WEEKDAY_MARKS = ['✦', '✦', '♧', '♥', '✦', '♧', '♥']
const WEEKDAY_MARK_COLORS = ['#f0c56e', '#f0c56e', '#99c99f', '#ee9fb4', '#f0c56e', '#91b9d5', '#ee9fb4']
const DAY_MARKS = ['·', '✦', '•', '♡', '✿', '♧']
const BUNTING_COLORS = ['#f5c4d2', '#f5df9c', '#cfe3d2', '#cbddea', '#ddcef0']

function formatTime(ts) {
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

export default function AnniversaryWindow({ theme, onClose }) {
  const today = chinaDate()
  const [entries, setEntries] = useState(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [loadAuthRequired, setLoadAuthRequired] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cursor, setCursor] = useState(() => {
    const [year, month] = today.split('-').map(Number)
    return { year, monthIndex: month - 1 }
  })
  const [selectedDate, setSelectedDate] = useState(today)
  const [draft, setDraft] = useState('')
  const primary = theme?.primary || '#8a6bc4'

  useEffect(() => {
    let live = true
    setError('')
    setLoadAuthRequired(false)
    const start = ymd(cursor.year, cursor.monthIndex, 1)
    const end = ymd(cursor.year, cursor.monthIndex, daysInMonth(cursor.year, cursor.monthIndex))
    getAnniversaryRange(start, end).then((res) => {
      if (live) setEntries(res.entries || {})
    }).catch((e) => {
      if (!live) return
      setLoadAuthRequired(e?.status === 401)
      setError(e?.status === 401 ? '登录状态已过期，纪念日记录都还在。' : (e.message || '纪念日加载失败'))
    })
    return () => { live = false }
  }, [cursor.year, cursor.monthIndex, loadNonce])

  const dayEvents = useMemo(() => (entries?.[selectedDate] || []).slice().sort((a, b) => a.ts - b.ts), [entries, selectedDate])

  function changeMonth(delta) {
    const next = new Date(Date.UTC(cursor.year, cursor.monthIndex + delta, 1))
    const nextCursor = { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() }
    const currentDay = Number(selectedDate.slice(8, 10)) || 1
    setCursor(nextCursor)
    setSelectedDate(ymd(nextCursor.year, nextCursor.monthIndex, Math.min(currentDay, daysInMonth(nextCursor.year, nextCursor.monthIndex))))
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
    } catch (e) {
      setError(e.message || '写入失败')
    }
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
    } catch (e) {
      setError(e.message || '删除失败')
    }
  }

  const shellStyle = { '--anniversary-primary': primary }
  const hero = (
    <header className="anniversary-window__hero relative shrink-0 overflow-hidden">
      <div className="anniversary-window__hero-inner">
        <button type="button" onClick={onClose} className="anniversary-window__back" aria-label="返回">
          <ArrowLeft size={20} />
        </button>

        <div className="anniversary-window__hero-copy">
          <h1>纪念日</h1>
        </div>

        <img className="anniversary-window__sticker anniversary-window__sticker--notebook" src="/assets/anniversary-sticker-notebook.png" alt="" aria-hidden="true" />
        <img className="anniversary-window__sticker anniversary-window__sticker--jar-cloud" src="/assets/anniversary-sticker-jar-cloud.png" alt="" aria-hidden="true" />
      </div>
    </header>
  )

  if (!entries) return (
    <div className="anniversary-window h-full flex flex-col" style={shellStyle}>
      <div className="anniversary-window__texture" aria-hidden="true" />
      {hero}
      <div className="anniversary-window__loading flex-1 flex flex-col items-center justify-center px-7 text-center">
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
                setLoadNonce((value) => value + 1)
              }}
              className="anniversary-window__retry mt-4"
            >
              {loadAuthRequired ? '重新登录并返回' : '重新进入'}
            </button>
          </>
        ) : (
          <><Loader2 className="animate-spin" size={22} /><div className="mt-3 text-xs">正在打开纪念日…</div></>
        )}
      </div>
    </div>
  )

  return (
    <div className="anniversary-window h-full flex flex-col" style={shellStyle}>
      <div className="anniversary-window__texture" aria-hidden="true" />
      {hero}

      {error && <div className="anniversary-window__error mx-4 mt-2 shrink-0" role="status">{error}</div>}

      <main className="anniversary-window__main flex-1 min-h-0 overflow-y-auto">
        <div className="anniversary-window__content">
          <section className="anniversary-window__calendar-card" aria-label="纪念日月历">
            <MonthCalendar
              year={cursor.year}
              monthIndex={cursor.monthIndex}
              today={today}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
              onPrevMonth={() => changeMonth(-1)}
              onNextMonth={() => changeMonth(1)}
              primary={primary}
              variant="anniversary"
              renderWeekday={(_, index) => <span className="anniversary-window__weekday-mark" style={{ color: WEEKDAY_MARK_COLORS[index] }}>{WEEKDAY_MARKS[index]}</span>}
              cellStyle={(date, isSelected, isToday) => {
                const day = Number(date.slice(8, 10))
                const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7
                const paletteIndex = (day + weekday) % BADGE_COLORS.length
                if (isSelected) {
                  return {
                    background: primary,
                    border: '2px solid rgba(255,255,255,.9)',
                    borderRadius: BADGE_SHAPES[(day + weekday) % BADGE_SHAPES.length],
                    color: '#fff',
                    boxShadow: `0 7px 17px ${primary}55, inset 0 0 0 1px rgba(255,255,255,.16)`,
                    transform: 'translateY(-1px)',
                  }
                }
                return {
                  background: BADGE_COLORS[paletteIndex],
                  border: `1.5px solid ${isToday ? `${primary}78` : BADGE_BORDERS[paletteIndex]}`,
                  borderRadius: BADGE_SHAPES[(day + weekday) % BADGE_SHAPES.length],
                  color: '#315b42',
                  boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.78), 0 2px 8px rgba(105,135,104,.08)',
                }
              }}
              renderDay={(date, isSelected) => {
                const day = Number(date.slice(8, 10))
                const hasEvent = !!entries[date]?.length
                return <span className={`anniversary-window__day-mark ${hasEvent ? 'is-event' : ''}`} style={{ color: isSelected ? '#fff' : undefined }}>{hasEvent ? '♥' : DAY_MARKS[day % DAY_MARKS.length]}</span>
              }}
            />
          </section>

          <section className="anniversary-window__entry-card" aria-label="当天纪念日记录">
            <div className="anniversary-window__entry-bunting" aria-hidden="true">
              <span className="anniversary-window__entry-bunting-line" />
              {BUNTING_COLORS.map((color, index) => <span key={index} style={{ background: color }} />)}
            </div>
            <div className="anniversary-window__entry-heading">
              <span className="anniversary-window__entry-pin" aria-hidden="true"><Heart size={12} fill="currentColor" /></span>
              <h2>{formatDateOnly(selectedDate)}{selectedDate === today ? ' · 今天' : ''}</h2>
            </div>

            <img className="anniversary-window__entry-envelope" src="/assets/anniversary-sticker-envelope.png" alt="" aria-hidden="true" />

            {dayEvents.length === 0 ? (
              <div className="anniversary-window__empty">
                <BookHeart size={27} strokeWidth={1.6} aria-hidden="true" />
                <span>这一天还没有记录</span>
              </div>
            ) : (
              <div className="anniversary-window__events">
                {dayEvents.map((event) => (
                  <div key={event.id} className="anniversary-window__event">
                    <span className="anniversary-window__event-icon" aria-hidden="true"><Heart size={13} fill="currentColor" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="anniversary-window__event-text">{event.text}</div>
                      <div className="anniversary-window__event-time">{formatTime(event.ts)}</div>
                    </div>
                    <button type="button" onClick={() => removeEvent(event.id)} className="anniversary-window__delete" aria-label="删除这条记录"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}

            <form onSubmit={submitEvent} className="anniversary-window__composer">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="写下这一天有纪念意义的事情或约定…"
                rows={3}
                aria-label="纪念日内容"
                className="anniversary-window__textarea min-w-0 flex-1 resize-none outline-none"
              />
              <button type="submit" disabled={!draft.trim() || busy} className="anniversary-window__submit">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Feather size={15} />}
                <span>记下</span>
              </button>
            </form>
            <img className="anniversary-window__entry-bear" src="/assets/anniversary-sticker-bear.png" alt="" aria-hidden="true" />
          </section>
        </div>
      </main>

      <style>{`
        .anniversary-window {
          --anniversary-ink: #285b42;
          --anniversary-muted: #80978a;
          position: relative;
          isolation: isolate;
          overflow: hidden;
          color: var(--anniversary-ink);
          background: #fff4eb;
          font-family: var(--app-font, 'Noto Sans SC', 'PingFang SC', sans-serif);
        }
        .anniversary-window__texture {
          position: absolute;
          z-index: 0;
          inset: 0;
          pointer-events: none;
          background: url('/backgrounds/anniversary-journal-pastel.webp') center top / cover no-repeat;
          opacity: .92;
        }
        .anniversary-window > :not(.anniversary-window__texture) { position: relative; z-index: 1; }
        .anniversary-window__hero {
          min-height: 0;
          padding: calc(var(--safe-top) + 4px) 20px 0;
          background: linear-gradient(180deg, rgba(255, 209, 224, .62), rgba(255, 242, 235, .26));
        }
        .anniversary-window__hero-inner { position: relative; width: min(100%, 620px); min-height: clamp(112px, 27.5vw, 123px); margin: 0 auto; }
        .anniversary-window__back {
          position: relative;
          z-index: 3;
          display: grid;
          width: 44px;
          height: 44px;
          place-items: center;
          border: 1px solid rgba(224, 154, 177, .34);
          border-radius: 50%;
          color: #c96d91;
          background: rgba(255, 252, 248, .82);
          box-shadow: 0 5px 15px rgba(182, 116, 142, .13);
          transition: transform .18s ease, background .18s ease;
        }
        .anniversary-window__back:active { transform: scale(.94); background: #fff; }
        .anniversary-window__hero-copy { position: absolute; z-index: 3; top: clamp(32px, 9vw, 40px); left: clamp(58px, 16vw, 98px); margin: 0; }
        .anniversary-window__hero-copy h1 {
          margin: 0;
          color: var(--anniversary-ink);
          font: 600 clamp(27px, 6.8vw, 32px)/1.08 ui-rounded, 'STYuanti-SC-Regular', 'Hiragino Maru Gothic ProN', 'Yuanti SC', 'YouYuan', 'Noto Sans SC', sans-serif;
          letter-spacing: .08em;
          text-shadow: 0 2px 0 rgba(255,255,255,.42);
        }
        .anniversary-window__sticker {
          position: absolute;
          z-index: 2;
          display: block;
          max-width: none;
          height: auto;
          object-fit: contain;
          pointer-events: none;
          user-select: none;
          filter: drop-shadow(0 5px 7px rgba(177, 118, 135, .13));
        }
        .anniversary-window__sticker--notebook {
          bottom: -1px;
          left: 0;
          width: min(28vw, 130px);
          transform: rotate(-3deg);
        }
        .anniversary-window__sticker--jar-cloud {
          top: 0;
          right: 0;
          width: min(42vw, 180px);
        }
        .anniversary-window__loading { position: relative; z-index: 1; color: var(--anniversary-primary); }
        .anniversary-window__retry {
          padding: 10px 20px;
          border: 0;
          border-radius: 999px;
          color: #fff;
          background: var(--anniversary-primary);
          box-shadow: 0 6px 14px color-mix(in srgb, var(--anniversary-primary) 25%, transparent);
        }
        .anniversary-window__error {
          padding: 9px 12px;
          border: 1px solid #f2ccd3;
          border-radius: 14px;
          color: #b56872;
          background: rgba(255, 242, 242, .86);
          font-size: 12px;
        }
        .anniversary-window__main { position: relative; z-index: 1; padding: 0 14px calc(18px + var(--safe-bottom)); overscroll-behavior: contain; }
        .anniversary-window__content { width: min(100%, 620px); margin: 0 auto; padding-bottom: 12px; }
        .anniversary-window__calendar-card,
        .anniversary-window__entry-card {
          position: relative;
          border: 1px solid rgba(201, 225, 198, .94);
          box-shadow: 0 13px 30px rgba(105, 142, 108, .13), 0 2px 5px rgba(180, 145, 143, .06);
        }
        .anniversary-window__calendar-card {
          overflow: hidden;
          padding: 21px 16px 20px;
          border-radius: 35px;
          background: rgba(255, 253, 247, .95);
        }
        .anniversary-window__calendar-card::before,
        .anniversary-window__entry-card::before {
          content: '';
          position: absolute;
          inset: 5px;
          z-index: 0;
          border: 1px solid rgba(255,255,255,.88);
          border-radius: 30px;
          pointer-events: none;
        }
        .anniversary-window__calendar-card > *,
        .anniversary-window__entry-card > * { position: relative; z-index: 1; }
        .anniversary-window .care-month-calendar__nav { margin: 0 4px 17px; }
        .anniversary-window .care-month-calendar__nav-button {
          width: 43px !important;
          height: 43px !important;
          border: 1px solid #d9e8d4 !important;
          color: #326442 !important;
          background: rgba(255,255,255,.72) !important;
          box-shadow: 0 3px 8px rgba(115, 151, 114, .08);
          transition: transform .18s ease, box-shadow .18s ease;
        }
        .anniversary-window .care-month-calendar__nav-button:active { transform: scale(.93); box-shadow: none; }
        .anniversary-window .care-month-calendar__month {
          position: relative;
          color: var(--anniversary-ink) !important;
          font: 500 clamp(22px, 6vw, 28px)/1 'ZCOOL XiaoWei', serif;
          letter-spacing: .08em;
          text-shadow: 0 1px 0 rgba(255,255,255,.8);
        }
        .anniversary-window .care-month-calendar__month::before,
        .anniversary-window .care-month-calendar__month::after { color: #efadbf; font-size: 12px; vertical-align: 5px; }
        .anniversary-window .care-month-calendar__month::before { content: '♥'; margin-right: 11px; }
        .anniversary-window .care-month-calendar__month::after { content: '♥'; margin-left: 11px; }
        .anniversary-window .care-month-calendar__weekdays { margin-bottom: 13px; color: #3a654a !important; }
        .anniversary-window .care-month-calendar__weekday { display: flex; min-width: 0; flex-direction: column; align-items: center; gap: 5px; font: 500 14px/1 'ZCOOL XiaoWei', serif; }
        .anniversary-window__weekday-mark { height: 10px; font: 10px/1 'Noto Sans SC', sans-serif; opacity: .9; }
        .anniversary-window .care-month-calendar__grid { column-gap: 5px; row-gap: 10px; padding: 0 1px 3px; }
        .anniversary-window .care-month-calendar__day {
          justify-self: center;
          width: 100%;
          max-width: 65px;
          border-style: solid !important;
          font-family: 'ZCOOL XiaoWei', 'Noto Sans SC', sans-serif;
          transition: transform .18s ease, filter .18s ease, box-shadow .18s ease;
        }
        .anniversary-window .care-month-calendar__day > span:first-child { font: 500 clamp(15px, 4.5vw, 19px)/1 'ZCOOL XiaoWei', serif; }
        .anniversary-window .care-month-calendar__day:active { filter: saturate(1.08); transform: scale(.94); }
        .anniversary-window__day-mark { height: 11px; color: #b6cba9; font: 10px/1 'Noto Sans SC', sans-serif; opacity: .9; }
        .anniversary-window__day-mark.is-event { color: #ed92ae; font-size: 11px; }
        .anniversary-window__entry-card {
          min-height: 280px;
          margin-top: 14px;
          overflow: hidden;
          padding: 20px 18px 24px;
          border-color: rgba(239, 213, 202, .94);
          border-radius: 32px;
          background: rgba(255, 252, 246, .94);
          box-shadow: 0 13px 30px rgba(181, 142, 128, .13), 0 2px 5px rgba(180, 145, 143, .06);
        }
        .anniversary-window__entry-card::before { border-color: rgba(255,255,255,.8); }
        .anniversary-window__entry-heading { display: flex; align-items: center; gap: 8px; padding-right: 112px; }
        .anniversary-window__entry-heading h2 { margin: 0; color: var(--anniversary-ink); font: 500 18px/1.25 'ZCOOL XiaoWei', serif; letter-spacing: .05em; }
        .anniversary-window__entry-pin { display: grid; width: 23px; height: 23px; place-items: center; color: #ef9fb3; border-radius: 50%; background: #fff0f0; transform: rotate(-10deg); }
        .anniversary-window__entry-bunting { position: absolute !important; top: 9px; right: 12px; display: flex; gap: 3px; align-items: flex-start; width: 119px; height: 38px; transform: rotate(4deg); }
        .anniversary-window__entry-bunting-line { position: absolute; top: 0; right: 0; left: 0; height: 1px; background: #e9b9c5; transform: rotate(-3deg); transform-origin: right center; }
        .anniversary-window__entry-bunting > span:not(.anniversary-window__entry-bunting-line) { width: 14px; height: 17px; clip-path: polygon(0 0, 100% 0, 50% 100%); }
        .anniversary-window__empty {
          display: flex;
          min-height: 91px;
          align-items: center;
          justify-content: center;
          gap: 13px;
          margin-top: 18px;
          padding: 15px 58px 15px 18px;
          border: 1.5px dashed #efb8c9;
          border-radius: 20px;
          color: #3d654b;
          background: rgba(255, 255, 255, .5);
          font: 16px 'ZCOOL XiaoWei', 'Noto Sans SC', sans-serif;
        }
        .anniversary-window__empty svg { flex: none; color: #efa2b8; filter: drop-shadow(0 2px 2px rgba(223, 130, 157, .12)); }
        .anniversary-window__events { display: grid; gap: 8px; margin-top: 17px; }
        .anniversary-window__event { display: flex; align-items: flex-start; gap: 9px; padding: 10px 10px 9px; border: 1px solid rgba(226, 218, 232, .82); border-radius: 17px; background: rgba(246, 239, 249, .7); }
        .anniversary-window__event-icon { display: grid; width: 24px; height: 24px; flex: none; place-items: center; color: #e99ab1; border-radius: 50%; background: #fff1f3; }
        .anniversary-window__event-text { color: #496052; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
        .anniversary-window__event-time { margin-top: 3px; color: #a7b3aa; font-size: 10px; }
        .anniversary-window__delete { flex: none; padding: 2px; border: 0; color: #c9b5bf; background: transparent; }
        .anniversary-window__composer { display: flex; align-items: flex-end; gap: 10px; margin-top: 17px; }
        .anniversary-window__textarea {
          min-height: 88px;
          padding: 14px 13px;
          border: 1px solid #dce7d9;
          border-radius: 20px;
          color: #476052;
          background: rgba(232, 241, 231, .88);
          box-shadow: inset 0 1px 3px rgba(108, 139, 112, .06);
          font: 14px/1.6 'Noto Sans SC', sans-serif;
        }
        .anniversary-window__textarea::placeholder { color: #91a097; }
        .anniversary-window__textarea:focus { border-color: color-mix(in srgb, var(--anniversary-primary) 38%, #dce7d9); box-shadow: 0 0 0 3px color-mix(in srgb, var(--anniversary-primary) 10%, transparent); }
        .anniversary-window__submit { display: flex; width: 82px; height: 48px; flex: none; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 999px; color: #fff; background: var(--anniversary-primary); box-shadow: 0 7px 16px color-mix(in srgb, var(--anniversary-primary) 27%, transparent); font-size: 13px; transition: transform .18s ease, opacity .18s ease; }
        .anniversary-window__submit:active:not(:disabled) { transform: translateY(2px) scale(.97); }
        .anniversary-window__submit:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; }
        .anniversary-window__entry-envelope {
          position: absolute !important;
          top: 63px;
          right: 5px;
          z-index: 2 !important;
          width: 84px;
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 4px 5px rgba(177, 118, 135, .13));
          pointer-events: none;
        }
        .anniversary-window__entry-bear {
          position: absolute !important;
          right: auto;
          bottom: -6px;
          left: 0;
          z-index: 2 !important;
          width: 112px;
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 4px 5px rgba(158, 116, 106, .13));
          pointer-events: none;
        }
        @media (min-width: 600px) {
          .anniversary-window__hero { padding-right: 24px; padding-left: 24px; }
          .anniversary-window__main { padding-right: 24px; padding-left: 24px; }
          .anniversary-window__calendar-card { padding-right: 25px; padding-left: 25px; }
          .anniversary-window__entry-card { padding-right: 25px; padding-left: 25px; }
        }
        @media (max-width: 360px) {
          .anniversary-window__hero-inner { min-height: 112px; }
          .anniversary-window__calendar-card { padding: 18px 11px 17px; border-radius: 30px; }
          .anniversary-window .care-month-calendar__grid { column-gap: 3px; row-gap: 7px; }
          .anniversary-window .care-month-calendar__nav { margin-right: 1px; margin-left: 1px; }
          .anniversary-window__entry-card { padding-right: 14px; padding-left: 14px; }
          .anniversary-window__submit { width: 72px; }
          .anniversary-window__entry-heading { padding-right: 90px; }
          .anniversary-window__sticker--jar-cloud { width: min(42vw, 160px); }
          .anniversary-window__entry-bear { width: 101px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .anniversary-window__back,
          .anniversary-window__nav-button,
          .anniversary-window__day,
          .anniversary-window__submit { transition: none; }
        }
      `}</style>
    </div>
  )
}
