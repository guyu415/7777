import { useEffect, useRef, useState } from 'react'
import { Menu, RotateCcw, Send, Check, X as XIcon, Settings, Users, Image as ImageIcon, Sliders, Dices } from 'lucide-react'
import { useStore } from '../../store'
import { compressImage } from '../../utils/image'
import {
  getGroupChatState, sendGroupMessage, startGroupNewTopic, approveGroupCandidate, rejectGroupCandidate,
  submitGroupClientTurn, onGroupUpdate, clearGroupMessages, deleteGroupChat,
} from '../../services/companion'
import { resolveGroupMemberInfo, isVpsMemberId } from '../../utils/groupMembers'
import { fulfillApiMemberTurn } from '../../utils/groupApiMember'
import GroupMemberDrawer from './GroupMemberDrawer'
import GroupBackgroundDrawer from './GroupBackgroundDrawer'
import GroupSettingsDrawer from './GroupSettingsDrawer'
import GroupChatBackground from './GroupChatBackground'
import GameHubSheet from './games/GameHubSheet'
import MysteryGameRoom from './games/MysteryGameRoom'

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
// any session's or AI's avatar. Opened from the "群聊菜单" sheet or by
// tapping the user's own avatar next to their message.
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

// Small bottom action sheet — WeChat-style, never a top-popped panel — that
// fans out to the three group-chat-only settings entries. Each of its own
// destinations (member drawer / background drawer / avatar modal) is itself
// its own bottom sheet or compact modal; this sheet is just the launcher.
function GroupMenuSheet({ theme, onPickAvatar, onPickMembers, onPickBg, onPickGames, onPickSettings, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const rows = [
    { key: 'avatar', label: '我的头像', icon: <Settings size={16} />, onClick: onPickAvatar },
    { key: 'members', label: '群成员', icon: <Users size={16} />, onClick: onPickMembers },
    { key: 'bg', label: '聊天背景', icon: <ImageIcon size={16} />, onClick: onPickBg },
    // 小游戏总入口——以后加扑克等桌游都挂在这一个入口下（见 games/gameRegistry.js），
    // 不会再往这个菜单里堆新行。
    { key: 'games', label: '小游戏', icon: <Dices size={16} />, onClick: onPickGames },
    { key: 'settings', label: '群聊设置', icon: <Sliders size={16} />, onClick: onPickSettings },
  ]
  return (
    <div className="fixed inset-0 flex items-end" style={{ zIndex: 66, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{
          background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: `0 -8px 32px ${primary}30`,
          paddingTop: 8,
          paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        {rows.map((r) => (
          <button
            key={r.key}
            onClick={r.onClick}
            className="w-full flex items-center gap-3 px-5"
            style={{ padding: '13px 20px', color: '#5a3548', border: 'none', background: 'transparent', borderBottom: '1px solid rgba(0,0,0,0.04)' }}
          >
            <span style={{ color: primary }}>{r.icon}</span>
            <span className="text-sm">{r.label}</span>
          </button>
        ))}
        <button onClick={onClose} className="w-full text-center text-xs" style={{ padding: '12px 0 4px', color: '#b98a96', border: 'none', background: 'transparent' }}>
          取消
        </button>
      </div>
    </div>
  )
}

// A real, independently persisted session (never mixed into any member's
// own single-chat history — see channel-server.ts's Group chat section).
// All orchestration (free-speech quota, candidate approval, @ mention
// grants, round-robin bounding, member add/remove) lives server-side; this
// component only renders state and posts the user's own message/approval/
// membership actions. The one piece of REAL work this component does do is
// fulfilling an 'api'-kind member's pending client turn (see the effect
// below) — that member has no backend credentials, so the browser holding
// its session is the only place that can actually call its model.
export default function GroupChatWindow({ theme, chatId, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const sessions = useStore((s) => s.sessions)
  const workerUrl = useStore((s) => s.workerUrl)
  const useWorkerProxy = useStore((s) => s.useWorkerProxy)
  // Same 3-tier apiKey/baseUrl/model fallback the real single-chat send path
  // uses (see groupApiMember.js's resolveApiMemberConfig) — read here so an
  // 'api'-kind member configured at the provider/global level (not
  // per-session) still resolves correctly instead of looking like "no
  // config" forever.
  const providers = useStore((s) => s.providers)
  const selectedProviderId = useStore((s) => s.selectedProviderId)
  const globalApiKey = useStore((s) => s.apiKey)
  const globalApiBaseUrl = useStore((s) => s.apiBaseUrl)
  const globalModel = useStore((s) => s.model)
  // THIS group chat's own user avatar — keyed by chatId, never the global/
  // per-session userAvatar (see store's own comment for why). A group with
  // no entry here just falls back to the neutral 🐣 placeholder in
  // MemberAvatar, never an AI's avatar.
  const groupUserAvatars = useStore((s) => s.groupUserAvatars)
  const setGroupUserAvatar = useStore((s) => s.setGroupUserAvatar)
  const myAvatar = groupUserAvatars?.[chatId] || ''
  // THIS group chat's own background — keyed by chatId, independent of
  // single-chat/global chatBg and of every other group chat.
  const groupChatBg = useStore((s) => s.groupChatBg)
  const setGroupChatBg = useStore((s) => s.setGroupChatBg)
  const myBg = groupChatBg?.[chatId]
  const removeGroupUserAvatar = useStore((s) => s.removeGroupUserAvatar)
  const removeGroupChatBg = useStore((s) => s.removeGroupChatBg)

  const [chat, setChat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [text, setText] = useState('')
  const [mentionSel, setMentionSel] = useState([])
  const [sending, setSending] = useState(false)
  const [showAvatarModal, setShowAvatarModal] = useState(false)
  const [showMenuSheet, setShowMenuSheet] = useState(false)
  const [showMemberDrawer, setShowMemberDrawer] = useState(false)
  const [showBgDrawer, setShowBgDrawer] = useState(false)
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false)
  // 小游戏：'hub' 是游戏列表弹层，'mystery' 是剧本杀房间。房间自己从 store 里
  // 读这个群聊的存档（mysteryGames[chatId]），所以关掉再打开就是续玩。
  const [gameView, setGameView] = useState(null)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [mentionFeedback, setMentionFeedback] = useState('')
  const [startingTopic, setStartingTopic] = useState(false)
  const [topicStarted, setTopicStarted] = useState(false)
  // Per-pending-task, THIS-browser-only state ('thinking' while a real
  // streamChat call for an 'api' member is in flight; 'missing_config' /
  // 'error' when it couldn't even be attempted or genuinely failed — never
  // silently treated as "the AI stayed quiet", see groupApiMember.js's own
  // comment). Ephemeral — never persisted, doesn't need to be: it's purely
  // "is my own tab currently working on this," recomputed from scratch
  // every time this component mounts.
  const [clientTaskState, setClientTaskState] = useState({})
  const logRef = useRef(null)
  const dividerRef = useRef(null)
  const lastDividerIdRef = useRef(null)
  // Tracks pendingClientTurn ids currently in flight in THIS tab, so a
  // re-render (or a redundant group_update broadcast) never fires the same
  // real streamChat completion twice for the same turn.
  const fulfillingRef = useRef(new Set())
  // Tracks pendingClientTurn ids that already failed once in THIS tab —
  // never auto-retried; only the explicit "重试" button clears this.
  const failedRef = useRef(new Set())

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
    const messages = chat?.messages || []
    const lastDivider = [...messages].reverse().find((m) => m.kind === 'topic_divider')
    if (lastDivider && lastDivider.id !== lastDividerIdRef.current) {
      lastDividerIdRef.current = lastDivider.id
      // A brand-new topic divider just appeared — scroll to IT, not to the
      // bottom, so the user actually sees the "新话题" separator land.
      requestAnimationFrame(() => dividerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }))
      return
    }
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat?.messages?.length])

  // Attempts (or re-attempts, on manual retry) ONE 'api'-kind member's
  // pending turn in THIS tab — the group chat page itself is the executing
  // client, real single-chat window doesn't need to be open (see this
  // file's own top comment). A missing-config or genuinely failed attempt
  // is tracked locally and surfaced with a retry entry; it is NEVER
  // reported to the backend as 'pass' (that would wrongly look like the AI
  // chose to stay quiet, and would let the round move on as if this member
  // had a real turn) — see groupApiMember.js's own comment.
  const attemptFulfill = (p, session) => {
    fulfillingRef.current.add(p.id)
    setClientTaskState((prev) => ({ ...prev, [p.id]: { status: 'thinking' } }))
    fulfillApiMemberTurn(chatId, p.memberId, p, session, {
      providers, selectedProviderId, apiKey: globalApiKey, apiBaseUrl: globalApiBaseUrl, model: globalModel,
      workerUrl, useWorkerProxy,
    })
      .catch((e) => {
        failedRef.current.add(p.id)
        setClientTaskState((prev) => ({ ...prev, [p.id]: { status: e?.code === 'missing_config' ? 'missing_config' : 'error', message: e?.message || '调用失败' } }))
      })
      .finally(() => fulfillingRef.current.delete(p.id))
  }

  // Auto-claims any 'api'-kind member's pending turn belonging to THIS
  // group the moment it appears (on load, on reconnect, or mid-session) —
  // exactly once per task (gated by fulfillingRef + failedRef so neither a
  // re-render nor a redundant broadcast double-fires it).
  useEffect(() => {
    const pending = chat?.pendingClientTurns || []
    const stillPendingIds = new Set(pending.map((p) => p.id))
    setClientTaskState((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of Object.keys(next)) {
        if (!stillPendingIds.has(id)) { delete next[id]; changed = true }
      }
      return changed ? next : prev
    })
    for (const p of pending) {
      if (isVpsMemberId(p.memberId)) continue // never reached for vps members anyway
      if (fulfillingRef.current.has(p.id) || failedRef.current.has(p.id)) continue
      const info = resolveGroupMemberInfo(p.memberId, sessions)
      attemptFulfill(p, info.session)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.pendingClientTurns, sessions, chatId, workerUrl, useWorkerProxy, providers, selectedProviderId, globalApiKey, globalApiBaseUrl, globalModel])

  const handleRetryClientTask = (p) => {
    failedRef.current.delete(p.id)
    const info = resolveGroupMemberInfo(p.memberId, sessions)
    attemptFulfill(p, info.session)
  }

  const memberInfo = (id) => resolveGroupMemberInfo(id, sessions)

  const toggleMention = (id) => {
    setMentionSel((prev) => prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id])
  }

  const handleSend = async () => {
    const trimmed = text.trim()
    if (!trimmed || sending || !chat) return
    setSending(true)
    setError(null)
    const mentions = [...mentionSel]
    // The selected members' names go into the actual sent text (e.g.
    // "@Codex 该你了"), never just a side-channel id array — the user must
    // see exactly what was said, same as they typed it.
    const mentionPrefix = mentions.length ? mentions.map((id) => `@${memberInfo(id).name}`).join(' ') + ' ' : ''
    const finalText = mentionPrefix + trimmed
    setText('')
    setMentionSel([])
    try {
      const result = await sendGroupMessage(chatId, finalText, mentions)
      if (!result?.ok) {
        setError('发送失败，请重试')
      } else if (mentions.length) {
        const names = mentions.map((id) => memberInfo(id).name).join('、')
        setMentionFeedback(`已提醒 ${names} 发言`)
        setTimeout(() => setMentionFeedback(''), 1800)
      }
    } catch (e) {
      setError(e.message || '发送失败，请重试')
    } finally {
      setSending(false)
    }
  }

  const handleNewTopic = async () => {
    if (!chat || startingTopic) return
    if (!window.confirm('开始新话题？所有成员的发言额度会重置，待审批的候选会清空。')) return
    setStartingTopic(true)
    try {
      const result = await startGroupNewTopic(chatId)
      if (result?.ok) {
        setTopicStarted(true)
        setTimeout(() => setTopicStarted(false), 1600)
      }
    } catch {
      // no-op — a real failure just leaves the current topic in place
    } finally {
      setStartingTopic(false)
    }
  }

  const handleApprove = async (candidateId) => {
    try { await approveGroupCandidate(chatId, candidateId) } catch {}
  }
  const handleReject = async (candidateId) => {
    try { await rejectGroupCandidate(chatId, candidateId) } catch {}
  }
  const handleSkipPending = async (memberId) => {
    const p = chat?.pendingClientTurns?.find((t) => t.memberId === memberId)
    if (!p) return
    failedRef.current.delete(p.id)
    const scope = { requestId: p.id, turnId: p.id, channelType: p.channelType || 'group', conversationId: p.conversationId || '', groupId: chatId, topicId: p.topicId }
    try { await submitGroupClientTurn(chatId, memberId, scope, 'pass') } catch {}
  }

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const dataUrl = await readAvatarFile(file)
    setGroupUserAvatar(chatId, dataUrl)
  }
  const handleAvatarReset = () => setGroupUserAvatar(chatId, '')
  const handleBgUpload = (bg) => setGroupChatBg(chatId, bg)
  const handleBgReset = () => setGroupChatBg(chatId, null)

  // Wipes this group's own messages/candidates/mention grants/pending
  // client turns server-side and starts a blank new topic with quotas
  // reset — members/avatars/background/settings and every member's own
  // single-chat memory are all untouched (see channel-server.ts's
  // groupClearMessages, which has no access to single-chat data at all).
  const handleClearMessages = async () => {
    setSettingsBusy(true)
    try {
      const result = await clearGroupMessages(chatId)
      if (result?.ok) setChat(result.chat)
    } finally {
      setSettingsBusy(false)
    }
  }

  // Deletes THIS group entirely and returns to the group list — never
  // touches any member's own single-chat window/memory/avatar/API config,
  // which live in the frontend's `sessions` store and are never reached by
  // groupDeleteChat. Also cleans up this group's own client-side avatar/
  // background entries so nothing orphaned lingers for an id that no
  // longer exists.
  const handleDeleteGroup = async () => {
    setSettingsBusy(true)
    try {
      const result = await deleteGroupChat(chatId)
      if (result?.ok) {
        removeGroupUserAvatar(chatId)
        removeGroupChatBg(chatId)
        onClose()
      }
    } finally {
      setSettingsBusy(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: '#8b5060' }}>加载中…</div>
  }
  if (!chat) {
    return <div className="flex items-center justify-center h-full text-sm" style={{ color: '#e07070' }}>{error || '群聊不存在'}</div>
  }

  return (
    <div className="fixed inset-0" style={{ zIndex: 40 }}>
      <GroupChatBackground bg={myBg} />
      <div className="relative flex flex-col h-full" style={{ zIndex: 1 }}>
      {/* Header */}
      <div className="flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}>
        <div className="flex items-center justify-between px-3">
          <button onClick={onClose} className="flex items-center justify-center flex-shrink-0" style={{ width: 34, height: 34, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}>
            <Menu size={16} />
          </button>
          <span className="font-semibold text-sm truncate" style={{ color: '#8b5060', maxWidth: '45%' }}>{chat.name}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button onClick={() => setShowMenuSheet(true)} title="群聊菜单" className="flex items-center justify-center" style={{ width: 30, height: 30, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}>
              <Settings size={14} />
            </button>
            <button
              onClick={handleNewTopic}
              disabled={startingTopic}
              title="开始新话题"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs"
              style={{ background: topicStarted ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : `${primary}18`, border: 'none', color: topicStarted ? '#fff' : primary, opacity: startingTopic ? 0.6 : 1 }}
            >
              <RotateCcw size={12} /> {topicStarted ? '已开启' : startingTopic ? '开启中…' : '新话题'}
            </button>
          </div>
        </div>
        {/* Member bar — compact, horizontal, never overflows the viewport */}
        <div className="flex items-center gap-3 px-3 overflow-x-auto" style={{ paddingTop: 8, paddingBottom: 8 }}>
          {chat.members.map((id) => {
            const info = memberInfo(id)
            const credits = chat.freeRemaining[id] ?? 0
            const pending = chat.pendingClientTurns?.find((t) => t.memberId === id)
            const taskState = pending ? clientTaskState[pending.id] : null
            return (
              <div key={id} className="flex items-center gap-1.5 flex-shrink-0" style={{ color: primary }}>
                <MemberAvatar info={info} size={30} fallback="🌸" />
                <div className="flex flex-col">
                  <span className="text-xs font-semibold" style={{ color: '#2e1c26', lineHeight: 1.2 }}>{info.name}</span>
                  {pending ? (
                    taskState?.status === 'missing_config' || taskState?.status === 'error' ? (
                      <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: '#8a1f1f' }}>
                        {taskState.status === 'missing_config' ? 'API 配置缺失' : '调用失败'}
                        <button onClick={() => handleRetryClientTask(pending)} className="underline font-semibold" style={{ background: 'none', border: 'none', color: '#2e1c26', padding: 0, fontSize: 10 }}>重试</button>
                        <button onClick={() => handleSkipPending(id)} className="underline font-semibold" style={{ background: 'none', border: 'none', color: '#2e1c26', padding: 0, fontSize: 10 }}>跳过</button>
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium flex items-center gap-1" style={{ color: '#2e1c26' }}>
                        {taskState?.status === 'thinking' ? '思考中…' : '等待客户端响应…'}
                        <button onClick={() => handleSkipPending(id)} className="underline font-semibold" style={{ background: 'none', border: 'none', color: '#2e1c26', padding: 0, fontSize: 10 }}>跳过</button>
                      </span>
                    )
                  ) : (
                    <span className="text-[10px] font-medium" style={{ color: '#2e1c26' }}>剩余 {credits} 次自由发言</span>
                  )}
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
          if (m.kind === 'topic_divider') {
            const isLast = m.id === lastDividerIdRef.current
            return (
              <div key={m.id} ref={isLast ? dividerRef : undefined} className="flex items-center gap-2 my-3" style={{ padding: '0 8px' }}>
                <div className="flex-1" style={{ height: 1, background: `${primary}35` }} />
                <span className="text-[10.5px] flex-shrink-0" style={{ color: '#8b5060', fontWeight: 500 }}>{m.text}</span>
                <div className="flex-1" style={{ height: 1, background: `${primary}35` }} />
              </div>
            )
          }
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
            const info = memberInfo(c.memberId)
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
        {chat.members.map((id) => {
          const active = mentionSel.includes(id)
          const info = memberInfo(id)
          return (
            <button
              key={id}
              onClick={() => toggleMention(id)}
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

      {mentionFeedback && <div className="px-3 text-xs flex-shrink-0" style={{ color: primary, paddingBottom: 4 }}>✓ {mentionFeedback}</div>}
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
      {showMenuSheet && (
        <GroupMenuSheet
          theme={theme}
          onPickAvatar={() => { setShowMenuSheet(false); setShowAvatarModal(true) }}
          onPickMembers={() => { setShowMenuSheet(false); setShowMemberDrawer(true) }}
          onPickBg={() => { setShowMenuSheet(false); setShowBgDrawer(true) }}
          onPickGames={() => { setShowMenuSheet(false); setGameView('hub') }}
          onPickSettings={() => { setShowMenuSheet(false); setShowSettingsDrawer(true) }}
          onClose={() => setShowMenuSheet(false)}
        />
      )}
      {showMemberDrawer && (
        <GroupMemberDrawer
          theme={theme}
          chat={chat}
          onClose={() => setShowMemberDrawer(false)}
        />
      )}
      {showBgDrawer && (
        <GroupBackgroundDrawer
          theme={theme}
          bg={myBg}
          onUpload={handleBgUpload}
          onReset={handleBgReset}
          onClose={() => setShowBgDrawer(false)}
        />
      )}
      {showSettingsDrawer && (
        <GroupSettingsDrawer
          theme={theme}
          busy={settingsBusy}
          onClearMessages={handleClearMessages}
          onDeleteGroup={handleDeleteGroup}
          onClose={() => setShowSettingsDrawer(false)}
        />
      )}
      {gameView === 'hub' && (
        <GameHubSheet theme={theme} onPick={(id) => setGameView(id)} onClose={() => setGameView(null)} />
      )}
      {gameView === 'mystery' && (
        <MysteryGameRoom theme={theme} chatId={chatId} chat={chat} onClose={() => setGameView(null)} />
      )}
    </div>
  )
}
