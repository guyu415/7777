import { useState, useEffect, useCallback } from 'react'
import { listMemories, deleteMemory, updateMemory, g1Remember } from '../services/memory'

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,182,209,0.35)',
  borderRadius: 12,
  padding: '8px 12px',
  fontSize: 13,
  color: '#8b5060',
  outline: 'none',
  fontFamily: 'inherit',
}

function MemoryEditModal({ memory, onSave, onClose }) {
  const [subject, setSubject] = useState(memory?.subject || '')
  const [predicate, setPredicate] = useState(memory?.predicate || '')
  const [value, setValue] = useState(memory?.value || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    try {
      await onSave({ subject: subject.trim(), predicate: predicate.trim(), value: value.trim() })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 320,
          background: 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 20,
          padding: 18,
          border: '1px solid rgba(255,182,209,0.3)',
          boxShadow: '0 12px 40px rgba(255,133,179,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="font-semibold text-sm mb-3" style={{ color: '#8b5060' }}>
          {memory?.key ? '✏️ 编辑记忆' : '➕ 添加记忆'}
        </div>
        <div className="space-y-2">
          <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject（主体）" style={inputStyle} autoFocus />
          <input value={predicate} onChange={e => setPredicate(e.target.value)} placeholder="Predicate（关系）" style={inputStyle} />
          <textarea value={value} onChange={e => setValue(e.target.value)} placeholder="Value（内容）" rows={3} style={{ ...inputStyle, resize: 'none', lineHeight: 1.5 }} />
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-full text-sm font-medium"
            style={{ background: 'rgba(255,182,209,0.2)', color: '#c47a8a', border: '1px solid rgba(255,182,209,0.3)' }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !value.trim()}
            className="flex-1 py-2 rounded-full text-sm font-medium text-white"
            style={{
              background: saving || !value.trim() ? 'rgba(255,182,209,0.4)' : 'linear-gradient(135deg, #ff85b3, #ff6b9d)',
              boxShadow: saving || !value.trim() ? 'none' : '0 4px 12px rgba(255,133,179,0.4)',
              cursor: saving || !value.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? '保存中…' : '保存 ✨'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MemoryPanel({ workerUrl }) {
  const [memories, setMemories] = useState([])
  const [loading, setLoading] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    if (!workerUrl) return
    setLoading(true)
    try {
      const data = await listMemories(workerUrl)
      setMemories(Array.isArray(data) ? data : [])
    } catch {
      setMemories([])
    } finally {
      setLoading(false)
    }
  }, [workerUrl])

  useEffect(() => { load() }, [load])

  const handleDelete = async (key) => {
    if (!confirm('删除这条记忆？')) return
    try {
      await deleteMemory(workerUrl, key)
      setMemories(ms => ms.filter(m => m.key !== key))
    } catch {}
  }

  const handleSaveEdit = async (fields) => {
    await updateMemory(workerUrl, editTarget.key, fields)
    setEditTarget(null)
    await load()
  }

  const handleAdd = async (fields) => {
    await g1Remember(workerUrl, fields)
    setShowAdd(false)
    await load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs" style={{ color: '#d4a0b0' }}>
          {loading ? '加载中…' : `共 ${memories.length} 条`}
        </span>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1 rounded-full text-xs font-medium text-white"
          style={{ background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)', boxShadow: '0 2px 8px rgba(255,133,179,0.35)' }}
        >
          + 添加记忆
        </button>
      </div>

      <div className="space-y-2" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {memories.length === 0 && !loading && (
          <div className="text-center py-4 text-xs" style={{ color: '#d4a0b0' }}>暂无记忆</div>
        )}
        {memories.map(m => (
          <div
            key={m.key}
            className="flex items-start gap-2 rounded-xl px-3 py-2"
            style={{ background: 'rgba(255,255,255,0.55)', border: '1px solid rgba(255,182,209,0.2)' }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: '#8b5060' }}>
                {m.subject || '—'} · {m.predicate || '—'}
              </div>
              <div className="text-xs mt-0.5 break-words" style={{ color: '#c47a8a' }}>{m.value}</div>
            </div>
            <div className="flex gap-1 flex-shrink-0 mt-0.5">
              <button
                onClick={() => setEditTarget(m)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-sm transition-colors hover:bg-pink-50"
                title="编辑"
              >
                ✏️
              </button>
              <button
                onClick={() => handleDelete(m.key)}
                className="w-7 h-7 flex items-center justify-center rounded-full text-sm transition-colors hover:bg-red-50"
                title="删除"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>

      {(showAdd || editTarget) && (
        <MemoryEditModal
          memory={editTarget}
          onSave={editTarget ? handleSaveEdit : handleAdd}
          onClose={() => { setShowAdd(false); setEditTarget(null) }}
        />
      )}
    </div>
  )
}
