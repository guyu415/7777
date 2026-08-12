import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, BookOpenCheck, CalendarDays, Check, CircleDollarSign, Loader2, Newspaper, Plus, RefreshCw, Send, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import {
  addCareLedgerEntry, addCareStudyGoal, deleteCareLedgerEntry, deleteCareStudyGoal,
  getCareHubState, onCareHubUpdate, runCareRole, sendCareHubInput,
  toggleCareStudyGoal, updateCareHubConfig, getCodexModelStatus, getMysteryCcModels,
  COMPANION_LOGIN_URL, COMPANION_RETURN_URL,
} from '../../services/companion'

const ROLES = {
  news: { name: '晨间新闻', icon: Newspaper, emoji: '📰', color: '#4f8fd8', desc: '联网筛选五条今日新闻' },
  ledger: { name: '记账员', icon: CircleDollarSign, emoji: '🧾', color: '#56a58d', desc: '记账与每日预算回顾' },
  almanac: { name: '黄历运势', icon: Sparkles, emoji: '🧭', color: '#b07ac4', desc: '今日黄历、运势和提醒' },
  study: { name: '学习监督', icon: BookOpenCheck, emoji: '📚', color: '#e18a72', desc: '目标检查与清单打勾' },
}
const ROLE_IDS = Object.keys(ROLES)
const LEDGER_ITEMS = [
  { id: '早餐', emoji: '🥣', category: '餐饮' }, { id: '午餐', emoji: '🍚', category: '餐饮' },
  { id: '晚餐', emoji: '🍲', category: '餐饮' }, { id: '零食饮料', emoji: '🧋', category: '餐饮' },
  { id: '交通', emoji: '🚕', category: '交通' }, { id: '购物', emoji: '🛍️', category: '购物' },
  { id: '学习', emoji: '📖', category: '学习' }, { id: '医疗', emoji: '💊', category: '医疗' },
  { id: '娱乐', emoji: '🎮', category: '娱乐' }, { id: '居住', emoji: '🏠', category: '居住' },
  { id: '其他', emoji: '🧾', category: '其他' }, { id: '自定义', emoji: '✏️', category: '其他' },
]

function LinkText({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s)]+)/g)
  return <>{parts.map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline break-all" style={{ color: '#397bc1' }}>{part}</a>
    : <span key={i}>{part}</span>)}</>
}

function formatTime(ts) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}

function chinaDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function formatDateOnly(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return date || ''
  return `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
}

function ledgerPeriod(date, rawStartDay) {
  const [year, month, dayOfMonth] = date.split('-').map(Number)
  const startDay = Math.min(31, Math.max(1, Math.trunc(Number(rawStartDay)) || 1))
  const makeDate = (y, monthIndex) => new Date(Date.UTC(y, monthIndex, Math.min(startDay, new Date(Date.UTC(y, monthIndex + 1, 0)).getUTCDate())))
  const current = new Date(Date.UTC(year, month - 1, dayOfMonth))
  const candidate = makeDate(year, month - 1)
  const start = current >= candidate ? candidate : makeDate(year, month - 2)
  const next = makeDate(start.getUTCFullYear(), start.getUTCMonth() + 1)
  const end = new Date(next.getTime() - 86400000)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) }
}

function Panel({ children }) {
  return <div className="rounded-3xl p-4" style={{ background: 'rgba(255,255,255,.72)', border: '1px solid rgba(150,180,220,.2)', boxShadow: '0 8px 30px rgba(70,100,150,.06)' }}>{children}</div>
}

export default function CareHubWindow({ theme, onClose }) {
  const [state, setState] = useState(null)
  const [loadNonce, setLoadNonce] = useState(0)
  const [loadAuthRequired, setLoadAuthRequired] = useState(false)
  const [tab, setTab] = useState('chat')
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [expense, setExpense] = useState({ amount: '', item: '午餐', custom: '', date: chinaDate(), kind: 'daily' })
  const [goal, setGoal] = useState({ title: '', schedule: 'daily', dateDraft: '', dates: [] })
  const [draftRoles, setDraftRoles] = useState(null)
  const [budget, setBudget] = useState('')
  const [dailyBudget, setDailyBudget] = useState('')
  const [monthStartDay, setMonthStartDay] = useState('1')
  const [modelOptions, setModelOptions] = useState({
    codex: [],
    'claude-code': [{ id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' }],
    gemini: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite（免费额度）' }],
  })
  const feedEnd = useRef(null)
  const primary = theme?.primary || '#6b9bd1'

  useEffect(() => {
    let live = true
    setError('')
    setLoadAuthRequired(false)
    getCareHubState().then((next) => { if (live) setState(next) }).catch((e) => {
      if (!live) return
      setLoadAuthRequired(e?.status === 401)
      setError(e?.status === 401 ? 'companion 登录状态已过期，群聊和记录都还在。' : (e.message || '生活关怀群加载失败'))
    })
    const off = onCareHubUpdate((next) => setState(next))
    return () => { live = false; off() }
  }, [loadNonce])
  useEffect(() => {
    let live = true
    Promise.allSettled([getCodexModelStatus(), getMysteryCcModels()]).then(([codex, cc]) => {
      if (!live) return
      setModelOptions({
        codex: codex.status === 'fulfilled' ? (codex.value.models || []).map((item) => ({ id: item.id, label: item.displayName || item.id })) : [],
        'claude-code': cc.status === 'fulfilled' && cc.value?.length ? cc.value.map((id) => ({ id, label: id })) : [{ id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' }],
        gemini: [{ id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite（免费额度）' }],
      })
    })
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!state) return
    setDraftRoles(structuredClone(state.config.roles))
    setBudget(String(state.ledger.monthlyBudget || ''))
    setDailyBudget(String(state.ledger.dailyBudget || ''))
    setMonthStartDay(String(state.ledger.monthStartDay || 1))
  }, [state?.updatedAt])
  useEffect(() => { if (tab === 'chat') feedEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [tab, state?.messages?.length])

  const today = chinaDate()
  const period = ledgerPeriod(today, state?.ledger.monthStartDay || 1)
  const monthEntries = useMemo(() => (state?.ledger.entries || []).filter((e) => e.date >= period.start && e.date <= period.end), [state, period.start, period.end])
  const ledgerSummary = useMemo(() => {
    const byCategory = {}
    let total = 0
    for (const item of monthEntries) { total += item.amount; byCategory[item.category] = (byCategory[item.category] || 0) + item.amount }
    return { total, byCategory }
  }, [monthEntries])
  const dailyEntries = useMemo(() => monthEntries.filter((entry) => entry.date === today && entry.kind !== 'longTerm'), [monthEntries, today])
  const dailyTotal = useMemo(() => dailyEntries.reduce((sum, entry) => sum + entry.amount, 0), [dailyEntries])
  const dailyTarget = Number(state?.ledger.dailyBudget || 0)
  const dailyRemaining = dailyTarget > 0 ? dailyTarget - dailyTotal : null
  const longTermTotal = useMemo(() => monthEntries.filter((entry) => entry.kind === 'longTerm').reduce((sum, entry) => sum + entry.amount, 0), [monthEntries])
  const goals = state?.study.goals || []
  const todayGoals = goals.filter((item) => item.schedule !== 'dates' || (item.dates || []).includes(today))
  const goalDoneToday = (item) => item.schedule === 'daily' || item.schedule === 'dates' ? (item.completedDates || []).includes(today) : !!item.done
  const doneCount = todayGoals.filter(goalDoneToday).length

  async function action(fn) {
    setError('')
    try {
      const result = await fn()
      if (result?.state) setState(result.state)
      return true
    } catch (e) { setError(e.message || '操作失败'); return false }
  }

  async function submitQuick(e) {
    e.preventDefault()
    if (!input.trim() || sending) return
    setSending(true)
    const ok = await action(() => sendCareHubInput(input.trim()))
    if (ok) setInput('')
    setSending(false)
  }

  if (!state) return (
    <div className="h-full flex flex-col" style={{ background: 'linear-gradient(180deg,rgba(255,247,251,.76),rgba(239,248,245,.72))' }}>
      <header className="flex items-center gap-3 px-4 shrink-0" style={{ paddingTop: 'calc(var(--safe-top) + 10px)', paddingBottom: 10 }}>
        <button type="button" onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: 0, background: `${primary}14`, color: primary }} aria-label="返回"><ArrowLeft size={18} /></button>
        <div className="font-semibold text-[16px]" style={{ color: '#294b70' }}>生活关怀群</div>
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
                setLoadNonce((value) => value + 1)
              }}
              className="mt-4 px-5 py-2 rounded-full text-xs"
              style={{ border: 0, color: '#fff', background: primary }}
            >
              {loadAuthRequired ? '重新登录并返回' : '重新进入'}
            </button>
          </>
        ) : <><Loader2 className="animate-spin" /><div className="mt-3 text-xs">正在进入关怀群…</div></>}
      </div>
    </div>
  )

  const tabs = [
    ['chat', '群消息', Newspaper], ['ledger', '账本', BarChart3], ['study', '学习', BookOpenCheck], ['settings', '设置', Settings2],
  ]

  return (
    <div className="h-full flex flex-col" style={{
      backgroundImage: 'linear-gradient(180deg, rgba(255,247,251,.48), rgba(255,244,249,.34)), url(/backgrounds/care-hub-pink.webp)',
      backgroundSize: 'cover', backgroundPosition: 'center', backgroundAttachment: 'fixed',
    }}>
      <header className="px-4 pt-3 pb-2 shrink-0" style={{ background: 'rgba(255,255,255,.72)', backdropFilter: 'blur(18px)', borderBottom: '1px solid rgba(120,160,210,.13)' }}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `${primary}14`, color: primary }}><ArrowLeft size={18} /></button>
          <div className="flex-1">
            <div className="font-semibold text-[16px]" style={{ color: '#294b70' }}>生活关怀群</div>
            <div className="text-[11px]" style={{ color: '#7d98b4' }}>4 个固定岗位 · 中国时区</div>
          </div>
          {state.runningRole && <div className="flex items-center gap-1 text-[11px]" style={{ color: ROLES[state.runningRole].color }}><Loader2 size={13} className="animate-spin" />{ROLES[state.runningRole].name}</div>}
        </div>
        <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
          {ROLE_IDS.map((id) => <div key={id} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shrink-0 text-[11px]" style={{ color: ROLES[id].color, background: `${ROLES[id].color}12`, border: `1px solid ${ROLES[id].color}24` }}><span>{ROLES[id].emoji}</span>{ROLES[id].name}</div>)}
        </div>
      </header>

      <nav className="grid grid-cols-4 gap-1 px-3 py-2 shrink-0">
        {tabs.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className="rounded-2xl py-2 flex items-center justify-center gap-1 text-xs font-medium" style={{ color: tab === id ? primary : '#8197ad', background: tab === id ? `${primary}16` : 'transparent' }}><Icon size={14} />{label}</button>)}
      </nav>

      {error && <div className="mx-4 mb-2 rounded-xl px-3 py-2 text-xs" style={{ background: '#fff0f0', color: '#bf5b5b' }}>{error}</div>}

      <main className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {tab === 'chat' && <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {ROLE_IDS.map((id) => {
              const meta = ROLES[id]
              const running = state.runningRole === id
              return <button key={id} disabled={!!state.runningRole} onClick={() => action(() => runCareRole(id))} className="text-left rounded-2xl p-3 disabled:opacity-60" style={{ background: `${meta.color}0e`, border: `1px solid ${meta.color}22` }}>
                <div className="flex items-center justify-between"><span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.emoji} {meta.name}</span>{running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={12} style={{ color: meta.color }} />}</div>
                <div className="text-[10px] mt-1" style={{ color: '#879caf' }}>{meta.desc}</div>
              </button>
            })}
          </div>
          {(state.messages || []).length === 0 && <Panel><div className="text-center py-8"><div className="text-3xl mb-3">🌿</div><div className="text-sm font-medium" style={{ color: '#52708e' }}>关怀群已经就位</div><div className="text-xs mt-1" style={{ color: '#91a5b8' }}>可以手动叫岗位开工，也会按设置时间自动推送</div></div></Panel>}
          {(state.messages || []).map((message) => {
            const meta = ROLES[message.role]
            return <div key={message.id} className="flex items-start gap-2.5">
              <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-lg" style={{ background: `${meta.color}16` }}>{meta.emoji}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1"><span className="text-xs font-semibold" style={{ color: meta.color }}>{meta.name}</span><span className="text-[10px]" style={{ color: '#9aabba' }}>{formatTime(message.ts)}</span></div>
                <div className="rounded-2xl rounded-tl-md px-3.5 py-3 text-[13px] leading-6 whitespace-pre-wrap" style={{ background: 'rgba(255,255,255,.82)', color: '#40566c', border: `1px solid ${meta.color}18` }}><LinkText text={message.text} /></div>
              </div>
            </div>
          })}
          <div ref={feedEnd} />
        </div>}

        {tab === 'ledger' && <div className="space-y-3">
          <Panel>
            <div className="flex items-center justify-between"><div><div className="text-xs" style={{ color: '#849aad' }}>{formatDateOnly(period.start)}—{formatDateOnly(period.end)} 本期支出</div><div className="text-3xl font-semibold mt-1" style={{ color: '#385f76' }}>¥{ledgerSummary.total.toFixed(2)}</div></div><CircleDollarSign size={34} style={{ color: '#56a58d', opacity: .65 }} /></div>
            <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ background: '#e6f0ef' }}><div className="h-full rounded-full" style={{ background: '#56a58d', width: `${state.ledger.monthlyBudget ? Math.min(100, ledgerSummary.total / state.ledger.monthlyBudget * 100) : 0}%` }} /></div>
            <div className="flex justify-between text-[11px] mt-1.5" style={{ color: '#849aad' }}><span>{monthEntries.length} 笔 · 含长期开销 ¥{longTermTotal.toFixed(2)}</span><span>{state.ledger.monthlyBudget ? `预算 ¥${state.ledger.monthlyBudget} · 剩余 ¥${(state.ledger.monthlyBudget - ledgerSummary.total).toFixed(2)}` : '尚未设置月预算'}</span></div>
            <div className="mt-4 space-y-2">{Object.entries(ledgerSummary.byCategory).sort((a, b) => b[1] - a[1]).map(([name, amount]) => <div key={name}><div className="flex justify-between text-xs mb-1" style={{ color: '#60788d' }}><span>{name}</span><span>¥{amount.toFixed(2)}</span></div><div className="h-1.5 rounded-full" style={{ background: '#edf2f4' }}><div className="h-full rounded-full" style={{ width: `${ledgerSummary.total ? amount / ledgerSummary.total * 100 : 0}%`, background: '#79b7a5' }} /></div></div>)}</div>
          </Panel>
          <Panel>
            <div className="flex items-start justify-between gap-3"><div><div className="text-xs" style={{ color: '#849aad' }}>今日常规支出</div><div className="text-2xl font-semibold mt-1" style={{ color: dailyRemaining !== null && dailyRemaining < 0 ? '#bd716d' : '#446b64' }}>¥{dailyTotal.toFixed(2)}</div></div><div className="text-right text-[11px]" style={{ color: '#849aad' }}>{dailyTarget > 0 ? <><div>每日目标 ¥{dailyTarget.toFixed(2)}</div><div className="mt-1" style={{ color: dailyRemaining < 0 ? '#bd716d' : '#6e9b8a' }}>{dailyRemaining >= 0 ? `还可用 ¥${dailyRemaining.toFixed(2)}` : `超出 ¥${Math.abs(dailyRemaining).toFixed(2)}`}</div></> : <div>尚未设置每日目标</div>}</div></div>
            {dailyTarget > 0 ? <><div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: '#e6f0ef' }}><div className="h-full rounded-full" style={{ background: dailyRemaining < 0 ? '#d88982' : '#79b7a5', width: `${Math.min(100, dailyTotal / dailyTarget * 100)}%` }} /></div><div className="text-[10px] mt-1.5" style={{ color: '#9aabba' }}>{dailyEntries.length} 笔常规记账 · 长期开销不计入此处</div></> : <div className="text-[11px] mt-3" style={{ color: '#9aabba' }}>在“设置”中填写每日目标后，这里会只追踪常规记账。</div>}
          </Panel>
          <Panel>
            <div className="text-sm font-semibold mb-3" style={{ color: '#46657c' }}>记一笔</div>
            <form onSubmit={async (e) => {
              e.preventDefault()
              const selected = LEDGER_ITEMS.find((item) => item.id === expense.item) || LEDGER_ITEMS[0]
              const note = expense.item === '自定义' ? expense.custom.trim() : expense.item
              if (!note) return setError('请填写消费事项')
              if (await action(() => addCareLedgerEntry({ amount: expense.amount, category: selected.category, note, date: expense.date, kind: expense.kind }))) setExpense({ ...expense, amount: '', custom: '' })
            }} className="space-y-3">
              <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setExpense({ ...expense, kind: 'daily' })} className="rounded-xl px-3 py-2 text-left" style={{ background: expense.kind === 'daily' ? '#dff0eb' : '#f5f8fa', color: expense.kind === 'daily' ? '#3d7d6b' : '#667e91', border: `1px solid ${expense.kind === 'daily' ? '#8bc5b4' : 'transparent'}` }}><div className="text-xs font-medium">常规记账</div><div className="text-[10px] mt-0.5 opacity-75">计入每日目标</div></button><button type="button" onClick={() => setExpense({ ...expense, kind: 'longTerm' })} className="rounded-xl px-3 py-2 text-left" style={{ background: expense.kind === 'longTerm' ? '#eee8f7' : '#f5f8fa', color: expense.kind === 'longTerm' ? '#765b9a' : '#667e91', border: `1px solid ${expense.kind === 'longTerm' ? '#c3b0df' : 'transparent'}` }}><div className="text-xs font-medium">长期开销</div><div className="text-[10px] mt-0.5 opacity-75">只计入每月花销</div></button></div>
              <div className="grid grid-cols-4 gap-1.5">{LEDGER_ITEMS.map((item) => <button key={item.id} type="button" onClick={() => setExpense({ ...expense, item: item.id })} className="rounded-xl py-2 text-[11px]" style={{ background: expense.item === item.id ? '#dff0eb' : '#f5f8fa', color: expense.item === item.id ? '#3d7d6b' : '#667e91', border: `1px solid ${expense.item === item.id ? '#8bc5b4' : 'transparent'}` }}><span className="block text-base leading-4 mb-1">{item.emoji}</span>{item.id}</button>)}</div>
              {expense.item === '自定义' && <input required value={expense.custom} onChange={(e) => setExpense({ ...expense, custom: e.target.value })} placeholder="是什么花费" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} />}
              <label className="block text-[11px]" style={{ color: '#7890a2' }}>消费日期（可补记）<input required type="date" max={today} value={expense.date} onChange={(e) => setExpense({ ...expense, date: e.target.value })} className="block mt-1 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa', color: '#526b7d' }} /></label>
              <div className="flex gap-2"><input required inputMode="decimal" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} placeholder="输入金额" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} /><button className="rounded-xl px-5 text-white text-xs font-medium" style={{ background: '#56a58d' }}>{expense.date === today ? '记账' : '补记'}</button></div>
            </form>
          </Panel>
          <Panel><div className="text-sm font-semibold mb-2" style={{ color: '#46657c' }}>最近记录</div>{[...monthEntries].reverse().map((entry) => <div key={entry.id} className="flex items-center gap-2 py-2 border-b last:border-0" style={{ borderColor: '#edf2f5' }}><div className="flex-1 min-w-0"><div className="text-xs font-medium" style={{ color: '#526b7d' }}><span style={{ color: entry.kind === 'longTerm' ? '#8569a6' : '#526b7d' }}>{entry.kind === 'longTerm' ? '长期' : '日常'}</span> · {entry.category} · {entry.note || '无备注'}</div><div className="text-[10px]" style={{ color: '#9aabba' }}>{entry.date}</div></div><span className="text-sm" style={{ color: entry.kind === 'longTerm' ? '#8569a6' : '#446b64' }}>¥{entry.amount.toFixed(2)}</span><button onClick={() => action(() => deleteCareLedgerEntry(entry.id))} style={{ color: '#b6c1c9' }} aria-label={`删除${entry.note || entry.category}`}><Trash2 size={13} /></button></div>)}</Panel>
        </div>}

        {tab === 'study' && <div className="space-y-3">
          <Panel><div className="flex justify-between items-end"><div><div className="text-xs" style={{ color: '#849aad' }}>今日目标完成度</div><div className="text-3xl font-semibold mt-1" style={{ color: '#8f655c' }}>{doneCount}<span className="text-base"> / {todayGoals.length}</span></div></div><BookOpenCheck size={34} style={{ color: '#e18a72', opacity: .7 }} /></div><div className="mt-4 h-2 rounded-full" style={{ background: '#f4e9e5' }}><div className="h-full rounded-full" style={{ background: '#e18a72', width: `${todayGoals.length ? doneCount / todayGoals.length * 100 : 0}%` }} /></div></Panel>
          <Panel>
            <form onSubmit={async (e) => {
              e.preventDefault()
              if (goal.schedule === 'dates' && !goal.dates.length) return setError('请至少选择一个学习日期')
              if (await action(() => addCareStudyGoal({ title: goal.title, schedule: goal.schedule, dates: goal.dates }))) setGoal({ title: '', schedule: 'daily', dateDraft: '', dates: [] })
            }} className="space-y-3">
              <input required value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="预设一个学习目标" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} />
              <div className="grid grid-cols-2 gap-2">
                {[['daily', '每天'], ['dates', '指定日期']].map(([value, label]) => <button key={value} type="button" onClick={() => setGoal({ ...goal, schedule: value })} className="rounded-xl py-2 text-xs" style={{ background: goal.schedule === value ? '#f8e6e0' : '#f5f8fa', color: goal.schedule === value ? '#b86855' : '#71889a', border: `1px solid ${goal.schedule === value ? '#e8a897' : 'transparent'}` }}>{value === 'daily' ? '🔁' : '📅'} {label}</button>)}
              </div>
              {goal.schedule === 'dates' && <div className="space-y-2">
                <div className="flex gap-2"><input type="date" value={goal.dateDraft} onChange={(e) => setGoal({ ...goal, dateDraft: e.target.value })} className="min-w-0 flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: '#f5f8fa', color: '#667e91' }} /><button type="button" disabled={!goal.dateDraft || goal.dates.includes(goal.dateDraft)} onClick={() => setGoal({ ...goal, dates: [...goal.dates, goal.dateDraft].sort(), dateDraft: '' })} className="rounded-xl px-3 disabled:opacity-40" style={{ background: '#f8e6e0', color: '#b86855' }} aria-label="添加日期"><Plus size={16} /></button></div>
                {goal.dates.length > 0 && <div className="flex flex-wrap gap-1.5">{goal.dates.map((date) => <span key={date} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px]" style={{ background: '#f8e6e0', color: '#9d665a' }}>{formatDateOnly(date)}<button type="button" onClick={() => setGoal({ ...goal, dates: goal.dates.filter((item) => item !== date) })} aria-label={`移除 ${date}`}><X size={11} /></button></span>)}</div>}
              </div>}
              <button className="w-full rounded-xl py-2.5 text-white text-xs" style={{ background: '#e18a72' }}>添加目标</button>
            </form>
          </Panel>
          <Panel>{goals.length === 0 ? <div className="text-center text-xs py-5" style={{ color: '#91a5b8' }}>还没有学习目标</div> : goals.map((item) => {
            const isRecurring = item.schedule === 'daily' || item.schedule === 'dates'
            const done = goalDoneToday(item)
            return <div key={item.id} className="py-3 border-b last:border-0" style={{ borderColor: '#edf2f5' }}>
              <div className="flex items-center gap-3">
                {(item.schedule !== 'dates' || (item.dates || []).includes(today)) && <button onClick={() => action(() => toggleCareStudyGoal(item.id, !done, isRecurring ? today : undefined))} className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0" style={{ background: done ? '#e18a72' : 'transparent', borderColor: done ? '#e18a72' : '#c8d4dc', color: 'white' }}>{done && <Check size={14} />}</button>}
                {item.schedule === 'dates' && !(item.dates || []).includes(today) && <CalendarDays size={22} className="shrink-0" style={{ color: '#d79a89' }} />}
                <div className="flex-1 min-w-0"><div className="text-sm" style={{ color: done ? '#9eabb5' : '#526b7d', textDecoration: done ? 'line-through' : 'none' }}>{item.title}</div><div className="text-[10px] mt-0.5" style={{ color: '#a1afb9' }}>{item.schedule === 'daily' ? `每天 · ${done ? '今日已完成' : '今日待完成'}` : item.schedule === 'dates' ? `${(item.dates || []).length} 个指定日期` : item.targetDate ? `截止 ${item.targetDate}` : '单次目标'}</div></div>
                <button onClick={() => action(() => deleteCareStudyGoal(item.id))} style={{ color: '#b6c1c9' }}><Trash2 size={13} /></button>
              </div>
              {item.schedule === 'dates' && <div className="flex flex-wrap gap-1.5 mt-2 ml-9">{(item.dates || []).map((date) => { const dateDone = (item.completedDates || []).includes(date); return <button key={date} onClick={() => action(() => toggleCareStudyGoal(item.id, !dateDone, date))} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px]" style={{ background: dateDone ? '#e18a72' : '#f5f1f0', color: dateDone ? 'white' : '#8c7772' }}>{dateDone && <Check size={10} />}{formatDateOnly(date)}</button> })}</div>}
            </div>
          })}</Panel>
        </div>}

        {tab === 'settings' && draftRoles && <div className="space-y-3">
          {ROLE_IDS.map((id) => {
            const meta = ROLES[id], config = draftRoles[id]
            const choices = [{ id: '', label: '跟随当前默认模型' }, ...(modelOptions[config.runtime] || [])]
            if (config.model && !choices.some((item) => item.id === config.model)) choices.push({ id: config.model, label: `${config.model}（当前设置）` })
              return <Panel key={id}><div className="flex items-center gap-2 mb-3"><span>{meta.emoji}</span><div className="flex-1"><div className="text-sm font-semibold" style={{ color: meta.color }}>{meta.name}</div><div className="text-[10px]" style={{ color: '#91a5b8' }}>{meta.desc}</div></div><button onClick={() => setDraftRoles({ ...draftRoles, [id]: { ...config, enabled: !config.enabled } })} className="w-10 h-6 rounded-full p-0.5 transition-colors" style={{ background: config.enabled ? meta.color : '#ccd5dc' }}><div className="w-5 h-5 bg-white rounded-full transition-transform" style={{ transform: config.enabled ? 'translateX(16px)' : 'none' }} /></button></div><div className="grid grid-cols-2 gap-2"><label className="text-[10px]" style={{ color: '#8297a9' }}>推送时间<input type="time" value={config.time} onChange={(e) => setDraftRoles({ ...draftRoles, [id]: { ...config, time: e.target.value } })} className="block mt-1 w-full rounded-xl px-2 py-2 text-xs outline-none" style={{ background: '#f4f7f9', color: '#526b7d' }} /></label><label className="text-[10px]" style={{ color: '#8297a9' }}>运行方式<select value={config.runtime} onChange={(e) => { const runtime = e.target.value; setDraftRoles({ ...draftRoles, [id]: { ...config, runtime, model: '' } }) }} className="block mt-1 w-full rounded-xl px-2 py-2 text-xs outline-none" style={{ background: '#f4f7f9', color: '#526b7d' }}><option value="codex">ChatGPT 登录（Codex 通道）</option><option value="claude-code">Claude Code</option><option value="gemini">Gemini API</option></select></label></div><label className="block text-[10px] mt-2" style={{ color: '#8297a9' }}>模型<select value={config.model} onChange={(e) => setDraftRoles({ ...draftRoles, [id]: { ...config, model: e.target.value } })} className="block mt-1 w-full rounded-xl px-2 py-2 text-xs outline-none" style={{ background: '#f4f7f9', color: '#526b7d' }}>{choices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{config.runtime === 'codex' && <div className="text-[10px] mt-2" style={{ color: '#7890a5' }}>使用 VPS 上的 ChatGPT 登录与套餐额度，不走 OpenAI API Key。</div>}{config.lastError && <div className="text-[10px] mt-2" style={{ color: '#c46b6b' }}>上次错误：{config.lastError}</div>}</Panel>
          })}
          <Panel><div className="grid grid-cols-3 gap-2"><label className="text-xs" style={{ color: '#6f8799' }}>每日目标金额<input inputMode="decimal" value={dailyBudget} onChange={(e) => setDailyBudget(e.target.value)} placeholder="0 表示不设置" className="block mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f4f7f9' }} /><span className="block mt-1 text-[10px]" style={{ color: '#9aabba' }}>仅统计常规记账</span></label><label className="text-xs" style={{ color: '#6f8799' }}>每期预算<input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 表示不设置" className="block mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f4f7f9' }} /><span className="block mt-1 text-[10px]" style={{ color: '#9aabba' }}>包含长期开销</span></label><label className="text-xs" style={{ color: '#6f8799' }}>每月起始日<input type="number" min="1" max="31" step="1" value={monthStartDay} onChange={(e) => setMonthStartDay(e.target.value)} className="block mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f4f7f9' }} /></label></div><div className="text-[10px] mt-2" style={{ color: '#91a5b8' }}>例如填 15，则每期从当月 15 日统计到下月 14 日；遇到短月自动按月末处理。</div></Panel>
          <button onClick={() => action(() => updateCareHubConfig({ roles: draftRoles, dailyBudget: Number(dailyBudget || 0), monthlyBudget: Number(budget || 0), monthStartDay: Number(monthStartDay) }))} className="w-full rounded-2xl py-3 text-sm font-semibold text-white" style={{ background: `linear-gradient(135deg, ${primary}, #8d7bc4)` }}>保存全部设置</button>
        </div>}
      </main>

      {tab === 'chat' && <form onSubmit={submitQuick} className="shrink-0 px-3 py-3 flex gap-2" style={{ background: 'rgba(255,255,255,.82)', borderTop: '1px solid rgba(120,160,210,.12)' }}><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="目标… / 完成…（记账请点“账本”快捷选择）" className="min-w-0 flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none" style={{ background: '#f1f5f8', color: '#456176' }} /><button disabled={!input.trim() || sending} className="w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-40" style={{ background: primary }}>{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button></form>}
    </div>
  )
}
