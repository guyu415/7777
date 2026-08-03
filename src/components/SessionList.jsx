import { useState, useEffect } from 'react'
import { Plus, Trash2, Edit3, Check, ChevronDown, Users } from 'lucide-react'
import { useStore, deleteMessagesForSession } from '../store'
import { deleteSessionMsgs } from '../services/sync'
import DiarySection from './DiarySection'
import { getAllLetters } from '../services/letters'
import { listGroupChats, onGroupUpdate } from '../services/companion'
import { resolveGroupMemberInfo } from '../utils/groupMembers'
import GroupChatCreateModal from './GroupChat/GroupChatCreateModal'

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

export default function SessionList({ theme, onSelectSession, onOpenGroupChat }) {
  const {
    sessions, currentSessionId, setCurrentSessionId,
    addSession, updateSession, deleteSession,
    setMessages,
    aiAvatar: globalAiAvatar,
  } = useStore()

  const [editingId, setEditingId] = useState(null)
  const [editName, setEditName] = useState('')
  const [diaryOpen, setDiaryOpen] = useState(false)
  const diaryTarget = useStore(s => s.diaryTarget)

  // Group chats — real, independent server-side sessions (see
  // channel-server.ts's Group chat section), never mixed into the plain
  // sessions[] list above. Fetched fresh on mount + kept live via the same
  // group_update broadcast GroupChatWindow itself subscribes to, so the
  // preview/updatedAt here stays current without polling.
  const [groupChats, setGroupChats] = useState([])
  const [showCreateGroup, setShowCreateGroup] = useState(false)

  useEffect(() => {
    let cancelled = false
    listGroupChats().then((chats) => { if (!cancelled) setGroupChats(chats) }).catch(() => {})
    const unsub = onGroupUpdate((chat) => {
      setGroupChats((prev) => {
        const idx = prev.findIndex((c) => c.id === chat.id)
        const entry = { id: chat.id, name: chat.name, members: chat.members, updatedAt: chat.updatedAt, lastMessage: chat.messages[chat.messages.length - 1]?.text ?? '' }
        if (idx === -1) return [entry, ...prev]
        const next = [...prev]
        next[idx] = entry
        return next
      })
    })
    return () => { cancelled = true; unsub() }
  }, [])

  // 从聊天里的信件卡片跳过来时（带 diaryTarget），自动展开日记面板定位到目标信
  useEffect(() => {
    if (diaryTarget) setDiaryOpen(true)
  }, [diaryTarget])

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const handleNew = () => {
    const id = genId()
    const curSess = sessions?.find(s => s.id === currentSessionId)
    addSession({
      id, name: '新对话',
      // 新会话不带任何预设提示词——用户明确填写才有
      systemPrompt: '',
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
    setEditName(session.aiName || session.name || '')
  }

  const saveEdit = (e, id) => {
    e.stopPropagation()
    if (editName.trim()) updateSession(id, { aiName: editName.trim() })
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
                      {session.aiName || session.name || '未命名对话'}
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

        {/* 群聊 — 独立于上面的单聊会话列表，真实的多 AI 群聊（见
            GroupChatWindow.jsx），从不与任何成员的单聊历史混在一起。 */}
        <div className="flex items-center justify-between mt-4 mb-2 px-1">
          <span className="text-xs font-medium" style={{ color: '#7a9cc0' }}>群聊</span>
          <button
            onClick={() => setShowCreateGroup(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium text-white"
            style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})` }}
          >
            <Plus size={11} /> 创建群聊
          </button>
        </div>
        {groupChats.length === 0 ? (
          <div className="text-xs px-1 pb-2" style={{ color: '#a0b8d0' }}>还没有群聊，创建一个试试～</div>
        ) : (
          <div className="space-y-2 mb-1">
            {groupChats.map((chat) => (
              <div
                key={chat.id}
                onClick={() => onOpenGroupChat?.(chat.id)}
                className="flex items-center gap-3 px-4 py-2.5 rounded-2xl cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.55)', border: '1.5px solid rgba(200,220,255,0.3)' }}
              >
                <div className="flex items-center flex-shrink-0" style={{ width: 36 }}>
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs" style={{ background: `${primary}20`, color: primary }}>
                    <Users size={13} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate" style={{ color: '#2c5282' }}>{chat.name}</div>
                  <div className="text-xs truncate mt-0.5" style={{ color: '#7a9cc0' }}>
                    {chat.lastMessage || chat.members.map((m) => resolveGroupMemberInfo(m, sessions).name).join(' / ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showCreateGroup && (
          <GroupChatCreateModal
            theme={theme}
            onClose={() => setShowCreateGroup(false)}
            onCreated={(chat) => {
              setShowCreateGroup(false)
              setGroupChats((prev) => [{ id: chat.id, name: chat.name, members: chat.members, updatedAt: chat.updatedAt, lastMessage: '' }, ...prev])
              onOpenGroupChat?.(chat.id)
            }}
          />
        )}

        {/* 日记：默认收起成一条紧凑入口，点击才展开成面板 */}
        <button
          onClick={() => setDiaryOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 mt-3 rounded-2xl text-sm font-medium transition-all"
          style={{
            background: 'rgba(255,255,255,0.5)',
            border: '1.5px solid rgba(180,150,220,0.3)',
            color: '#9a8ab0',
          }}
        >
          <span>📔 日记 · {getAllLetters().length} 封</span>
          <ChevronDown size={16} style={{ transform: diaryOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>

        {diaryOpen && (
          <div className="mt-2" style={{ height: '55vh' }}>
            <DiarySection theme={theme} />
          </div>
        )}
      </div>
    </div>
  )
}
