import { useState } from 'react'
import { X, Plus, Minus } from 'lucide-react'
import { useStore } from '../../store'
import { inviteGroupMember, removeGroupMember } from '../../services/companion'
import { resolveGroupMemberInfo, listInvitableMembers } from '../../utils/groupMembers'

// WeChat-style bottom sheet (never a top-popped panel — see the request
// this was built for) for real, live member management: current members can
// be removed (never below 2), any other existing single-chat session (or
// the two VPS runtimes) can be invited (never above 4, never a duplicate of
// an already-joined session). All the real add/remove logic — quota carry,
// pending-turn cleanup, welcome-message suppression — lives entirely
// server-side in channel-server.ts; this component only renders state and
// posts the user's invite/remove actions.
export default function GroupMemberDrawer({ theme, chat, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const sessions = useStore((s) => s.sessions)
  const [tab, setTab] = useState('members') // 'members' | 'invite'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const memberInfo = (id) => resolveGroupMemberInfo(id, sessions)
  const invitable = listInvitableMembers(sessions).filter((c) => !chat.members.includes(c.id))

  const handleRemove = async (memberId) => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const result = await removeGroupMember(chat.id, memberId)
      if (!result?.ok) setError(result?.reason === 'min_2_members' ? '至少要保留 2 位 AI 成员' : '移除失败，请重试')
    } catch (e) {
      setError(e.message || '移除失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  const handleInvite = async (candidate) => {
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const result = await inviteGroupMember(chat.id, candidate.spec)
      if (!result?.ok) setError(result?.reason === 'max_4_members' ? '最多 4 位 AI 成员' : result?.reason === 'already_member' ? '这个成员已经在群里了' : '邀请失败，请重试')
      else setTab('members')
    } catch (e) {
      setError(e.message || '邀请失败，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-end" style={{ zIndex: 65, background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full flex flex-col"
        style={{
          maxHeight: '78vh', background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: `0 -8px 32px ${primary}30`,
          paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex items-center justify-between px-4" style={{ paddingTop: 14, paddingBottom: 10, flexShrink: 0 }}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTab('members')}
              className="text-sm font-semibold pb-1"
              style={{ color: tab === 'members' ? primaryDark : '#b98a96', borderBottom: tab === 'members' ? `2px solid ${primary}` : '2px solid transparent' }}
            >
              群成员（{chat.members.length}）
            </button>
            <button
              onClick={() => setTab('invite')}
              className="text-sm font-semibold pb-1"
              style={{ color: tab === 'invite' ? primaryDark : '#b98a96', borderBottom: tab === 'invite' ? `2px solid ${primary}` : '2px solid transparent' }}
            >
              邀请
            </button>
          </div>
          <button onClick={onClose} aria-label="关闭群成员管理" className="flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}>
            <X size={13} />
          </button>
        </div>

        {error && <div className="px-4 text-xs" style={{ color: '#e07070', paddingBottom: 8, flexShrink: 0 }}>{error}</div>}

        <div className="flex-1 overflow-y-auto px-4" style={{ minHeight: 0, paddingBottom: 10 }}>
          {tab === 'members' && chat.members.map((id) => {
            const info = memberInfo(id)
            return (
              <div key={id} className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: `${primary}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                  {info.avatar ? <img src={info.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸'}
                </div>
                <span className="text-sm flex-1 truncate" style={{ color: '#5a3548' }}>{info.name}</span>
                <button
                  onClick={() => handleRemove(id)}
                  disabled={busy}
                  aria-label={`移除${info.name}`}
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(224,112,112,0.12)', color: '#e07070', border: 'none', opacity: busy ? 0.5 : 1 }}
                >
                  <Minus size={13} />
                </button>
              </div>
            )
          })}
          {tab === 'members' && (
            <div className="text-[10.5px] text-center" style={{ color: '#c9a2ad', paddingTop: 10 }}>群聊需要保持 2-4 位 AI 成员</div>
          )}

          {tab === 'invite' && invitable.length === 0 && (
            <div className="text-center text-xs" style={{ color: '#c9a2ad', paddingTop: 20 }}>没有更多可邀请的对话了</div>
          )}
          {tab === 'invite' && invitable.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: `${primary}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                {c.avatar ? <img src={c.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸'}
              </div>
              <span className="text-sm flex-1 truncate" style={{ color: '#5a3548' }}>{c.name}</span>
              <button
                onClick={() => handleInvite(c)}
                disabled={busy || chat.members.length >= 4}
                aria-label={`邀请${c.name}`}
                className="flex items-center justify-center flex-shrink-0"
                style={{ width: 26, height: 26, borderRadius: '50%', background: `${primary}18`, color: primary, border: 'none', opacity: (busy || chat.members.length >= 4) ? 0.5 : 1 }}
              >
                <Plus size={13} />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
