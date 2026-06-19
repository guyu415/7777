import { useState } from 'react'
import { X, Plus, Trash2, Edit3, Check } from 'lucide-react'
import { useStore, deleteMessagesForSession } from '../store'

function relativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  const d = Math.floor(h / 24)
  return `${d}天前`
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export default function SessionSidebar({ open, onClose }) {
  const { sessions, currentSessionId, setCurrentSessionId, addSession, updateSession, deleteSession, systemPrompt, setMessages, selectedProviderId, selectedModelId } = useStore()
  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [editingPromptId, setEditingPromptId] = useState(null)
  const [editPrompt, setEditPrompt] = useState('')

  const handleNewSession = () => {
    const id = genId()
    addSession({ id, name: '新对话', systemPrompt: systemPrompt || '', createdAt: Date.now(), providerId: selectedProviderId, modelId: selectedModelId })
    setCurrentSessionId(id)
    setMessages([])
    onClose()
  }

  const handleSelect = (id) => {
    if (id === currentSessionId) { onClose(); return }
    setCurrentSessionId(id)
    setMessages([])
    onClose()
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('删除此对话及其所有消息？')) return
    await deleteMessagesForSession(id)
    deleteSession(id)
    if (id === currentSessionId) setMessages([])
  }

  const startEdit = (e, session) => {
    e.stopPropagation()
    setEditingId(session.id)
    setEditName(session.name)
  }

  const saveEdit = (e, id) => {
    e.stopPropagation()
    if (editName.trim()) updateSession(id, { name: editName.trim() })
    setEditingId(null)
  }

  const startEditPrompt = (e, session) => {
    e.stopPropagation()
    setEditingPromptId(session.id)
    setEditPrompt(session.systemPrompt || '')
  }

  const saveEditPrompt = (e, id) => {
    e.stopPropagation()
    updateSession(id, { systemPrompt: editPrompt })
    setEditingPromptId(null)
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40"
          style={{ background: 'rgba(0,0,0,0.18)' }}
          onClick={onClose}
        />
      )}
      <div
        className="fixed top-0 left-0 h-full z-50 flex flex-col"
        style={{
          width: 280,
          background: 'rgba(255,240,248,0.97)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRight: '1px solid rgba(255,182,209,0.3)',
          boxShadow: '4px 0 32px rgba(255,133,179,0.15)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div className="flex items-center justify-between px-4 py-4 safe-top" style={{ borderBottom: '1px solid rgba(255,182,209,0.2)' }}>
          <span className="font-semibold text-sm" style={{ color: '#8b5060' }}>会话列表</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewSession}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{ background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)', color: '#fff', boxShadow: '0 2px 8px rgba(255,133,179,0.4)' }}
            >
              <Plus size={15} />
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,182,209,0.2)', color: '#c47a8a' }}
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {(sessions || []).map(session => (
            <div key={session.id}>
              <div
                onClick={() => handleSelect(session.id)}
                className="mx-2 mb-1 rounded-xl px-3 py-2.5 cursor-pointer transition-all"
                style={{
                  background: session.id === currentSessionId
                    ? 'rgba(255,133,179,0.15)'
                    : 'transparent',
                  border: session.id === currentSessionId
                    ? '1px solid rgba(255,133,179,0.25)'
                    : '1px solid transparent',
                }}
              >
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    {editingId === session.id ? (
                      <input
                        autoFocus
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(e, session.id) }}
                        className="w-full text-sm font-medium rounded-lg px-2 py-0.5 outline-none"
                        style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,133,179,0.4)', color: '#8b5060' }}
                      />
                    ) : (
                      <div className="text-sm font-medium truncate" style={{ color: '#8b5060' }}>{session.name}</div>
                    )}
                    {session.lastMsgPreview && (
                      <div className="text-xs truncate mt-0.5" style={{ color: '#d4a0b0' }}>
                        {session.lastMsgPreview}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    {session.lastMsgTime && (
                      <span className="text-[10px]" style={{ color: '#d4a0b0' }}>{relativeTime(session.lastMsgTime)}</span>
                    )}
                    <div className="flex items-center gap-1">
                      {editingId === session.id ? (
                        <button onClick={e => saveEdit(e, session.id)} className="w-6 h-6 flex items-center justify-center rounded-full" style={{ color: '#ff6b9d' }}>
                          <Check size={12} />
                        </button>
                      ) : (
                        <button onClick={e => startEdit(e, session)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-pink-100 transition-colors" style={{ color: '#d4a0b0' }}>
                          <Edit3 size={11} />
                        </button>
                      )}
                      {(sessions || []).length > 1 && (
                        <button onClick={e => handleDelete(e, session.id)} className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-50 transition-colors" style={{ color: '#d4a0b0' }}>
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {editingPromptId === session.id ? (
                  <div onClick={e => e.stopPropagation()} className="mt-2">
                    <textarea
                      autoFocus
                      value={editPrompt}
                      onChange={e => setEditPrompt(e.target.value)}
                      rows={3}
                      className="w-full text-xs rounded-lg px-2 py-1.5 outline-none resize-none"
                      style={{ background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(255,133,179,0.4)', color: '#8b5060', lineHeight: 1.5 }}
                    />
                    <button
                      onClick={e => saveEditPrompt(e, session.id)}
                      className="mt-1 px-3 py-1 rounded-full text-xs font-medium text-white"
                      style={{ background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)' }}
                    >
                      保存提示词
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={e => startEditPrompt(e, session)}
                    className="mt-1 text-[10px] px-2 py-0.5 rounded-full transition-colors hover:bg-pink-50"
                    style={{ color: '#d4a0b0', border: '1px solid rgba(255,182,209,0.2)' }}
                  >
                    {session.systemPrompt ? '编辑提示词' : '+ 提示词'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
