import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BarChart3, BookOpenCheck, Check, CircleDollarSign, Loader2, Newspaper, Plus, RefreshCw, Send, Settings2, Sparkles, Trash2 } from 'lucide-react'
import {
  addCareLedgerEntry, addCareStudyGoal, deleteCareLedgerEntry, deleteCareStudyGoal,
  getCareHubState, onCareHubUpdate, runCareRole, sendCareHubInput,
  toggleCareStudyGoal, updateCareHubConfig, getCodexModelStatus, getMysteryCcModels,
} from '../../services/companion'

const ROLES = {
  news: { name: '晨间新闻', icon: Newspaper, emoji: '📰', color: '#4f8fd8', desc: '联网筛选五条今日新闻' },
  ledger: { name: '记账员', icon: CircleDollarSign, emoji: '🧾', color: '#56a58d', desc: '记账与每日预算回顾' },
  almanac: { name: '黄历运势', icon: Sparkles, emoji: '🧭', color: '#b07ac4', desc: '今日黄历、运势和提醒' },
  study: { name: '学习监督', icon: BookOpenCheck, emoji: '📚', color: '#e18a72', desc: '目标检查与清单打勾' },
}
const ROLE_IDS = Object.keys(ROLES)

function LinkText({ text }) {
  const parts = String(text || '').split(/(https?:\/\/[^\s)]+)/g)
  return <>{parts.map((part, i) => /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noreferrer" className="underline break-all" style={{ color: '#397bc1' }}>{part}</a>
    : <span key={i}>{part}</span>)}</>
}

function formatTime(ts) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ts))
}

function Panel({ children }) {
  return <div className="rounded-3xl p-4" style={{ background: 'rgba(255,255,255,.72)', border: '1px solid rgba(150,180,220,.2)', boxShadow: '0 8px 30px rgba(70,100,150,.06)' }}>{children}</div>
}

export default function CareHubWindow({ theme, onClose }) {
  const [state, setState] = useState(null)
  const [tab, setTab] = useState('chat')
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [expense, setExpense] = useState({ amount: '', category: '餐饮', note: '' })
  const [goal, setGoal] = useState({ title: '', targetDate: '' })
  const [draftRoles, setDraftRoles] = useState(null)
  const [budget, setBudget] = useState('')
  const [modelOptions, setModelOptions] = useState({ codex: [], 'claude-code': ['claude-sonnet-4-6'] })
  const feedEnd = useRef(null)
  const primary = theme?.primary || '#6b9bd1'

  useEffect(() => {
    let live = true
    getCareHubState().then((next) => { if (live) setState(next) }).catch((e) => { if (live) setError(e.message || '生活关怀群加载失败') })
    const off = onCareHubUpdate((next) => setState(next))
    return () => { live = false; off() }
  }, [])
  useEffect(() => {
    let live = true
    Promise.allSettled([getCodexModelStatus(), getMysteryCcModels()]).then(([codex, cc]) => {
      if (!live) return
      setModelOptions({
        codex: codex.status === 'fulfilled' ? (codex.value.models || []).map((item) => ({ id: item.id, label: item.displayName || item.id })) : [],
        'claude-code': cc.status === 'fulfilled' && cc.value?.length ? cc.value.map((id) => ({ id, label: id })) : [{ id: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' }],
      })
    })
    return () => { live = false }
  }, [])
  useEffect(() => {
    if (!state) return
    setDraftRoles(structuredClone(state.config.roles))
    setBudget(String(state.ledger.monthlyBudget || ''))
  }, [state?.updatedAt])
  useEffect(() => { if (tab === 'chat') feedEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [tab, state?.messages?.length])

  const today = new Date()
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const monthEntries = useMemo(() => (state?.ledger.entries || []).filter((e) => e.date.startsWith(`${month}-`)), [state, month])
  const ledgerSummary = useMemo(() => {
    const byCategory = {}
    let total = 0
    for (const item of monthEntries) { total += item.amount; byCategory[item.category] = (byCategory[item.category] || 0) + item.amount }
    return { total, byCategory }
  }, [monthEntries])
  const goals = state?.study.goals || []
  const doneCount = goals.filter((item) => item.done).length

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

  if (!state) return <div className="h-full flex items-center justify-center" style={{ color: primary }}><Loader2 className="animate-spin" /></div>

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
            <div className="flex items-center justify-between"><div><div className="text-xs" style={{ color: '#849aad' }}>{month} 本月支出</div><div className="text-3xl font-semibold mt-1" style={{ color: '#385f76' }}>¥{ledgerSummary.total.toFixed(2)}</div></div><CircleDollarSign size={34} style={{ color: '#56a58d', opacity: .65 }} /></div>
            <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ background: '#e6f0ef' }}><div className="h-full rounded-full" style={{ background: '#56a58d', width: `${state.ledger.monthlyBudget ? Math.min(100, ledgerSummary.total / state.ledger.monthlyBudget * 100) : 0}%` }} /></div>
            <div className="flex justify-between text-[11px] mt-1.5" style={{ color: '#849aad' }}><span>{monthEntries.length} 笔</span><span>{state.ledger.monthlyBudget ? `预算 ¥${state.ledger.monthlyBudget} · 剩余 ¥${(state.ledger.monthlyBudget - ledgerSummary.total).toFixed(2)}` : '尚未设置月预算'}</span></div>
            <div className="mt-4 space-y-2">{Object.entries(ledgerSummary.byCategory).sort((a, b) => b[1] - a[1]).map(([name, amount]) => <div key={name}><div className="flex justify-between text-xs mb-1" style={{ color: '#60788d' }}><span>{name}</span><span>¥{amount.toFixed(2)}</span></div><div className="h-1.5 rounded-full" style={{ background: '#edf2f4' }}><div className="h-full rounded-full" style={{ width: `${ledgerSummary.total ? amount / ledgerSummary.total * 100 : 0}%`, background: '#79b7a5' }} /></div></div>)}</div>
          </Panel>
          <Panel>
            <div className="text-sm font-semibold mb-3" style={{ color: '#46657c' }}>记一笔</div>
            <form onSubmit={async (e) => { e.preventDefault(); if (await action(() => addCareLedgerEntry(expense))) setExpense({ amount: '', category: expense.category, note: '' }) }} className="space-y-2">
              <div className="flex gap-2"><input required inputMode="decimal" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} placeholder="金额" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} /><select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })} className="rounded-xl px-2 text-sm outline-none" style={{ background: '#f5f8fa', color: '#536d80' }}>{['餐饮', '交通', '购物', '学习', '娱乐', '居住', '医疗', '其他'].map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="flex gap-2"><input value={expense.note} onChange={(e) => setExpense({ ...expense, note: e.target.value })} placeholder="备注（可不填）" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} /><button className="rounded-xl px-4 text-white" style={{ background: '#56a58d' }}><Plus size={16} /></button></div>
            </form>
          </Panel>
          <Panel><div className="text-sm font-semibold mb-2" style={{ color: '#46657c' }}>最近记录</div>{[...monthEntries].reverse().map((entry) => <div key={entry.id} className="flex items-center gap-2 py-2 border-b last:border-0" style={{ borderColor: '#edf2f5' }}><div className="flex-1 min-w-0"><div className="text-xs font-medium" style={{ color: '#526b7d' }}>{entry.category} · {entry.note || '无备注'}</div><div className="text-[10px]" style={{ color: '#9aabba' }}>{entry.date}</div></div><span className="text-sm" style={{ color: '#446b64' }}>¥{entry.amount.toFixed(2)}</span><button onClick={() => action(() => deleteCareLedgerEntry(entry.id))} style={{ color: '#b6c1c9' }}><Trash2 size={13} /></button></div>)}</Panel>
        </div>}

        {tab === 'study' && <div className="space-y-3">
          <Panel><div className="flex justify-between items-end"><div><div className="text-xs" style={{ color: '#849aad' }}>目标完成度</div><div className="text-3xl font-semibold mt-1" style={{ color: '#8f655c' }}>{doneCount}<span className="text-base"> / {goals.length}</span></div></div><BookOpenCheck size={34} style={{ color: '#e18a72', opacity: .7 }} /></div><div className="mt-4 h-2 rounded-full" style={{ background: '#f4e9e5' }}><div className="h-full rounded-full" style={{ background: '#e18a72', width: `${goals.length ? doneCount / goals.length * 100 : 0}%` }} /></div></Panel>
          <Panel><form onSubmit={async (e) => { e.preventDefault(); if (await action(() => addCareStudyGoal(goal))) setGoal({ title: '', targetDate: '' }) }} className="space-y-2"><input required value={goal.title} onChange={(e) => setGoal({ ...goal, title: e.target.value })} placeholder="预设一个学习目标" className="w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f5f8fa' }} /><div className="flex gap-2"><input type="date" value={goal.targetDate} onChange={(e) => setGoal({ ...goal, targetDate: e.target.value })} className="flex-1 rounded-xl px-3 py-2 text-xs outline-none" style={{ background: '#f5f8fa', color: '#667e91' }} /><button className="rounded-xl px-4 text-white text-xs" style={{ background: '#e18a72' }}>添加目标</button></div></form></Panel>
          <Panel>{goals.length === 0 ? <div className="text-center text-xs py-5" style={{ color: '#91a5b8' }}>还没有学习目标</div> : goals.map((item) => <div key={item.id} className="flex items-center gap-3 py-2.5 border-b last:border-0" style={{ borderColor: '#edf2f5' }}><button onClick={() => action(() => toggleCareStudyGoal(item.id, !item.done))} className="w-6 h-6 rounded-full border flex items-center justify-center shrink-0" style={{ background: item.done ? '#e18a72' : 'transparent', borderColor: item.done ? '#e18a72' : '#c8d4dc', color: 'white' }}>{item.done && <Check size={14} />}</button><div className="flex-1 min-w-0"><div className="text-sm" style={{ color: item.done ? '#9eabb5' : '#526b7d', textDecoration: item.done ? 'line-through' : 'none' }}>{item.title}</div>{item.targetDate && <div className="text-[10px]" style={{ color: '#a1afb9' }}>截止 {item.targetDate}</div>}</div><button onClick={() => action(() => deleteCareStudyGoal(item.id))} style={{ color: '#b6c1c9' }}><Trash2 size={13} /></button></div>)}</Panel>
        </div>}

        {tab === 'settings' && draftRoles && <div className="space-y-3">
          {ROLE_IDS.map((id) => {
            const meta = ROLES[id], config = draftRoles[id]
            const choices = [{ id: '', label: '跟随当前默认模型' }, ...(modelOptions[config.runtime] || [])]
            if (config.model && !choices.some((item) => item.id === config.model)) choices.push({ id: config.model, label: `${config.model}（当前设置）` })
            return <Panel key={id}><div className="flex items-center gap-2 mb-3"><span>{meta.emoji}</span><div className="flex-1"><div className="text-sm font-semibold" style={{ color: meta.color }}>{meta.name}</div><div className="text-[10px]" style={{ color: '#91a5b8' }}>{meta.desc}</div></div><button onClick={() => setDraftRoles({ ...draftRoles, [id]: { ...config, enabled: !config.enabled } })} className="w-10 h-6 rounded-full p-0.5 transition-colors" style={{ background: config.enabled ? meta.color : '#ccd5dc' }}><div className="w-5 h-5 bg-white rounded-full transition-transform" style={{ transform: config.enabled ? 'translateX(16px)' : 'none' }} /></button></div><div className="grid grid-cols-2 gap-2"><label className="text-[10px]" style={{ color: '#8297a9' }}>推送时间<input type="time" value={config.time} onChange={(e) => setDraftRoles({ ...draftRoles, [id]: { ...config, time: e.target.value } })} className="block mt-1 w-full rounded-xl px-2 py-2 text-xs outline-none" style={{ background: '#f4f7f9', color: '#526b7d' }} /></label><label className="text-[10px]" style={{ color: '#8297a9' }}>运行方式<select value={config.runtime} onChange={(e) => { const runtime = e.target.value; setDraftRoles({ ...draftRoles, [id]: { ...config, runtime, model: '' } }) }} className="block mt-1 w-full rounded-xl px-2 py-2 text-xs outline-none" style={{ background: '#f4f7f9', color: '#526b7d' }}><option value="codex">Codex</option><option value="claude-code">Claude Code</option></select></label></div><label className="block text-[10px] mt-2" style={{ color: '#8297a9' }}>模型<select value={config.model} onChange={(e) => setDraftRoles({ ...draftRoles, [id]: { ...config, model: e.target.value } })} className="block mt-1 w-full rounded-xl px-2 py-2 text-xs outline-none" style={{ background: '#f4f7f9', color: '#526b7d' }}>{choices.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{config.lastError && <div className="text-[10px] mt-2" style={{ color: '#c46b6b' }}>上次错误：{config.lastError}</div>}</Panel>
          })}
          <Panel><label className="text-xs" style={{ color: '#6f8799' }}>每月预算<input inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0 表示不设置" className="block mt-2 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background: '#f4f7f9' }} /></label></Panel>
          <button onClick={() => action(() => updateCareHubConfig({ roles: draftRoles, monthlyBudget: Number(budget || 0) }))} className="w-full rounded-2xl py-3 text-sm font-semibold text-white" style={{ background: `linear-gradient(135deg, ${primary}, #8d7bc4)` }}>保存全部设置</button>
        </div>}
      </main>

      {tab === 'chat' && <form onSubmit={submitQuick} className="shrink-0 px-3 py-3 flex gap-2" style={{ background: 'rgba(255,255,255,.82)', borderTop: '1px solid rgba(120,160,210,.12)' }}><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="记账 午饭25元 / 目标… / 完成…" className="min-w-0 flex-1 rounded-2xl px-4 py-2.5 text-sm outline-none" style={{ background: '#f1f5f8', color: '#456176' }} /><button disabled={!input.trim() || sending} className="w-10 h-10 rounded-full flex items-center justify-center text-white disabled:opacity-40" style={{ background: primary }}>{sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}</button></form>}
    </div>
  )
}
