import { useEffect, useState } from 'react'
import { resolveGroupMemberInfo } from '../../../../utils/groupMembers'
import { resolveApiMemberConfig } from '../../../../utils/groupApiMember'
import { getMysteryCcModels, getCodexModelStatus } from '../../../../services/companion'

const DEFAULT_CC_MODEL = 'claude-sonnet-4-6'

// 斗地主和炸金花的开局面板长得完全一样：都是"你 + 正好两位群成员"的三人局，
// 只是最后建局时调用的引擎函数不同——抽成一份共用组件，避免同一套候选人/
// 模型解析逻辑（尤其是 claude-code/codex 的模型列表要单独走 VPS 接口，不能
// 走 api 成员那一套 resolveApiMemberConfig，和 MysteryGameRoom.jsx 的
// SetupPanel 是同一个道理）被复制两遍、改一处忘改另一处。
export default function PokerSetupPanel({ theme, chat, sessions, globals, ruleNote, onStart, requiredCount = 2, teamMode = false }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const [picked, setPicked] = useState([])
  const [models, setModels] = useState({})
  const [error, setError] = useState('')
  const [partnerId, setPartnerId] = useState('')
  const [ccModels, setCcModels] = useState([DEFAULT_CC_MODEL])
  const [codexModels, setCodexModels] = useState([])

  useEffect(() => {
    let cancelled = false
    getMysteryCcModels().then((list) => { if (!cancelled && list?.length) setCcModels(list) }).catch(() => {})
    getCodexModelStatus().then((data) => { if (!cancelled && data?.models?.length) setCodexModels(data.models) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const candidates = (chat?.members || []).map((id) => ({ id, ...resolveGroupMemberInfo(id, sessions) }))

  const defaultModelFor = (memberId) => {
    if (memberId === 'claude-code') return ccModels[0] || DEFAULT_CC_MODEL
    if (memberId === 'codex') return codexModels[0]?.id || ''
    const info = resolveGroupMemberInfo(memberId, sessions)
    const cfg = resolveApiMemberConfig(info.session, globals)
    return cfg.model || ''
  }
  const modelOptionsFor = (memberId) => {
    if (memberId === 'claude-code') return ccModels.map((id) => ({ id, label: id }))
    if (memberId === 'codex') return codexModels.map((m) => ({ id: m.id, label: m.displayName || m.id }))
    const info = resolveGroupMemberInfo(memberId, sessions)
    const cfg = resolveApiMemberConfig(info.session, globals)
    const provider = globals.providers?.find((p) => p.baseUrl === cfg.baseUrl)
    const list = provider?.models?.length ? provider.models : (cfg.model ? [cfg.model] : [])
    return list.map((id) => ({ id, label: id }))
  }

  const toggle = (id) => {
    setError('')
    setPicked((prev) => {
      if (prev.includes(id)) {
        if (partnerId === id) setPartnerId('')
        return prev.filter((x) => x !== id)
      }
      if (prev.length >= requiredCount) return prev
      setModels((m) => (m[id] ? m : { ...m, [id]: defaultModelFor(id) }))
      return [...prev, id]
    })
  }

  const start = () => {
    if (picked.length !== requiredCount) { setError(`需要正好选 ${requiredCount} 位群成员`); return }
    if (teamMode && !partnerId) { setError('请选择其中一位作为你的对家队友'); return }
    const aiSeats = picked.map((id) => {
      const info = resolveGroupMemberInfo(id, sessions)
      return { kind: 'ai', memberId: id, model: models[id] || defaultModelFor(id), name: info.name }
    })
    try {
      if (teamMode) {
        const partner = aiSeats.find((p) => p.memberId === partnerId)
        const opponents = aiSeats.filter((p) => p.memberId !== partnerId)
        // Seats alternate teams: user/opponent/partner/opponent.
        onStart([{ kind: 'user', name: '我' }, opponents[0], partner, opponents[1]])
      } else {
        onStart([{ kind: 'user', name: '我' }, ...aiSeats])
      }
    } catch (e) {
      setError(e.message || '开局失败')
    }
  }

  return (
    <main className="flex-1 overflow-y-auto px-4 py-4" style={{ minHeight: 0 }}>
      <div className="text-[11px] mb-3" style={{ color: '#a2798a' }}>{ruleNote}</div>
      {candidates.length < requiredCount && <div className="text-[11px] mb-2" style={{ color: '#c9647a' }}>这个群里的成员不够 {requiredCount} 位，先去邀请一下吧。</div>}
      {candidates.map((c) => {
        const active = picked.includes(c.id)
        return (
          <div key={c.id} className="mb-2 px-3 py-2.5 rounded-2xl" style={{ background: active ? `${primary}14` : 'rgba(255,255,255,0.6)', border: active ? `1.5px solid ${primary}` : '1px solid rgba(0,0,0,0.06)' }}>
            <button onClick={() => toggle(c.id)} className="w-full text-left flex items-center justify-between" style={{ background: 'none', border: 'none' }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#5a3548' }}>{c.name}</span>
              <span className="text-[10.5px]" style={{ color: active ? primaryDark : '#a2798a' }}>{active ? '已选中' : '点击选择'}</span>
            </button>
            {active && (
              <>
              {teamMode && (
                <button onClick={() => setPartnerId(c.id)} style={{ width: '100%', marginTop: 6, border: `1px solid ${partnerId === c.id ? primary : `${primary}33`}`, borderRadius: 10, padding: '6px 8px', background: partnerId === c.id ? `${primary}18` : 'rgba(255,255,255,.65)', color: partnerId === c.id ? primaryDark : '#8d6878', fontSize: 11.5 }}>
                  {partnerId === c.id ? '✓ 我的对家队友' : '设为我的对家队友'}
                </button>
              )}
              <select
                value={models[c.id] || ''}
                onChange={(e) => setModels((m) => ({ ...m, [c.id]: e.target.value }))}
                style={{ width: '100%', marginTop: 6, background: 'rgba(255,255,255,0.8)', color: '#5a3548', border: `1px solid ${primary}33`, borderRadius: 10, padding: '6px 8px', fontSize: 11.5, fontFamily: 'inherit', outline: 'none' }}
              >
                {modelOptionsFor(c.id).length === 0 && <option value="">（暂时读不到模型列表）</option>}
                {modelOptionsFor(c.id).map((m) => <option key={m.id} value={m.id}>本局模型：{m.label}</option>)}
              </select>
              </>
            )}
          </div>
        )
      })}
      {error && <div className="text-[11px] my-2" style={{ color: '#c9647a' }}>{error}</div>}
      <button
        onClick={start}
        disabled={picked.length !== requiredCount || (teamMode && !partnerId)}
        className="w-full mt-3"
        style={{ border: 'none', borderRadius: 18, padding: 13, color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontFamily: 'inherit', fontWeight: 700, fontSize: 14.5, opacity: picked.length === requiredCount && (!teamMode || partnerId) ? 1 : 0.5, marginBottom: 20 }}
      >
        开始这一局
      </button>
    </main>
  )
}
