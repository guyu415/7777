import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight, CloudSun, Sun, Trash2, X } from 'lucide-react'
import { getStudySchedule, setStudyScheduleCourse } from '../../services/companion'

const SUBJECTS = ['言语', '判推', '数资', '申论']
const STAGES = ['基础', '刷题', '强化班']
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

  return (
    <div className="study-schedule" role="dialog" aria-modal="true" aria-label="半月课表">
      <button className="study-schedule__backdrop" onClick={onClose} aria-label="关闭课表" />
      <section className="study-schedule__sheet">
        <header className="study-schedule__head">
          <div>
            <span><CalendarDays size={16} /> 半月课表</span>
            <small>{start.replaceAll('-', '.')} — {end.replaceAll('-', '.')}</small>
          </div>
          <button onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </header>

        <nav className="study-schedule__nav" aria-label="切换日期范围">
          <button onClick={() => setWindowStart(value => addDays(value, -15))}><ChevronLeft size={15} /> 前半月</button>
          <button onClick={() => setWindowStart(startWindow)}>回到今天</button>
          <button onClick={() => setWindowStart(value => addDays(value, 15))}>后半月 <ChevronRight size={15} /></button>
        </nav>

        {error && <div className="study-schedule__error">{error}</div>}
        <div className="study-schedule__table">
          <div className="study-schedule__row study-schedule__row--head">
            <span>日期</span><span><Sun size={13} /> 上午 9–12</span><span><CloudSun size={13} /> 下午 2–6</span>
          </div>
          {loading ? <div className="study-schedule__loading">花叶正在展开课表…</div> : days.map(date => {
            const key = dateKey(date)
            return (
              <div className={`study-schedule__row${key === today ? ' is-today' : ''}`} key={key}>
                <div className="study-schedule__date"><strong>{dayLabel(date)}</strong><small>周{weekday(date)}</small></div>
                {['morning', 'afternoon'].map(slot => {
                  const course = entries[key]?.[slot]
                  const colors = course ? SUBJECT_COLORS[course.subject] : null
                  return (
                    <button key={slot} className={`study-schedule__cell${course ? ' has-course' : ''}`} style={colors ? { background: colors[0], color: colors[1] } : undefined} onClick={() => openEditor(key, slot)}>
                      {course ? <><strong>{course.subject}</strong><small>{course.stage}</small></> : <span>＋ 选择课程</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        <p className="study-schedule__note">课表会保存在云端，常驻 Claude Code 也能按日期读取。</p>

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
        .study-schedule{position:fixed;inset:0;z-index:110;display:flex;align-items:flex-end;color:#67706f}
        .study-schedule__backdrop{position:absolute;inset:0;border:0;background:rgba(50,43,55,.24);backdrop-filter:blur(3px)}
        .study-schedule__sheet{position:relative;width:100%;height:min(91dvh,850px);display:flex;flex-direction:column;overflow:hidden;border-radius:30px 30px 0 0;background:linear-gradient(155deg,#fffdfb,#fff9fb 48%,#f7fbf7);box-shadow:0 -18px 55px rgba(68,52,68,.2)}
        .study-schedule__sheet:before{content:'';position:absolute;inset:0;pointer-events:none;opacity:.38;background:radial-gradient(circle at 8% 9%,#f8dce8 0 3px,transparent 4px),radial-gradient(circle at 92% 16%,#d9edd8 0 4px,transparent 5px),radial-gradient(circle at 96% 76%,#f5e1a8 0 3px,transparent 4px)}
        .study-schedule__head{position:relative;display:flex;align-items:center;justify-content:space-between;padding:17px 18px 10px}.study-schedule__head>div>span{display:flex;align-items:center;gap:7px;color:#65746f;font:500 17px/1.3 'ZCOOL XiaoWei',serif}.study-schedule__head small{display:block;margin:4px 0 0 23px;color:#a0aaa5;font-size:9px;letter-spacing:.06em}.study-schedule__head>button,.study-schedule__picker-title>button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;background:#f4edf1;color:#91858e}
        .study-schedule__nav{position:relative;display:flex;justify-content:space-between;padding:0 14px 10px}.study-schedule__nav button{display:flex;align-items:center;gap:2px;padding:6px 8px;border:0;background:transparent;color:#9a929e;font-size:10px}.study-schedule__nav button:nth-child(2){color:#b97891;background:#fff0f5;border-radius:999px;padding-inline:13px}
        .study-schedule__error{margin:0 15px 8px;padding:8px 11px;border-radius:11px;background:#fff0f0;color:#a66666;font-size:11px}
        .study-schedule__table{position:relative;flex:1;min-height:0;overflow:auto;margin:0 12px;border:1px solid rgba(145,164,151,.18);border-radius:20px;background:rgba(255,255,255,.48)}
        .study-schedule__row{display:grid;grid-template-columns:52px minmax(0,1fr) minmax(0,1fr);min-height:57px;border-bottom:1px dashed rgba(143,157,147,.18)}.study-schedule__row:last-child{border-bottom:0}.study-schedule__row--head{position:sticky;top:0;z-index:2;min-height:43px;background:rgba(249,246,247,.96);border-bottom:1px solid rgba(143,157,147,.2)}.study-schedule__row--head span{display:flex;align-items:center;justify-content:center;gap:4px;color:#9a98a3;font-size:9px}.study-schedule__row--head span:first-child{background:#faeef1;border-radius:18px 0 0 0}
        .study-schedule__date{display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(250,239,242,.58);color:#9a7e87}.study-schedule__date strong{font:500 13px/1.2 'ZCOOL XiaoWei',serif}.study-schedule__date small{margin-top:3px;font-size:8px;color:#b6a8ae}.study-schedule__row.is-today .study-schedule__date{background:#f7dfe8;color:#ae657f}.study-schedule__row.is-today .study-schedule__date small:after{content:' · 今'}
        .study-schedule__cell{margin:4px;padding:3px 5px;min-width:0;border:0;border-radius:12px;background:transparent;color:#c1babd}.study-schedule__cell+button{border-left:1px dashed rgba(143,157,147,.14)}.study-schedule__cell span{font-size:9px}.study-schedule__cell strong,.study-schedule__cell small{display:block}.study-schedule__cell strong{font:500 14px/1.25 'ZCOOL XiaoWei',serif}.study-schedule__cell small{margin-top:3px;font-size:9px;opacity:.78}
        .study-schedule__loading{padding:36px;text-align:center;color:#aaa3ac;font-size:11px}.study-schedule__note{position:relative;margin:8px 14px calc(9px + env(safe-area-inset-bottom));text-align:center;color:#aaa8aa;font-size:9px}
        .study-schedule__picker{position:fixed;inset:0;z-index:4;display:flex;align-items:flex-end}.study-schedule__picker-backdrop{position:absolute;inset:0;border:0;background:rgba(62,50,65,.25);backdrop-filter:blur(2px)}.study-schedule__picker-card{position:relative;width:100%;padding:18px 18px calc(18px + env(safe-area-inset-bottom));border-radius:26px 26px 0 0;background:#fffdfd;box-shadow:0 -14px 40px rgba(69,53,69,.2)}
        .study-schedule__picker-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:17px}.study-schedule__picker-title strong{color:#736a75;font:500 18px/1.2 'ZCOOL XiaoWei',serif}.study-schedule__picker-title span{margin-left:9px;color:#aaa0aa;font-size:10px}.study-schedule__picker-card label{display:block;margin:12px 2px 7px;color:#99909a;font-size:10px}.study-schedule__choices{display:flex;gap:8px}.study-schedule__choices button{flex:1;padding:10px 4px;border:1px solid #eee5e9;border-radius:12px;background:#fff;color:#8f858d;font-size:12px}.study-schedule__choices button.selected{border-color:#e5a9be;background:#fff0f5;color:#ad627c;box-shadow:0 3px 10px rgba(205,132,159,.12)}
        .study-schedule__picker-actions{display:flex;gap:9px;margin-top:20px}.study-schedule__picker-actions button{height:43px;border:0;border-radius:14px}.study-schedule__picker-actions .clear{width:82px;display:flex;align-items:center;justify-content:center;gap:5px;background:#f5f1f2;color:#a2999e}.study-schedule__picker-actions .confirm{flex:1;background:linear-gradient(135deg,#ecaac0,#d692ad);color:white;box-shadow:0 7px 17px rgba(197,121,150,.22)}
      `}</style>
    </div>
  )
}
