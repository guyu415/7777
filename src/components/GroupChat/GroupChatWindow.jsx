import { useEffect, useRef, useState } from 'react'
import { Menu, RotateCcw, Send, Check, X as XIcon, Settings } from 'lucide-react'
import { useStore } from '../../store'
import { compressImage } from '../../utils/image'
import {
  getGroupChatState, sendGroupMessage, startGroupNewTopic, approveGroupCandidate, rejectGroupCandidate,
  onGroupUpdate,
} from '../../services/companion'
import { resolveGroupMemberInfo, GROUP_RUNTIME_LABEL } from '../../utils/groupMembers'

// fallback is context-specific ('🐣' for the user, '🌸' for an AI member —
// same neutral placeholders the rest of the app already uses, e.g.
// GomokuBoard.jsx) — never a shared '🤖' that reads as "the user's avatar
// looks like an AI's", which was the actual bug being fixed here.
function MemberAvatar({ info, size = 34, fallback = '🌸', onClick }) {
  return (
    <div
      onClick={onClick}
      className="rounded-full overflow-hidden flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, background: 'rgba(255,255,255,0.6)', border: '1.5px solid rgba(0,0,0,0.08)', cursor: onClick ? 'pointer' : 'default' }}
    >
      {info.avatar ? <img src={info.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: size * 0.5 }}>{fallback}</span>}
    </div>
  )
}

// Same compress-then-fallback-to-raw-dataURL logic SessionSettings.jsx's own
// avatar upload already uses — reused as-is rather than a new component.
async function readAvatarFile(file) {
  try {
    const { dataUrl } = await compressImage(file, { maxDim: 384, quality: 0.82 })
    return dataUrl
  } catch (err) {
    console.warn('[GROUP-AVATAR] 压缩失败，回退原图:', err.message)
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}

// Compact modal for THIS group chat's own user avatar only — never touches
// any session's or AI's avatar. Opened either from the header's settings
// button or by tapping the user's own avatar next to their message.
function GroupUserAvatarModal({ theme, avatar, onUpload, onReset, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const fileRef = useRef(null)
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 70, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 300, background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 22, padding: 20, border: `1px solid ${primary}30`, boxShadow: `0 12px 40px ${primary}25` }}
      >
        <div className="text-sm font-semibold mb-1" style={{ color: '#5a3548' }}>我的头像</div>
        <div className="text-[10.5px] mb-3" style={{ color: '#b98a96' }}>只用于这一个群聊，不影响单聊或其他群聊</div>
        <div className="flex items-center gap-3 mb-4">
          <div style={{ width: 56, height: 56, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: `${primary}18`, border: `2px solid ${primary}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>
            {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🐣'}
          </div>
          <div className="flex flex-col gap-2 flex-1">
            <button
              onClick={() => fileRef.current?.click()}
              style={{ padding: '7px 14px', borderRadius: 20, fontSize: 12.5, background: `${primary}18`, color: primaryDark, border: `1.5px solid ${primary}44` }}
            >
              📷 从相册上传
            </button>
            {avatar && (
              <button onClick={onReset} style={{ padding: '7px 14px', borderRadius: 20, fontSize: 12.5, background: 'rgba(0,0,0,0.05)', color: '#8b5060', border: 'none' }}>
                恢复默认
              </button>
            )}
          </div>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onUpload} />
        <button onClick={onClose} style={{ width: '100%', padding: '10px', borderRadius: 16, background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff', border: 'none', fontSize: 13.5, fontWeight: 500 }}>
          关闭
        </button>
      </div>
    </div>
  )
}

// A real, independently persisted session (never mixed into any member's
// own single-chat history — see channel-server.ts's Group chat section).
// All orchestration (free-speech quota, candidate approval, @ mention
// grants, round-robin bounding) lives server-side; this component only
// renders state and posts the user's own message/approval actions.
export default function GroupChatWindow({ theme, chatId, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const sessions = useStore((s) => s.sessions)
  // THIS group chat's own user avatar — keyed by chatId, never the global/
  // per-session userAvatar (see store's own comment for why). A group with
  // no entry here just falls back to the neutral 🐣 placeholder in
  // MemberAvatar, never an AI's avatar.
  const groupUserAvatars = useStore((s) => s.groupUserAvatars)
  const setGroupUserAvatar = useStore((s) => s.setGroupUserAvatar)
  const myAvatar = groupUserAvatars?.[chatId] || ''

  const [chat, setChat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [mentionSel, setMentionSel] = useState([])
  const [sending, setSending] = useState(false)
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const logRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getGroupChatState(chatId)
      .then((c) => { if (!cancelled) setChat(c) })
      .catch((e) => { if (!cancelled) setError(e.message || '加载群聊失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    const unsub = onGroupUpdate((c) => { if (c.id === chatId) setChat(c) })
    return () => { cancelled = true; unsub() }
  }, [chatId])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat?.messages?.length])

  const memberInfo = (runtime) => resolveGroupMemberInfo(runtime, sessions)

  const toggleMention = (runtime) => {
    setMentionSel((prev) => prev.includes(runtime) ? prev.filter((r) => r !== runtime) : [...prev, runtime])
  }

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || !chat) return
    setSending(true)
    setError(null)
    const mentions = [...mentionSel]
    setText('')
    setMentionSel([])
    try {
      const result = await sendGroupMessage(chatId, trimmed, mentions)
      if (!result?.ok) setError('发送失败，请重试')
    } catch (e) {
      setError(e.message || '发送失败，请重试')
    } finally {
      setSending(false)
    }
  }

  const handleNewTopic = async () => {
    if (!chat) return
    if (!window.confirm('开始新话题？所有成员的发言额度会重置，待审批的候选会清空。')) return
    try { await startGroupNewTopic(chatId) } catch {}
  }

  const handleApprove = async (candidateId) => {
    try { await approveGroupCandidate(chatId, candidateId) } catch {}
  }
  const handleReject = async (candidateId) => {
    try { await rejectGroupCandidate(chatId, candidateId) } catch {}
  }

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const dataUrl = await readAvatarFile(file)
    setGroupUserAvatar(chatId, dataUrl)
  }
  const handleAvatarReset = () => setGroupUserAvatar(chatId, '')

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: '#8b5060' }}>加载中…</div>
  }
  if (!chat) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: '#e07070' }}>{error || '群聊不存在'}</div>
  }

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 40, background: 'linear-gradient(165deg, #fce4ec 0%, #f8bbd0 30%, #ffeef5 70%, #fff0f6 100%)' }}>
      {/* Header */}
      <div className="flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
        <div className="flex items-center justify-between px-3">
          <button onClick={onClose} className="flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}>
            <Menu size={16} />
          </button>
          <span className="font-semibold text-sm truncate" style={{ color: '#8b5060', maxWidth: '45%' }}>{chat.name}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => setShowAvatarModal(true)} title="我的头像" className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}>
              <Settings size={14} />
            </button>
            <button onClick={handleNewTopic} title="开始新话题" className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs" style={{ background: `${primary}18`, border: 'none', color: primary }}>
              <RotateCcw size={12} /> 新话题
            </button>
          </div>
        </div>
        {/* Member bar — compact, horizontal, never overflows the viewport */}
        <div className="flex items-center gap-3 px-3 overflow-x-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
          {chat.members.map((runtime) => {
            const info = memberInfo(runtime)
            const credits = chat.freeRemaining[runtime] ?? 0
            return (
              <div key={runtime} className="flex items-center gap-1.5 flex-shrink-0" style={{ color: primary }}>
                <MemberAvatar info={info} size={30} fallback="🌸" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium" style={{ color: '#6a3f56', lineHeight: 1.2 }}>{info.name}</span>
                  <span className="text-[9px]" style={{ color: '#c48a9a' }}>剩余 {credits} 次自由发言</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Messages */}
      <div ref={logRef} className="flex-1 overflow-y-auto px-3" style={{ minHeight: 0 }}>
        {chat.messages.length === 0 && (
          <div className="text-center text-xs" style={{ color: '#c9a2ad', paddingTop: 20 }}>群聊已创建，说点什么开始吧～</div>
        )}
        {chat.messages.map((m) => {
          if (m.from === 'system') {
            return <div key={m.id} className="text-center text-[10.5px] my-2" style={{ color: '#c9a2ad' }}>{m.text}</div>
          }
          const isUser = m.from === 'user'
          // The user's own avatar is THIS group's own (myAvatar), never any
          // AI's avatar and never the app-wide global one — see this
          // component's own top comment for the bug this fixes.
          const info = isUser ? { name: '我', avatar: myAvatar } : memberInfo(m.from)
          return (
            <div key={m.id} className={`flex items-start gap-2 my-2 ${isUser ? 'flex-row-reverse' : ''}`}>
              <MemberAvatar
                info={info}
                size={30}
                fallback={isUser ? '🐣' : '🌸'}
                onClick={isUser ? () => setShowAvatarModal(true) : undefined}
              />
              <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`} style={{ maxWidth: '72%' }}>
                <span className="text-[10px] mb-0.5" style={{ color: '#a97d8a' }}>{info.name}</span>
                <div
                  className="px-3 py-2 rounded-2xl text-sm"
                  style={{
                    background: isUser ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.8)',
                    color: isUser ? '#fff' : '#5a3548',
                    border: isUser ? 'none' : `1px solid ${primary}22`,
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                >
                  {m.text}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Candidates awaiting approval — short direction only, never full content */}
      {chat.candidates.length > 0 && (
        <div className="flex-shrink-0 px-3" style={{ paddingBottom: 6 }}>
          {chat.candidates.map((c) => {
            const info = memberInfo(c.runtime)
            return (
              <div key={c.id} className="flex items-center gap-2 px-3 py-2 mb-1.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.7)', border: `1px dashed ${primary}45` }}>
                <MemberAvatar info={info} size={26} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: '#6a3f56' }}>
                    {info.name} 想说：{c.direction}
                  </div>
                  {c.status === 'approved' && <div className="text-[10px]" style={{ color: primary }}>已同意，正在展开发言…</div>}
                  {c.error && <div className="text-[10px]" style={{ color: '#e07070' }}>上次尝试失败：{c.error}</div>}
                </div>
                {c.status === 'pending' && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => handleApprove(c.id)} className="flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: '50%', background: primary, color: '#fff', border: 'none' }}>
                      <Check size={13} />
                    </button>
                    <button onClick={() => handleReject(c.id)} className="flex items-center justify-center" style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(0,0,0,0.08)', color: '#8b5060', border: 'none' }}>
                      <XIcon size={13} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* @ mention toggles — compact row above the input, never overflows */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 overflow-x-auto" style={{ paddingBottom: 4 }}>
        <span className="text-[10px] flex-shrink-0" style={{ color: '#b98a96' }}>@提及：</span>
        {chat.members.map((runtime) => {
          const active = mentionSel.includes(runtime)
          const info = memberInfo(runtime)
          return (
            <button
              key={runtime}
              onClick={() => toggleMention(runtime)}
              className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px]"
              style={{
                background: active ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.6)',
                color: active ? '#fff' : '#8b5060',
                border: active ? 'none' : `1px solid ${primary}30`,
              }}
            >
              @{info.name}
            </button>
          )
        })}
      </div>

      {error && <div className="px-3 text-xs flex-shrink-0" style={{ color: '#e07070', paddingBottom: 4 }}>{error}</div>}

      {/* Input */}
      <div className="flex items-center gap-2 px-3 flex-shrink-0" style={{ paddingBottom: 'max(10px, calc(env(safe-area-inset-bottom, 0px) + 6px))' }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
          placeholder="在群里说点什么…"
          disabled={sending}
          style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.7)', border: `1px solid ${primary}33`, borderRadius: 20, padding: '10px 14px', fontSize: 14, color: '#5a3548', outline: 'none', fontFamily: 'inherit' }}
        />
        <button
          onClick={handleSend}
          disabled={sending || !text.trim()}
          className="flex items-center justify-center flex-shrink-0"
          style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff', opacity: (sending || !text.trim()) ? 0.5 : 1 }}
        >
          <Send size={16} />
        </button>
      </div>

      {showAvatarModal && (
        <GroupUserAvatarModal
          theme={theme}
          avatar={myAvatar}
          onUpload={handleAvatarUpload}
          onReset={handleAvatarReset}
          onClose={() => setShowAvatarModal(false)}
        />
      )}
    </div>
  )
}
