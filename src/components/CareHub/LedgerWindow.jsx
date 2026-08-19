import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CircleDollarSign, Loader2, Trash2 } from 'lucide-react'
import { addCareLedgerEntry, deleteCareLedgerEntry, getCareHubState, onCareHubUpdate, updateCareHubConfig, COMPANION_LOGIN_URL, COMPANION_RETURN_URL } from '../../services/companion'
import { chinaDate, formatDateOnly, Panel } from './careShared'
import MonthCalendar, { ymd } from './MonthCalendar'

const LEDGER_ITEMS = [
  { id: '早餐', emoji: '🥣', category: '餐饮' }, { id: '午餐', emoji: '🍚', category: '餐饮' },
  { id: '晚餐', emoji: '🍲', category: '餐饮' }, { id: '零食饮料', emoji: '🧋', category: '餐饮' },
  { id: '交通', emoji: '🚕', category: '交通' }, { id: '购物', emoji: '🛍️', category: '购物' },
  { id: '学习', emoji: '📖', category: '学习' }, { id: '医疗', emoji: '💊', category: '医疗' },
  { id: '娱乐', emoji: '🎮', category: '娱乐' }, { id: '居住', emoji: '🏠', category: '居住' },
  { id: '其他', emoji: '🧾', category: '其他' }, { id: '自定义', emoji: '✏️', category: '其他' },
]

export default function LedgerWindow({ theme, onClose }) {
  const today = chinaDate()
  const [state, setState] = useState(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [loadAuthRequired, setLoadAuthRequired] = useState(false)
  const [error, setError] = useState('')
  const [cursor, setCursor] = useState(() => { const [y, m] = today.split('-').map(Number); return { year: y, monthIndex: m - 1 } })
  const [selectedDate, setSelectedDate] = useState(today)
  const [expense, setExpense] = useState({ amount: '', item: '午餐', custom: '', kind: 'daily' })
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [budget, setBudget] = useState('')
  const [dailyBudget, setDailyBudget] = useState('')
  const primary = theme?.primary || '#6b9bd1'

  useEffect(() => {
    let live = true
    setError('')
    setLoadAuthRequired(false)
    getCareHubState().then((next) => { if (live) setState(next) }).catch((e) => {
      if (!live) return
      setLoadAuthRequired(e?.status === 401)
      setError(e?.status === 401 ? '登录状态已过期，账本记录都还在。' : (e.message || '账本加载失败'))
    })
    const off = onCareHubUpdate((next) => setState(next))
    return () => { live = false; off() }
  }, [loadNonce])

  useEffect(() => {
    if (!state) return
    setBudget(String(state.ledger.monthlyBudget || ''))
    setDailyBudget(String(state.ledger.dailyBudget || ''))
  }, [state?.updatedAt])

  const entries = state?.ledger.entries || []
  const monthPrefix = `${cursor.year}-${String(cursor.monthIndex + 1).padStart(2, '0')}`
  const monthEntries = useMemo(() => entries.filter((e) => e.date.startsWith(`${monthPrefix}-`)), [entries, monthPrefix])
  const dailyTotalsByDate = useMemo(() => {
    const map = {}
    for (const e of monthEntries) if (e.kind !== 'longTerm') map[e.date] = (map[e.date] || 0) + e.amount
    return map
  }, [monthEntries])
  const longTermEntries = useMemo(() => monthEntries.filter((e) => e.kind === 'longTerm').sort((a, b) => b.date.localeCompare(a.date)), [monthEntries])
  const longTermTotal = useMemo(() => longTermEntries.reduce((sum, e) => sum + e.amount, 0), [longTermEntries])
  const dayEntries = useMemo(() => entries.filter((e) => e.date === selectedDate && e.kind !== 'longTerm'), [entries, selectedDate])
  const dayTotal = useMemo(() => dayEntries.reduce((sum, e) => sum + e.amount, 0), [dayEntries])
  const monthTotal = useMemo(() => monthEntries.reduce((sum, e) => sum + e.amount, 0), [monthEntries])
  const dailyTarget = Number(state?.ledger.dailyBudget || 0)
  const monthlyTarget = Number(state?.ledger.monthlyBudget || 0)

  async function action(fn) {
    setError('')
    try {
      const result = await fn()
      if (result?.state) setState(result.state)
      return true
    } catch (e) { setError(e.message || '操作失败'); return false }
  }

  function changeMonth(delta) {
    setCursor(({ year, monthIndex }) => {
      const next = new Date(Date.UTC(year, monthIndex + delta, 1))
      return { year: next.getUTCFullYear(), monthIndex: next.getUTCMonth() }
    })
  }

  async function submitExpense(e) {
    e.preventDefault()
    const selected = LEDGER_ITEMS.find((item) => item.id === expense.item) || LEDGER_ITEMS[0]
    const note = expense.item === '自定义' ? expense.custom.trim() : expense.item
    if (!note) return setError('请填写消费事项')
    if (await action(() => addCareLedgerEntry({ amount: expense.amount, category: selected.category, note, date: selectedDate, kind: expense.kind }))) {
      setExpense({ ...expense, amount: '', custom: '' })
    }
  }

  if (!state) return (
    <div className="h-full flex flex-col" style={{ background: 'linear-gradient(180deg,rgba(255,247,251,.76),rgba(239,248,245,.72))' }}>
      <header className="flex items-center gap-3 px-4 shrink-0" style={{ paddingTop: 'calc(var(--safe-top) + 10px)', paddingBottom: 10 }}>
        <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: 0, background: `${primary}14`, color: primary }} aria-label="返回"><ArrowLeft size={18} /></button>
        <div className="font-semibold text-[16px]" style={{ color: '#294b70' }}>账本</div>
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
        ) : <><Loader2 className="animate-spin" /><div className="mt-3 text-xs">正在打开账本…</div></>}
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
          <div className="font-semibold text-[16px]" style={{ color: '#294b70' }}>账本</div>
          <div className="text-[11px]" style={{ color: '#7d98b4' }}>本月共 ¥{monthTotal.toFixed(2)}{monthlyTarget ? ` · 预算 ¥${monthlyTarget}` : ''}</div>
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
              const amount = dailyTotalsByDate[date]
              if (!amount) return <span style={{ height: 12 }} />
              return <span className="text-[9px] leading-none" style={{ color: isSelected ? '#fff' : '#56a58d', fontWeight: 600 }}>¥{amount % 1 === 0 ? amount : amount.toFixed(0)}</span>
            }}
          />
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold" style={{ color: '#46657c' }}>{formatDateOnly(selectedDate)}{selectedDate === today ? ' · 今天' : ''} 常规支出</div>
            <div className="text-lg font-semibold" style={{ color: dailyTarget > 0 && dayTotal > dailyTarget ? '#bd716d' : '#446b64' }}>¥{dayTotal.toFixed(2)}</div>
          </div>
          {dailyTarget > 0 && <div className="text-[10px] mb-2" style={{ color: '#9aabba' }}>每日目标 ¥{dailyTarget.toFixed(2)}</div>}
          {dayEntries.length === 0 ? (
            <div className="text-center text-xs py-3" style={{ color: '#9aabba' }}>这天还没有记账</div>
          ) : dayEntries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 py-2 border-b last:border-0" style={{ borderColor: '#edf2f5' }}>
              <div className="flex-1 min-w-0 text-xs font-medium" style={{ color: '#526b7d' }}>{entry.category} · {entry.note || '无备注'}</div>
              <span className="text-sm" style={{ color: '#446b64' }}>¥{entry.amount.toFixed(2)}</span>
              <button onClick={() => action(() => deleteCareLedgerEntry(entry.id))} style={{ color: '#b6c1c9' }} aria-label={`删除${entry.note || entry.category}`}><Trash2 size={13} /></button>
            </div>
          ))}

          <form onSubmit={submitExpense} className="space-y-2.5 mt-3 pt-3" style={{ borderTop: '1px solid #edf2f5' }}>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setExpense({ ...expense, kind: 'daily' })} className="rounded-xl px-3 py-2 text-left" style={{ background: expense.kind === 'daily' ? '#dff0eb' : '#f5f8fa', color: expense.kind === 'daily' ? '#3d7d6b' : '#667e91', border: `1px solid ${expense.kind === 'daily' ? '#8bc5b4' : 'transparent'}` }}><div className="text-xs font-medium">常规记账</div></button>
              <button type="button" onClick={() => setExpense({ ...expense, kind: 'longTerm' })} className="rounded-xl px-3 py-2 text-left" style={{ background: expense.kind === 'longTerm' ? '#eee8f7' : '#f5f8fa', color: expense.kind === 'longTerm' ? '#765b9a' : '#667e91', border: `1px solid ${expense.kind === 'longTerm' ? '#c3b0df' : 'transparent'}` }}><div className="text-xs font-medium">长期开销</div></button>
            </div>
            <div className="grid grid-cols-4 gap-1.5">{LEDGER_ITEMS.map((item) => <button key={item.id} type="button" onClick={() => setExpense({ ...expense, item: item.id })} className="rounded-xl py-2 text-[11px]" style={{ background: expense.item === item.id ? '#dff0eb' : '#f5f8fa', color: expense.item === item.id ? '#3d7d6b' : '#667e91', border: `1px solid ${expense.item === item.id ? '#8bc5b4' : 'transparent'}` }}><span className="block text-base leading-4 mb-1">{item.emoji}</span>{item.id}</button>)}</div>
            {expense.item === '自定义' && <input required value={expense.custom} onChange={(e) => setExpense({ ...expense, custom: e.target.value })} placeholder="是什么花费" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} />}
            <div className="flex gap-2"><input required inputMode="decimal" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} placeholder="输入金额" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} /><button className="rounded-xl px-5 text-white text-xs font-medium" style={{ border: 0, background: '#56a58d' }}>{selectedDate === today ? '记账' : '补记'}</button></div>
          </form>
        </Panel>

        <Panel>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold" style={{ color: '#46657c' }}>长期支出（本月）</div>
            <div className="text-sm" style={{ color: '#8569a6' }}>¥{longTermTotal.toFixed(2)}</div>
          </div>
          {longTermEntries.length === 0 ? (
            <div className="text-center text-xs py-3" style={{ color: '#9aabba' }}>本月还没有长期开销</div>
          ) : longTermEntries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2 py-2 border-b last:border-0" style={{ borderColor: '#edf2f5' }}>
              <div className="flex-1 min-w-0"><div className="text-xs font-medium" style={{ color: '#526b7d' }}>{entry.category} · {entry.note || '无备注'}</div><div className="text-[10px]" style={{ color: '#9aabba' }}>{formatDateOnly(entry.date)}</div></div>
              <span className="text-sm" style={{ color: '#8569a6' }}>¥{entry.amount.toFixed(2)}</span>
              <button onClick={() => action(() => deleteCareLedgerEntry(entry.id))} style={{ color: '#b6c1c9' }} aria-label={`删除${entry.note || entry.category}`}><Trash2 size={13} /></button>
            </div>
          ))}
        </Panel>

        <Panel>
          <button type="button" onClick={() => setBudgetOpen((v) => !v)} className="w-full flex items-center justify-between" style={{ border: 0, background: 'transparent' }}>
            <span className="text-sm font-semibold" style={{ color: '#46657c' }}>预算设置</span>
            <CircleDollarSign size={16} style={{ color: primary, opacity: .7 }} />
          </button>
          {budgetOpen && (
            <div className="grid grid-cols-2 gap-2 mt-3">
              <label className="text-xs" style={{ color: '#6f8799' }}>每日目标金额<input inputMode="decimal" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} placeholder="0 表示不设置" className="block mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f4f7f9' }} /></label>
              <label className="text-xs" style={{ color: '#6f8799' }}>每月预算<input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 表示不设置" className="block mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f4f7f9' }} /></label>
              <button type="button" onClick={() => action(() => updateCareHubConfig({ dailyBudget: Number(dailyBudget || 0), monthlyBudget: Number(budget || 0) }))} className="col-span-2 rounded-xl py-2.5 text-sm font-semibold text-white" style={{ border: 0, background: primary }}>保存</button>
            </div>
          )}
        </Panel>
      </main>
    </div>
  )
}
