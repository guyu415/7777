import { useState } from 'react'
import { X } from 'lucide-react'
import { useStore } from '../../store'
import { createGroupChat } from '../../services/companion'
import { listInvitableMembers } from '../../utils/groupMembers'

// Member picker — reads every real existing conversation window (the two
// VPS runtimes plus any other regular API-configured single-chat session),
// never a hardcoded 2-runtime limit. Each candidate carries its own real
// spec (see groupMembers.js's memberSpecForSession) so the backend can
// invoke it for real — vps runtimes via the existing resident processes,
// api sessions via the browser's own streamChat using that session's own
// live model/API config (never duplicated here).
export default function GroupChatCreateModal({ theme, onClose, onCreated }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const sessions = useStore((s) => s.sessions)
  const candidates = listInvitableMembers(sessions)
  const [selected, setSelected] = useState([])
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const toggle = (id) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((r) => r !== id)
      if (prev.length >= 4) return prev
      return [...prev, id]
    })
  }

  const handleCreate = async () => {
    if (selected.length < 2 || creating) return
    setCreating(true)
    setError(null)
    try {
      const specs = candidates.filter((c) => selected.includes(c.id)).map((c) => c.spec)
      const result = await createGroupChat(name.trim(), specs)
      if (!result?.ok) { setError(result?.reason === 'need_2_to_4_members' ? '请选择 2-4 位成员' : '创建失败，请重试'); return }
      onCreated(result.chat)
    } catch (e) {
      setError(e.message || '创建失败，请重试')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 60, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 360,
          background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(20px)',
          borderRadius: 24, padding: 20,
          border: `1px solid ${primary}30`, boxShadow: `0 12px 40px ${primary}25`,
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="font-semibold text-sm" style={{ color: '#2c5282' }}>创建群聊</span>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: `${primary}18`, color: primary, border: 'none' }}>
            <X size={14} />
          </button>
        </div>

        <label className="text-xs pl-1 mb-1 block" style={{ color: '#7a9cc0' }}>群聊名称（可选）</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="不填则自动用成员名字命名"
          maxLength={40}
          style={{
            width: '100%', marginBottom: 14, padding: '9px 12px', borderRadius: 12,
            background: 'rgba(255,255,255,0.7)', border: `1px solid ${primary}30`,
            color: '#2c5282', fontSize: 13, outline: 'none', fontFamily: 'inherit',
          }}
        />

        <label className="text-xs pl-1 mb-2 block" style={{ color: '#7a9cc0' }}>选择成员（2-4 位）</label>
        <div className="flex flex-col gap-2 mb-4">
          {candidates.map((c) => {
            const active = selected.includes(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggle(c.id)}
                className="flex items-center gap-3 px-3 py-2 rounded-2xl text-left"
                style={{
                  background: active ? `linear-gradient(135deg, ${primary}20, ${primaryDark}12)` : 'rgba(255,255,255,0.55)',
                  border: active ? `1.5px solid ${primary}55` : '1.5px solid rgba(200,220,255,0.3)',
                }}
              >
                <div className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-base flex-shrink-0" style={{ background: `${primary}18` }}>
                  {c.avatar ? <img src={c.avatar} alt="" className="w-full h-full object-cover" /> : '🌸'}
                </div>
                <span className="text-sm font-medium flex-1" style={{ color: '#2c5282' }}>{c.name}</span>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                  border: active ? 'none' : `1.5px solid ${primary}50`,
                  background: active ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11,
                }}>
                  {active ? '✓' : ''}
                </div>
              </button>
            )
          })}
        </div>

        {error && <p className="text-xs mb-2" style={{ color: '#e07070' }}>{error}</p>}

        <button
          onClick={handleCreate}
          disabled={selected.length < 2 || creating}
          className="w-full py-2.5 rounded-full text-sm font-medium text-white"
          style={{
            background: selected.length < 2 || creating ? 'rgba(200,220,255,0.5)' : `linear-gradient(135deg, ${primary}, ${primaryDark})`,
            border: 'none',
            opacity: selected.length < 2 || creating ? 0.7 : 1,
          }}
        >
          {creating ? '创建中…' : `创建群聊${selected.length ? `（${selected.length} 位成员）` : ''}`}
        </button>
      </div>
    </div>
  )
}
