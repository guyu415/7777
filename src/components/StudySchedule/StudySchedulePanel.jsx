import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react'
import { getStudySchedule, setStudyScheduleCourse } from '../../services/companion'

const SUBJECTS = ['言语', '判推', '数资', '申论']
const STAGES = ['基础', '刷题', '强化班', '模考']
const SLOT_LABELS = { morning: '上午 9–12', afternoon: '下午 2–6' }
const SUBJECT_COLORS = {
  言语: ['#fff0f4', '#b86f86'], 判推: ['#eef3ff', '#7185ad'],
  数资: ['#edf8f3', '#5f927b'], 申论: ['#fff6e8', '#ad8057'],
}

function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function addDays(date, amount) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  next.setHours(12, 0, 0, 0)
  return next
}

function startWindow() {
  return addDays(new Date(), -7)
}

function dayLabel(date) {
  return `${date.getMonth() + 1}.${date.getDate()}`
}

function weekday(date) {
  return '日一二三四五六'[date.getDay()]
}

export default function StudySchedulePanel({ onClose }) {
  const [windowStart, setWindowStart] = useState(startWindow)
  const [entries, setEntries] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [stage, setStage] = useState(STAGES[0])
  const [saving, setSaving] = useState(false)
  const days = useMemo(() => Array.from({ length: 15 }, (_, index) => addDays(windowStart, index)), [windowStart])
  const start = dateKey(days[0])
  const end = dateKey(days[14])
  const today = dateKey(new Date())

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getStudySchedule(start, end).then((data) => {
      if (!cancelled) setEntries(data?.entries || {})
    }).catch((err) => {
      if (!cancelled) setError(err?.message || '课表暂时没有加载出来')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [start, end])

  const openEditor = (date, slot) => {
    const current = entries[date]?.[slot]
    setEditing({ date, slot })
    setSubject(current?.subject || SUBJECTS[0])
    setStage(current?.stage || STAGES[0])
  }

  const save = async (course) => {
    if (!editing || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await setStudyScheduleCourse(editing.date, editing.slot, course)
      setEntries(current => {
        const next = { ...current }
        if (Object.keys(result?.entry || {}).length) next[editing.date] = result.entry
        else delete next[editing.date]
        return next
      })
      setEditing(null)
    } catch (err) {
      setError(err?.message || '保存失败，请稍后再试')
    } finally {
      setSaving(false)
    }
  }

  return createPortal((
    <div className="study-schedule" role="dialog" aria-modal="true" aria-label="半月课表">
      <button className="study-schedule__backdrop" onClick={onClose} aria-label="关闭课表" />
      <section className="study-schedule__sheet">
        <div className="study-schedule__canvas-scroll">
          <div className="study-schedule__table">
            <header className="study-schedule__head">
              <div>
                <span><CalendarDays size={14} /> 半月课表</span>
                <small>{start.replaceAll('-', '.')} — {end.replaceAll('-', '.')}</small>
              </div>
              <button onClick={onClose} aria-label="关闭"><X size={17} /></button>
            </header>
            <nav className="study-schedule__nav" aria-label="切换日期范围">
              <button onClick={() => setWindowStart(value => addDays(value, -15))}><ChevronLeft size={13} /> 前半月</button>
              <button onClick={() => setWindowStart(startWindow)}>回到今天</button>
              <button onClick={() => setWindowStart(value => addDays(value, 15))}>后半月 <ChevronRight size={13} /></button>
            </nav>
            {error && <div className="study-schedule__error">{error}</div>}
            <div className="study-schedule__row study-schedule__row--head">
              <span>日期</span><span>上午 9–12</span><span>下午 2–6</span>
            </div>
            {loading ? <div className="study-schedule__loading">花叶正在展开课表…</div> : days.map((date, index) => {
              const key = dateKey(date)
              return (
                <div className={`study-schedule__row${key === today ? ' is-today' : ''}`} style={{ '--row-index': index }} key={key}>
                  <div className="study-schedule__date"><strong>{dayLabel(date)}</strong><small>周{weekday(date)}</small></div>
                  {['morning', 'afternoon'].map(slot => {
                    const course = entries[key]?.[slot]
                    const colors = course ? SUBJECT_COLORS[course.subject] : null
                    return (
                      <button key={slot} className={`study-schedule__cell${course ? ' has-course' : ''}`} style={colors ? { background: colors[0], color: colors[1] } : undefined} onClick={() => openEditor(key, slot)}>
                        {course ? <span><strong>{course.subject}</strong> · {course.stage}</span> : <span>＋</span>}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {editing && (
          <div className="study-schedule__picker">
            <button className="study-schedule__picker-backdrop" onClick={() => setEditing(null)} aria-label="取消选择" />
            <div className="study-schedule__picker-card">
              <div className="study-schedule__picker-title">
                <div><strong>{editing.date.slice(5).replace('-', '.')}</strong><span>{SLOT_LABELS[editing.slot]}</span></div>
                <button onClick={() => setEditing(null)}><X size={17} /></button>
              </div>
              <label>科目</label>
              <div className="study-schedule__choices">{SUBJECTS.map(item => <button className={subject === item ? 'selected' : ''} key={item} onClick={() => setSubject(item)}>{item}</button>)}</div>
              <label>班型</label>
              <div className="study-schedule__choices">{STAGES.map(item => <button className={stage === item ? 'selected' : ''} key={item} onClick={() => setStage(item)}>{item}</button>)}</div>
              <div className="study-schedule__picker-actions">
                <button className="clear" onClick={() => save(null)} disabled={saving}><Trash2 size={15} /> 清空</button>
                <button className="confirm" onClick={() => save({ subject, stage })} disabled={saving}>{saving ? '保存中…' : `填入 ${subject} · ${stage}`}</button>
              </div>
            </div>
          </div>
        )}
      </section>

      <style>{`
        .study-schedule{position:fixed;inset:0;z-index:1000;display:flex;align-items:stretch;justify-content:center;color:#67706f}
        .study-schedule__backdrop{position:absolute;inset:0;border:0;background:rgba(50,43,55,.24);backdrop-filter:blur(3px)}
        .study-schedule__sheet{position:relative;width:min(100%,480px);height:100dvh;overflow:hidden;background:#fffaf7;box-shadow:0 0 55px rgba(68,52,68,.2);animation:study-schedule-rise .32s cubic-bezier(.22,.78,.3,1)}
        .study-schedule__canvas-scroll{width:100%;height:100%;overflow:hidden;overscroll-behavior:contain}.study-schedule__table{position:relative;width:100%;height:100%;background:url('/assets/study-schedule-garden.jpg') center/100% 100% no-repeat}
        .study-schedule__head{position:absolute;z-index:3;left:7.8%;right:6.8%;top:4.7%;display:flex;align-items:center;justify-content:space-between}.study-schedule__head>div>span{display:flex;align-items:center;gap:6px;color:#778379;font:500 clamp(16px,4.8vw,21px)/1.25 'ZCOOL XiaoWei',serif}.study-schedule__head small{display:block;margin:4px 0 0 20px;color:#9fa7a1;font-size:clamp(9px,2.5vw,12px);letter-spacing:.04em}.study-schedule__head>button,.study-schedule__picker-title>button{width:32px;height:32px;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,247,250,.82);color:#91858e;box-shadow:0 2px 8px rgba(120,95,110,.08)}
        .study-schedule__nav{position:absolute;z-index:3;left:7.8%;right:6.8%;top:11.3%;display:flex;justify-content:space-between}.study-schedule__nav button{display:flex;align-items:center;gap:2px;padding:5px 7px;border:0;background:rgba(255,255,255,.42);border-radius:999px;color:#918992;font-size:clamp(9px,2.7vw,12px)}.study-schedule__nav button:nth-child(2){color:#b36f88;background:rgba(255,238,245,.78);padding-inline:11px}
        .study-schedule__error{position:absolute;z-index:5;left:12%;right:10%;top:18%;padding:7px 9px;border-radius:10px;background:rgba(255,240,240,.94);color:#a66666;font-size:9px;text-align:center}
        .study-schedule__row{position:absolute;left:7.8%;right:6.8%;top:calc(22.72% + var(--row-index) * 4.5%);height:4.5%;display:grid;grid-template-columns:11.35% 44.35% 44.3%;align-items:stretch}.study-schedule__row--head{top:15.86%;height:6.86%;z-index:2}.study-schedule__row--head span{display:flex;align-items:center;justify-content:center;color:#8f929a;font:500 clamp(11px,3.2vw,14px)/1 'ZCOOL XiaoWei',serif;letter-spacing:.03em}.study-schedule__row--head span:first-child{font-size:clamp(10px,2.8vw,12px);color:#aaa0a4}
        .study-schedule__date{display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9b7e86}.study-schedule__date strong{font:500 clamp(10px,2.8vw,12px)/1 'ZCOOL XiaoWei',serif}.study-schedule__date small{margin-top:3px;font-size:clamp(7px,1.9vw,9px);line-height:1;color:#b29ca4}.study-schedule__row.is-today .study-schedule__date{color:#b75778;text-shadow:0 0 5px rgba(255,255,255,.9)}.study-schedule__row.is-today .study-schedule__date small:after{content:'·今'}
        .study-schedule__cell{min-width:0;height:68%;align-self:center;margin:0 5px;padding:0 4px;display:flex;align-items:center;justify-content:center;border:0;border-radius:11px;background:transparent;color:rgba(169,153,160,.58)}.study-schedule__cell span{display:flex;align-items:center;justify-content:center;max-width:100%;height:100%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font:500 clamp(10px,2.8vw,12px)/1 'ZCOOL XiaoWei',serif}.study-schedule__cell.has-course{box-shadow:inset 0 0 0 1px rgba(255,255,255,.62),0 1px 4px rgba(121,103,110,.06)}.study-schedule__cell strong{font-weight:600}
        .study-schedule__loading{position:absolute;left:20%;right:10%;top:48%;text-align:center;color:#aaa3ac;font-size:11px}
        .study-schedule__picker{position:fixed;inset:0;z-index:4;display:flex;align-items:flex-end}.study-schedule__picker-backdrop{position:absolute;inset:0;border:0;background:rgba(62,50,65,.25);backdrop-filter:blur(2px)}.study-schedule__picker-card{position:relative;width:min(100%,480px);margin-inline:auto;padding:25px 18px calc(18px + env(safe-area-inset-bottom));border-radius:26px 26px 0 0;background:#fffdfd;box-shadow:0 -14px 40px rgba(69,53,69,.2);animation:study-picker-rise .28s cubic-bezier(.2,.78,.3,1)}.study-schedule__picker-card:before{content:'';position:absolute;top:9px;left:50%;width:38px;height:4px;border-radius:999px;background:#e6dde1;transform:translateX(-50%)}
        .study-schedule__picker-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.study-schedule__picker-title strong{color:#736a75;font:500 18px/1.2 'ZCOOL XiaoWei',serif}.study-schedule__picker-title span{margin-left:9px;color:#aaa0aa;font-size:10px}.study-schedule__picker-card label{display:block;margin:12px 2px 7px;color:#99909a;font-size:10px}.study-schedule__choices{display:flex;gap:8px}.study-schedule__choices button{flex:1;padding:10px 4px;border:1px solid #eee5e9;border-radius:12px;background:#fff;color:#8f858d;font-size:12px}.study-schedule__choices button.selected{border-color:#e5a9be;background:#fff0f5;color:#ad627c;box-shadow:0 3px 10px rgba(205,132,159,.12)}
        .study-schedule__picker-actions{display:flex;gap:9px;margin-top:20px}.study-schedule__picker-actions button{height:43px;border:0;border-radius:14px}.study-schedule__picker-actions .clear{width:82px;display:flex;align-items:center;justify-content:center;gap:5px;background:#f5f1f2;color:#a2999e}.study-schedule__picker-actions .confirm{flex:1;background:linear-gradient(135deg,#ecaac0,#d692ad);color:white;box-shadow:0 7px 17px rgba(197,121,150,.22)}
        @keyframes study-schedule-rise{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes study-picker-rise{from{transform:translateY(100%)}to{transform:translateY(0)}}
      `}</style>
    </div>
  ), document.body)
}
