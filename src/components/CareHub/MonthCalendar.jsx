import { ChevronLeft, ChevronRight } from 'lucide-react'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(n) { return String(n).padStart(2, '0') }
export function ymd(year, monthIndex, day) { return `${year}-${pad(monthIndex + 1)}-${pad(day)}` }
export function monthLabel(year, monthIndex) { return `${year} 年 ${monthIndex + 1} 月` }

/**
 * Presentational month grid shared by the ledger and anniversary windows —
 * each owns its own per-day marker via renderDay(date), this only handles
 * the grid/navigation shell.
 */
export default function MonthCalendar({ year, monthIndex, today, selectedDate, onSelectDate, onPrevMonth, onNextMonth, renderDay, cellStyle, primary }) {
  const firstWeekday = (new Date(Date.UTC(year, monthIndex, 1)).getUTCDay() + 6) % 7
  const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <button type="button" onClick={onPrevMonth} aria-label="上个月" className="w-8 h-8 rounded-full flex items-center justify-center" style={{ border: 0, color: primary, background: `${primary}12` }}><ChevronLeft size={16} /></button>
        <div className="text-sm font-semibold" style={{ color: '#385f76' }}>{monthLabel(year, monthIndex)}</div>
        <button type="button" onClick={onNextMonth} aria-label="下个月" className="w-8 h-8 rounded-full flex items-center justify-center" style={{ border: 0, color: primary, background: `${primary}12` }}><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] mb-1.5" style={{ color: '#9aabba' }}>
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d === null) return <div key={`b${i}`} />
          const date = ymd(year, monthIndex, d)
          const isSelected = date === selectedDate
          const isToday = date === today
          return (
            <button
              key={date}
              type="button"
              onClick={() => onSelectDate(date)}
              className="relative flex flex-col items-center justify-center gap-0.5"
              style={{
                border: isToday && !isSelected ? `1px solid ${primary}55` : '1px solid transparent',
                background: isSelected ? primary : isToday ? `${primary}14` : 'rgba(255,255,255,.55)',
                color: isSelected ? '#fff' : '#526b7d',
                borderRadius: '14px',
                minHeight: 44,
                padding: '4px 0',
                ...(cellStyle?.(date, isSelected, isToday) || {}),
              }}
            >
              <span className="text-xs font-medium leading-none">{d}</span>
              {renderDay?.(date, isSelected)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
