import { useState } from 'react'
import { Plus, Trash2, Edit3, Check } from 'lucide-react'
import { useStore, deleteMessagesForSession } from '../store'
import { deleteSessionMsgs } from '../services/sync'
import DiarySection from './DiarySection'

function relativeTime(ts) {
  if (!ts) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  return `${Math.floor(h / 24)}天前`
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export default function SessionList({ theme, onSelectSession }) {
  const {
    sessions, currentSessionId, setCurrentSessionId,
    addSession, updateSession, deleteSession,
    systemPrompt, setMessages,
    aiAvatar: globalAiAvatar,
  } = useStore()

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const handleNew = () => {
    const id = genId()
    const curSess = sessions?.find(s => s.id === currentSessionId)
    addSession({
      id, name: '新对话',
      systemPrompt: curSess?.systemPrompt || systemPrompt || '',
      createdAt: Date.now(),
      apiKey: curSess?.apiKey || '',
      baseUrl: curSess?.baseUrl || '',
      providerName: curSess?.providerName || '',
      model: curSess?.model || '',
      ttsApiKey: curSess?.ttsApiKey || '',
      ttsGroupId: curSess?.ttsGroupId || '',
      ttsVoiceId: curSess?.ttsVoiceId || '',
    })
    setCurrentSessionId(id)
    setMessages([])
    onSelectSession?.()
  }

  const handleSelect = (id) => {
    if (id !== currentSessionId) {
      setCurrentSessionId(id)
      setMessages([])
    }
    onSelectSession?.()
  }

  const handleDelete = async (e, id) => {
    e.stopPropagation()
    if (!confirm('删除此对话及其所有消息？')) return
    const password = localStorage.getItem('auth.password')
    if (password) {
      try { await deleteSessionMsgs(password, id) } catch {}
    }
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

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)',
          paddingBottom: 12,
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(200,220,255,0.25)',
          boxShadow: '0 2px 12px rgba(74,172,240,0.08)',
        }}
      >
        <span className="font-semibold text-sm" style={{ color: '#2c5282' }}>会话列表</span>
        <button
          onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium text-white transition-all duration-200"
          style={{
            background: `linear-gradient(135deg, ${primary}, ${primaryDark})`,
            boxShadow: `0 2px 8px ${primary}50`,
          }}
        >
          <Plus size={13} />
          新对话
        </button>
      </div>

      {/* List + diary (whole area scrolls; diary has its own inner scroll) */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="space-y-2">
        {(sessions || []).map(session => {
          const active = session.id === currentSessionId
          return (
            <div
              key={session.id}
              onClick={() => handleSelect(session.id)}
              className="rounded-2xl px-4 py-3 cursor-pointer transition-all duration-200"
              style={{
                background: active
                  ? `linear-gradient(135deg, ${primary}18, ${primaryDark}10)`
                  : 'rgba(255,255,255,0.55)',
                border: active
                  ? `1.5px solid ${primary}40`
                  : '1.5px solid rgba(200,220,255,0.3)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                boxShadow: active
                  ? `0 4px 16px ${primary}20`
                  : '0 2px 8px rgba(74,172,240,0.06)',
              }}
            >
              <div className="flex items-start gap-3">
                {/* Session icon */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0 mt-0.5"
                  style={{
                    background: active ? `${primary}22` : 'rgba(200,220,255,0.3)',
                  }}
                >
                  {(session.aiAvatar || globalAiAvatar)
                    ? <img src={session.aiAvatar || globalAiAvatar} alt="" className="w-full h-full object-cover rounded-full" />
                    : '🌸'}
                </div>

                <div className="flex-1 min-w-0">
                  {editingId === session.id ? (
                    <input
                      autoFocus
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(e, session.id) }}
                      className="w-full text-sm font-medium rounded-lg px-2 py-0.5 outline-none"
                      style={{ background: 'rgba(255,255,255,0.9)', border: `1px solid ${primary}50`, color: '#2c5282' }}
                    />
                  ) : (
                    <div className="text-sm font-semibold truncate" style={{ color: active ? primaryDark : '#2c5282' }}>
                      {session.name}
                    </div>
                  )}

                  {session.lastMsgPreview && (
                    <div className="text-xs truncate mt-0.5" style={{ color: '#7a9cc0' }}>
                      {session.lastMsgPreview}
                    </div>
                  )}
                </div>

                <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                  {session.lastMsgTime && (
                    <span className="text-[10px]" style={{ color: '#a0b8d0' }}>{relativeTime(session.lastMsgTime)}</span>
                  )}
                  <div className="flex items-center gap-1">
                    {editingId === session.id ? (
                      <button
                        onClick={e => saveEdit(e, session.id)}
                        className="w-6 h-6 flex items-center justify-center rounded-full"
                        style={{ color: primaryDark }}
                      >
                        <Check size={12} />
                      </button>
                    ) : (
                      <button
                        onClick={e => startEdit(e, session)}
                        className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
                        style={{ color: '#a0b8d0' }}
                        onMouseEnter={e => e.currentTarget.style.background = `${primary}20`}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <Edit3 size={11} />
                      </button>
                    )}
                    {(sessions || []).length > 1 && (
                      <button
                        onClick={e => handleDelete(e, session.id)}
                        className="w-6 h-6 flex items-center justify-center rounded-full transition-colors"
                        style={{ color: '#a0b8d0' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,100,100,0.1)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {active && session.signature && (
                <div className="mt-2 text-xs pl-12" style={{ color: '#7a9cc0' }}>
                  {session.signature}
                </div>
              )}
            </div>
          )
        })}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-2 my-3">
          <div style={{ flex: 1, height: 1, background: 'rgba(180,150,220,0.3)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#9a8ab0' }}>📔 日记</span>
          <div style={{ flex: 1, height: 1, background: 'rgba(180,150,220,0.3)' }} />
        </div>

        {/* Diary section — fixed height, internal scroll */}
        <div style={{ height: '42vh' }}>
          <DiarySection theme={theme} />
        </div>
      </div>
    </div>
  )
}
