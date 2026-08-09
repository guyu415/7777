import { useCallback, useEffect, useRef, useState, useLayoutEffect } from 'react'
import { Menu, Cat, Search, Trash2, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import MessageList from './MessageList'
import MessageSearch from './MessageSearch'
import FallingParticles from './FallingParticles'
import MessageInput from './MessageInput'
import MemoryModal from './MemoryModal'
import RuntimeStatusBall from './RuntimeStatusBall'
import CarryOutPetModal from './CarryOutPetModal'
import VoiceCall from '../Voice/VoiceCall'
import GomokuBoard from './GomokuBoard'
import DiceDuel from './DiceDuel'
import SpicyMonopolyBoard from './SpicyMonopolyBoard'
import XinchaoPanel from './XinchaoPanel'
import FocusPomodoroSheet from '../Focus/FocusPomodoroSheet'
import FocusSession from '../Focus/FocusSession'
import DivinationRoom from '../Divination/DivinationRoom'
import { useChat } from '../../hooks/useChat'
import { useCodexChat } from '../../hooks/useCodexChat'
import { useScheduledMessages } from '../../hooks/useScheduledMessages'
import { useFocusRuntime } from '../../hooks/useFocusRuntime'
import { useStore, deleteMessageFromDB, getBlob } from '../../store'
import { putAsset } from '../../services/sync'
import { getXinchaoStatus, onXinchaoUpdate, getCodexMemoryFile, putCodexMemoryFile, uploadFileToCompanion } from '../../services/companion'

const SYNC_BASE = 'https://chat.xiaoman.xyz'
const FAV_LIST_KEY = 'user:xiaoman2.26:voice_fav_list'

function Signature({ text, color, shadow }) {
  const wrapRef = useRef(null)
  const firstRef = useRef(null)
  const [overflow, setOverflow] = useState(false)

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    const first = firstRef.current
    if (!wrap || !first) return
    const natural = first.scrollWidth - (overflow ? 32 : 0)
    setOverflow(natural > wrap.clientWidth + 1)
  }, [text])

  const unit = { display: 'inline-block', paddingRight: overflow ? 32 : 0 }

  return (
    <div ref={wrapRef} style={{ maxWidth: 160, overflow: 'hidden', whiteSpace: 'nowrap' }}>
      <span
        className={overflow ? 'marquee-scroll' : ''}
        style={{ fontSize: 12, color, textShadow: shadow, display: 'inline-block' }}
      >
        <span ref={firstRef} style={unit}>{text}</span>
        {overflow && <span style={unit}>{text}</span>}
      </span>
    </div>
  )
}

// The one shared chat window/app-shell for every provider — Claude Code
// (VPS), Codex (VPS), and plain API-key providers alike. There is no second
// page shell anywhere in the app for any of these: useChat()/useCodexChat()
// are both called unconditionally (Rules of Hooks) and this component just
// picks whichever one matches the current session's providerName, so a
// change made here reaches every provider at once — see each hook's own
// comment for what it owns independently (history/context/turn-state/model/
// stop/reset), which is exactly the "runtime adapter" boundary: everything
// below this point (header, message list, input, settings nav, voice,
// gomoku, mobile layout) is 100% shared UI, unaware of which provider is
// active except through the small `isVpsSession`/`isCodexSession` branches.
export default function ChatWindow({ theme }) {
  const cc = useChat()
  const codex = useCodexChat()
  const { fetchPendingMessages, updateActiveTime } = useScheduledMessages()
  // Scoped + shallow-compared selector: ChatWindow previously called useStore()
  // with no selector at all, which meant it (and its whole message-list JSX)
  // re-rendered on EVERY store change anywhere in the app — including every
  // streaming flush tick, since `messages` lives in this same store. Only
  // resubscribe when one of these specific fields actually changes.
  const {
    currentView, setCurrentView, apiKey, aiAvatar: globalAiAvatar, aiName: globalAiName,
    userAvatar: globalUserAvatar,
    deleteMessagesFrom, workerUrl, currentSessionId, sessions, providers, selectedProviderId,
    summaryToast, setSummaryToast,
  } = useStore(useShallow(s => ({
    currentView: s.currentView, setCurrentView: s.setCurrentView, apiKey: s.apiKey,
    aiAvatar: s.aiAvatar, aiName: s.aiName, userAvatar: s.userAvatar,
    deleteMessagesFrom: s.deleteMessagesFrom, workerUrl: s.workerUrl, currentSessionId: s.currentSessionId,
    sessions: s.sessions, providers: s.providers, selectedProviderId: s.selectedProviderId,
    summaryToast: s.summaryToast, setSummaryToast: s.setSummaryToast,
  })))

  const currentSession = sessions?.find(s => s.id === currentSessionId)
  const isVpsSession = currentSession?.providerName === 'claude-code-vps'
  const isCodexSession = currentSession?.providerName === 'codex-vps'
  const isFixedVpsSession = isVpsSession || isCodexSession
  // The one runtime-adapter switch this whole shared window is built around
  // — everything below reads send/stop/reset/history/status through this
  // single `active` reference instead of branching provider logic all over
  // the file. cc/codex above are BOTH always called (Rules of Hooks); only
  // one is ever actually used per render.
  const active = isCodexSession ? codex : cc
  const { messages, sendMessage, sendMessageBatch, loadHistory, isLoading, regenerate, regenerateRound, retryFailed, deleteMsg, editMessage, stopStreaming } = active

  const effectiveAiName = currentSession?.aiName ?? globalAiName
  const effectiveAiAvatar = currentSession?.aiAvatar ?? globalAiAvatar
  const effectiveUserAvatar = currentSession?.userAvatar ?? globalUserAvatar
  const effectiveSignature = currentSession?.signature ?? '在线'
  const effectiveWebSearch = currentSession?.webSearch ?? false

  const inputRef = useRef(null)
  const [menuMsg, setMenuMsg] = useState(null)
  const [selectedMessageIds, setSelectedMessageIds] = useState(() => new Set())
  const [replyTarget, setReplyTarget] = useState(null)
  const [memoryMsg, setMemoryMsg] = useState(null)
  const [editMsg, setEditMsg] = useState(null)
  const [editText, setEditText] = useState('')
  const [toast, setToast] = useState(null)
  const [showCall, setShowCall] = useState(false)
  const [showGomoku, setShowGomoku] = useState(false)
  const [showDice, setShowDice] = useState(false)
  const [showSpicy, setShowSpicy] = useState(false)
  const [showDivination, setShowDivination] = useState(false)
  const [showCarryOut, setShowCarryOut] = useState(false)
  // Focus (专注) — ONE real global task, server-authoritative (see
  // useFocusRuntime.js and channel-server.ts's own Focus section), entirely
  // separate from chat/session state — it can be started by any runtime
  // (CC/Codex's real tools, or this user's own manual start) and is visible
  // from any window. showFocusSheet is just "is the setup bottom-sheet
  // open"; the full-screen countdown's own visibility is driven by the
  // server's real active/justFinished state further down (see
  // focusSessionVisible), not by this flag, so an AI-started session (or
  // its completion card) shows up automatically — no click needed — and
  // survives a sheet close/reopen or a page reload.
  const [showFocusSheet, setShowFocusSheet] = useState(false)
  const focusRuntime = useFocusRuntime()
  const focusSessionVisible = !!focusRuntime.state?.active || !!focusRuntime.justFinished
  const [xinchaoState, setXinchaoState] = useState(null)

  useEffect(() => {
    setReplyTarget(null)
    setMenuMsg(null)
    setSelectedMessageIds(new Set())
  }, [currentSessionId])
  const [showXinchaoPanel, setShowXinchaoPanel] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const callAudioRef = useRef(null)
  const messageListRef = useRef(null)

  const selectedProvider = providers?.find(p => p.id === selectedProviderId)
  const effectiveApiKey = selectedProvider?.apiKey || apiKey

  // 心潮状态 — both fixed VPS sessions (Claude Code and Codex) have this
  // integration, each with its OWN real session/tone overlay on the xinchao
  // side (see channel-server.ts's XINCHAO_CC_SESSION_ID/
  // XINCHAO_CODEX_SESSION_ID) — never the same state, never CC's reading
  // relabeled as Codex's or vice versa. One-shot fetch to seed the tag
  // immediately (the WS may already have been open before this component
  // mounted, so it won't repeat its one-time push), then purely reactive
  // from there — no polling. Switching sessions re-fetches for the NEW
  // session's own runtime and the onXinchaoUpdate filter below only ever
  // applies an update matching that same runtime, so switching between a CC
  // and a Codex window can never show a stale/wrong-runtime tag.
  const xinchaoRuntime = isCodexSession ? 'codex' : 'claude-code'
  useEffect(() => {
    if (!isFixedVpsSession) { setXinchaoState(null); return }
    let cancelled = false
    getXinchaoStatus(xinchaoRuntime).then(s => { if (!cancelled && s?.available !== false) setXinchaoState(s) }).catch(() => {})
    const unsub = onXinchaoUpdate((state, r) => { if (r === xinchaoRuntime) setXinchaoState(state) })
    return () => { cancelled = true; unsub() }
  }, [isFixedVpsSession, xinchaoRuntime])

  const showToast = (msg = '✨ 已记住~') => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  const jumpToMessage = useCallback((index) => {
    setShowSearch(false)
    messageListRef.current?.scrollToIndex(index)
  }, [])

  useEffect(() => {
    loadHistory()
  }, [currentSessionId])

  useEffect(() => {
    if (!summaryToast) return
    showToast(summaryToast)
    setSummaryToast(null)
  }, [summaryToast])

  // Codex's stopped/error notices are one-shot toasts, never a lingering
  // header pill (see useCodexChat.js's `notice` — a fresh object every time,
  // so this fires once per real occurrence and is never replayed on refresh).
  useEffect(() => {
    if (!isCodexSession || !codex.notice) return
    showToast(codex.notice.message || (codex.notice.kind === 'stopped' ? '已停止' : '出错了'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCodexSession, codex.notice])

  useEffect(() => {
    const check = async () => {
      const hasNew = await fetchPendingMessages()
      if (hasNew) await loadHistory()
    }
    check()
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [fetchPendingMessages, loadHistory])

  // Auto-follow-to-bottom (only when the user is already near the bottom)
  // and initial/session-switch scroll positioning both now live inside
  // MessageList, next to the virtualizer that actually owns the scroll
  // container — see its own comments for why.

  // 草稿持久化已下沉进 MessageInput 自己（write-through localStorage，按
  // draftKey=会话 id 分键）——这里不再需要卸载时经 ref 抢救文字的旧方案。

  // 在用户点击的调用栈里解锁音频：iOS 对无手势的自动播放很苛刻。
  // 1) AudioContext 播一帧静音 → 之后通话中可用 WebAudio 自由播放
  // 2) 备用 <audio> 播静音 wav → WebAudio 不可用时的回退通道
  const SILENT_WAV = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='
  const handleStartCall = () => {
    updateActiveTime()
    const el = new Audio(SILENT_WAV)
    el.play().catch(() => {})
    let ctx = null
    try {
      const AC = window.AudioContext || window.webkitAudioContext
      ctx = new AC()
      ctx.resume().catch(() => {})
      const buf = ctx.createBuffer(1, 1, 22050)
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.connect(ctx.destination)
      src.start(0)
    } catch (e) {
      console.warn('[CALL] AudioContext 创建失败:', e.message)
    }
    callAudioRef.current = { el, ctx }
    setShowCall(true)
  }
  const handleCallClose = async () => {
    setShowCall(false)
    await loadHistory() // 把通话产生的消息刷进聊天列表
  }

  // Image + optional caption text as ONE send — MessageInput's own draft UI
  // (thumbnail + cancel, still-editable text field) is what stops picking an
  // image from firing a send by itself; this handler just forwards whatever
  // was staged. For Codex, sendMessage('image')'s extra.imageUrl combined
  // with a non-empty content string reaches codexSendUserTurn() as a single
  // real turn/start carrying both a text and an image UserInput — never two
  // separate sends. Claude Code's VPS session now uploads the image to
  // /upload/image and lets CC Read the file (see useChat.js sendMessage/
  // streamResponse) — used to hard-block here too, that block is stale now.
  const handleSendImage = async ({ imageData, imageType, imageUrl, text }) => {
    updateActiveTime()
    try {
      await sendMessage(text || '', 'image', { imageData, imageType, imageUrl })
      return true
    } catch (error) {
      showToast(`图片发送失败：${error.message}`)
      return false
    }
  }

  const handleSendFile = async ({ file, text }) => {
    updateActiveTime()
    try {
      const uploaded = await uploadFileToCompanion(file)
      await sendMessage(text || '', 'file', {
        filePath: uploaded.path,
        fileName: uploaded.name || file.name,
        fileSize: uploaded.size ?? file.size,
        fileType: uploaded.mimeType || file.type || 'application/octet-stream',
      })
      return true
    } catch (error) {
      showToast(`文件发送失败：${error.message}`)
      return false
    }
  }

  // Neither VPS session (Claude Code or Codex) can "un-say" a reply the way
  // re-issuing a stateless API call can — both are stateful, persistent
  // sessions. Button stays visible (so it's discoverable, not mysteriously
  // gone) but explains why instead of acting. useCallback with empty deps:
  // this gets passed down into memoized MessageList as onRegenerate/
  // onRegenerateRound, so it must keep the same reference across renders or
  // it defeats that memoization every time.
  const regenerateBlocked = useCallback(() => {
    alert('常驻会话暂不支持重新生成，可复制内容后重新发送。')
  }, [])

  // Also handed down into memoized MessageList (for its empty-state "去配置"
  // button) — same stability requirement as regenerateBlocked above.
  const goToGlobalSettings = useCallback(() => setCurrentView('globalSettings'), [setCurrentView])

  const handleEdit = async (msg) => {
    setMenuMsg(null)
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx === -1) return
    try {
      if (isCodexSession) {
        for (const m of messages.slice(idx)) await deleteMsg(m.id)
      } else {
        for (const m of messages.slice(idx)) await deleteMessageFromDB(m.id)
        deleteMessagesFrom(msg.id)
      }
      inputRef.current?.fill(msg.type === 'text' ? msg.content : '')
    } catch (error) {
      showToast(`编辑失败：${error.message}`)
    }
  }

  // AI text message: in-place content edit (not the user "撤回重发" flow above)
  const handleEditAI = (msg) => {
    setMenuMsg(null)
    setEditText(msg.content || '')
    setEditMsg(msg)
  }

  const handleSaveEditAI = async () => {
    if (!editMsg) return
    await editMessage(editMsg.id, editText)
    setEditMsg(null)
    showToast('已修改~')
  }

  const handleDelete = async (msg) => {
    setMenuMsg(null)
    try {
      await deleteMsg(msg.id)
    } catch (error) {
      showToast(`删除失败：${error.message}`)
    }
  }

  const toggleMessageSelection = useCallback((id) => {
    setSelectedMessageIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const startMultiSelect = useCallback((msg) => {
    setMenuMsg(null)
    setSelectedMessageIds(new Set([msg.id]))
  }, [])

  const cancelMultiSelect = useCallback(() => setSelectedMessageIds(new Set()), [])

  const handleDeleteSelected = useCallback(async () => {
    const ids = messages.filter((message) => selectedMessageIds.has(message.id)).map((message) => message.id)
    if (!ids.length) return
    if (!window.confirm(`确定删除选中的 ${ids.length} 条消息吗？`)) return
    let failed = 0
    for (const id of ids) {
      try { await deleteMsg(id) } catch { failed += 1 }
    }
    setSelectedMessageIds(new Set())
    showToast(failed ? `已删除 ${ids.length - failed} 条，${failed} 条失败` : `已删除 ${ids.length} 条消息`)
  }, [deleteMsg, messages, selectedMessageIds])

  const handleReply = (msg) => {
    const raw = msg.type === 'voice'
      ? (msg.voiceText || '语音消息')
      : msg.type === 'image'
        ? (msg.content || '图片')
        : msg.type === 'file'
          ? (msg.fileName || '文件')
          : (msg.content || '')
    const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 80)
    setReplyTarget({
      id: msg.id,
      label: msg.role === 'user' ? '我' : effectiveAiName,
      preview: preview || '消息',
    })
    setMenuMsg(null)
    setTimeout(() => inputRef.current?.focus?.(), 0)
  }

  const handleFavoriteVoice = async (msg) => {
    setMenuMsg(null)
    const password = localStorage.getItem('auth.password')
    if (!password) { showToast('请先登录'); return }
    // 兼容解析：裸 JSON 直接 parse；旧版 data URL 先 base64 解码再 parse；失败才空数组
    const parseFavList = (value) => {
      if (!value) return []
      const v = value.trim()
      if (v.startsWith('data:')) {
        try {
          const b64 = v.slice(v.indexOf(',') + 1)
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
          return JSON.parse(new TextDecoder().decode(bytes))
        } catch { return [] }
      }
      try { return JSON.parse(v) } catch { return [] }
    }
    try {
      const blob = await getBlob(msg.voiceBlobId)
      if (!blob) { showToast('音频不存在'); return }
      const favId = 'fav_' + Date.now()
      // 音频走 putAsset（二进制→data URL）
      await putAsset(password, `user:xiaoman2.26:voice_fav:${favId}`, blob)
      // list 裸 JSON 直接 POST，绝不走 putAsset
      const listRes = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=${encodeURIComponent(FAV_LIST_KEY)}`)
      const listJson = listRes.ok ? await listRes.json() : null
      const list = parseFavList(listJson?.value)
      list.push({ id: favId, text: msg.voiceText || '', duration: msg.duration || 0, ts: Date.now() })
      await fetch(`${SYNC_BASE}/sync/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, key: FAV_LIST_KEY, value: JSON.stringify(list) }),
      })
      // 回源确认：直接 fetch，不走任何内存缓存
      const confirmRes = await fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=${encodeURIComponent(FAV_LIST_KEY)}`)
      const confirmJson = confirmRes.ok ? await confirmRes.json() : null
      const confirmList = parseFavList(confirmJson?.value)
      if (confirmList.some(item => item.id === favId)) showToast('已收藏 ⭐')
      else showToast('收藏失败，请重试')
    } catch (e) {
      showToast('收藏失败：' + e.message)
    }
  }

  const saveCodexQuickMemory = async ({ subject, predicate, value }) => {
    const name = 'saved-messages.md'
    let existing = ''
    try {
      existing = (await getCodexMemoryFile(currentSessionId, name))?.content || ''
    } catch (error) {
      if (error?.status !== 404) throw error
    }
    const label = [subject, predicate].filter(Boolean).join(' · ')
    const line = `- ${label ? `**${label}**：` : ''}${value}`
    await putCodexMemoryFile(currentSessionId, name, [existing.trim(), line].filter(Boolean).join('\n'))
  }

  // Find the last assistant message id (the only one that gets a regenerate
  // button). Walks backward and stops at the first match — the last
  // assistant message is almost always within a step or two of the end, so
  // this is effectively O(1) in practice. `reduceRight` looks similar but
  // has no early exit: it unconditionally visits every element, which is a
  // real O(n) scan re-run on every ChatWindow render — costly at thousands
  // of messages, and ChatWindow re-renders often (every streaming tick).
  let lastAiId = null
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') { lastAiId = messages[i].id; break }
  }
  const effectiveOnRegenerate = isFixedVpsSession ? regenerateBlocked : regenerate
  const effectiveOnRegenerateRound = isFixedVpsSession ? regenerateBlocked : regenerateRound

  const primaryColor = theme?.primary || '#4aacf0'
  const primaryDarkColor = theme?.primaryDark || '#2196d3'

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 safe-top"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)',
          paddingBottom: 12,
          background: `linear-gradient(to bottom, ${primaryColor}1f, rgba(255,255,255,0.55))`,
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: `1px solid ${primaryColor}22`,
          flexShrink: 0,
          position: 'relative',
          zIndex: 10,
        }}>
        <div className="flex items-center gap-3 min-w-0">
          {/* 心潮 status pill moved here (below the session-list button) from
              the name row — on narrow screens it used to sit inline next to
              the name and get visually covered by the header's right-side
              button group (that row is explicitly z-indexed above), making
              it unclickable. Stacking it under a button that's already its
              own fixed-width column has no crowding to compete with. */}
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setCurrentView('sessions')}
              title="会话列表"
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200"
              style={{ background: `${primaryColor}18`, color: primaryColor }}
            >
              <Menu size={16} />
            </button>
            {xinchaoState?.toneLabel && (
              <button
                onClick={() => setShowXinchaoPanel(true)}
                title="心潮状态"
                style={{
                  fontSize: 10, color: primaryColor, background: `${primaryColor}12`,
                  border: `1px solid ${primaryColor}30`, borderRadius: 8,
                  padding: '1px 6px', lineHeight: 1.5, whiteSpace: 'nowrap',
                }}
              >
                {xinchaoState.toneLabel}
              </button>
            )}
          </div>
          <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-xl flex-shrink-0"
            style={{
              background: `${primaryColor}33`,
              border: '2px solid rgba(180,130,255,0.65)',
              boxShadow: '0 0 10px rgba(180,130,255,0.6), 0 2px 10px rgba(180,130,255,0.35)',
            }}>
            {effectiveAiAvatar
              ? <img src={effectiveAiAvatar} alt="" className="w-full h-full object-cover" />
              : '🌸'}
          </div>
          <div className="min-w-0">
            {/* Name — crystal usage orb — mood, fixed left-to-right order, all
                normal (non-absolute) flex children so they share one row and
                vertically center together for free. This row is entirely
                separate from the signature row below, so the signature is
                never affected by anything here.
                No overflow/ellipsis clipping on the name itself — that was
                cutting off its own text-shadow glow into a visible square
                block. The name has no background of its own; it's just
                colored text with a glow that's allowed to spread outward
                freely. */}
            <div className="flex items-center" style={{ maxWidth: '100%', minWidth: 0 }}>
              <div className="font-semibold text-sm" style={{
                color: primaryColor,
                textShadow: `0 0 8px ${primaryColor}cc, 0 0 18px ${primaryColor}80`,
              }}>
                {effectiveAiName || currentSession?.name || '新对话'}
              </div>
              {isFixedVpsSession && (
                <RuntimeStatusBall theme={theme} isLoading={isLoading} runtime={isCodexSession ? 'codex' : 'claude-code'} />
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Signature text={effectiveSignature || '在线'} color={primaryColor} shadow={`0 0 6px ${primaryColor}aa, 0 0 14px ${primaryColor}60`} />
              {effectiveWebSearch && (
                <span style={{
                  fontSize: 10, color: '#4aacf0', background: 'rgba(74,172,240,0.12)',
                  border: '1px solid rgba(74,172,240,0.3)', borderRadius: 8,
                  padding: '1px 6px', lineHeight: 1.5, flexShrink: 0,
                }}>🌐 已联网</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" style={{ position: 'relative', zIndex: 10 }}>
          <button
            onClick={() => setShowSearch(true)}
            title="搜索这个对话"
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `${primaryColor}18`, color: primaryColor }}
          >
            <Search size={15} />
          </button>
          <button
            onClick={() => setShowCarryOut(true)}
            title="把它抱走，变成桌宠"
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
            style={{ background: `${primaryColor}18`, color: primaryColor }}
          >
            <Cat size={16} />
          </button>
          <button
            onClick={() => setCurrentView('sessionSettings')}
            className="btn-whale flex items-center justify-center flex-shrink-0"
            style={{
              width: 56, height: 56, borderRadius: '50%',
              background: `${primaryColor}12`,
              border: '1.5px solid transparent',
              overflow: 'hidden',
            }}
          >
            <img src="/assets/whale.png" alt="设置" style={{ width: 70, height: 70, objectFit: 'contain', flexShrink: 0 }} />
          </button>
        </div>
      </div>

      {/* Wave divider */}
      <div style={{ height: 8, overflow: 'hidden', marginTop: -1, flexShrink: 0 }}>
        <svg viewBox="0 0 400 8" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4 L400,8 L0,8 Z"
            fill={`${theme?.primary || '#ff85b3'}20`} />
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4"
            fill="none" stroke="#FFE4A1" strokeWidth="1.5" />
        </svg>
      </div>

      {/* The Monopoly board lives inside the real chat rather than taking
          over the whole viewport: board above, original message history
          below, original composer untouched at the bottom. Dice requests
          therefore enter this same conversation and CC's replies remain
          visible while the board animation is running. */}
      <div className="flex-1 relative overflow-hidden flex flex-col min-h-0">
        {showSpicy && isVpsSession && (
          <SpicyMonopolyBoard
            theme={theme}
            isLoading={isLoading}
            onRequestRoll={() => {
              updateActiveTime()
              sendMessage('掷骰子', 'text').catch((e) => console.error('[SPICY] roll request failed:', e.message))
            }}
            onClose={() => setShowSpicy(false)}
          />
        )}

        <div className="flex-1 min-h-0 relative overflow-hidden">
          {/* Falling + stacking accessory particles — clipped to chat only. */}
          <FallingParticles />
          <MessageList
            ref={messageListRef}
            messages={messages}
            sessionId={currentSessionId}
            onLongPress={setMenuMsg}
            lastAiId={lastAiId}
            onRegenerate={effectiveOnRegenerate}
            onRegenerateRound={effectiveOnRegenerateRound}
            onRetry={retryFailed}
            isLoading={isLoading}
            userAvatar={effectiveUserAvatar}
            aiAvatar={effectiveAiAvatar}
            theme={theme}
            selectionMode={selectedMessageIds.size > 0}
            selectedIds={selectedMessageIds}
            onToggleSelect={toggleMessageSelection}
            emptyAiName={effectiveAiName}
            emptyHasApiKey={isCodexSession ? true : !!effectiveApiKey}
            onEmptyConfigureClick={goToGlobalSettings}
          />
        </div>
      </div>

      {/* Long-press message menu */}
      {menuMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)' }}
          onClick={() => setMenuMsg(null)}
        >
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.96)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
              minWidth: 160,
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* CC and Codex expose the same message actions. Their hooks own
                the runtime-specific persistence behind these shared buttons. */}
            <button
              onClick={() => handleReply(menuMsg)}
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
              style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
            >
              ↩️ 回复
            </button>
            {menuMsg.role === 'user' && menuMsg.type === 'text' && (
              <button
                onClick={() => handleEdit(menuMsg)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                ✏️ 编辑
              </button>
            )}
            {menuMsg.role === 'assistant' && menuMsg.type === 'text' && (
              <button
                onClick={() => handleEditAI(menuMsg)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                📝 修改文字
              </button>
            )}
            {menuMsg.type === 'text' && menuMsg.content && (
              <button
                onClick={() => {
                  navigator.clipboard.writeText(menuMsg.content)
                  setMenuMsg(null)
                  showToast('已复制~')
                }}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                📋 复制
              </button>
            )}
            {menuMsg.type === 'text' && menuMsg.content && (
              <button
                onClick={() => { setMenuMsg(null); setMemoryMsg(menuMsg) }}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                🧠 存入记忆
              </button>
            )}
            {/* Codex's own real voice bubbles (see useCodexChat.js's
                resolveCodexVoiceMsg) use the exact same IndexedDB blob store
                as Claude Code's — handleFavoriteVoice below already just
                reads message.voiceBlobId generically, so this works
                identically for either runtime with no Codex-specific code. */}
            {menuMsg.role === 'assistant' && menuMsg.type === 'voice' && (
              <button
                onClick={() => handleFavoriteVoice(menuMsg)}
                className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-yellow-50 transition-colors"
                style={{ color: '#8b5060', borderBottom: '1px solid rgba(255,182,209,0.25)' }}
              >
                ⭐ 收藏语音
              </button>
            )}
            <button
              onClick={() => handleDelete(menuMsg)}
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-red-50 transition-colors"
              style={{ color: '#e07070' }}
            >
              🗑️ 删除
            </button>
            <button
              onClick={() => startMultiSelect(menuMsg)}
              className="w-full flex items-center gap-3 px-5 py-3.5 text-sm hover:bg-pink-50 transition-colors"
              style={{ color: '#8b5060', borderTop: '1px solid rgba(255,182,209,0.25)' }}
            >
              ☑️ 多选删除
            </button>
          </div>
        </div>
      )}

      {selectedMessageIds.size > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-2 py-2" style={{ bottom: 'calc(var(--safe-bottom) + 78px)', zIndex: 45, background: 'rgba(255,255,255,.96)', boxShadow: '0 8px 30px rgba(70,45,60,.2)', border: `1px solid ${primaryColor}30`, backdropFilter: 'blur(16px)' }}>
          <button onClick={cancelMultiSelect} className="w-9 h-9 rounded-full grid place-items-center" style={{ color: '#8b7580', background: '#f5f0f2' }} aria-label="取消多选"><X size={17} /></button>
          <span className="px-2 text-sm font-medium" style={{ color: '#76525e', minWidth: 74, textAlign: 'center' }}>已选 {selectedMessageIds.size} 条</span>
          <button onClick={handleDeleteSelected} className="h-9 rounded-full px-4 flex items-center gap-1.5 text-sm text-white" style={{ background: '#df6f7b' }}><Trash2 size={15} />删除</button>
        </div>
      )}

      {/* AI message in-place edit modal */}
      {editMsg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-6"
          style={{ background: 'rgba(0,0,0,0.18)', backdropFilter: 'blur(2px)' }}
          onClick={() => setEditMsg(null)}
        >
          <div
            className="rounded-2xl overflow-hidden w-full"
            style={{
              maxWidth: 420,
              background: 'rgba(255,255,255,0.97)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="px-5 pt-4 pb-2 text-sm font-semibold" style={{ color: '#8b5060' }}>📝 修改文字</div>
            <div className="px-5">
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                rows={5}
                autoFocus
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{
                  background: 'rgba(255,255,255,0.9)',
                  border: '1px solid rgba(255,182,209,0.5)',
                  color: '#3a2a30', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3">
              <button
                onClick={() => setEditMsg(null)}
                className="px-4 py-2 rounded-full text-sm"
                style={{ color: '#8b8b8b', background: 'rgba(0,0,0,0.05)' }}
              >
                取消
              </button>
              <button
                onClick={handleSaveEditAI}
                className="px-4 py-2 rounded-full text-sm font-medium text-white"
                style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryDarkColor})` }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 输入区：聊天页不再显示底部导航栏，输入区独占底部并适配 safe-area。
          backdropFilter 会自成一个层叠上下文，必须显式给 position+z-index，
          否则会被消息区 zIndex:1 的定位元素盖住（"+"菜单弹层因此被压在消息区下面）。 */}
      <div
        className="flex-shrink-0 safe-bottom"
        style={{
          position: 'relative',
          zIndex: 5,
          background: `linear-gradient(to bottom, rgba(255,255,255,0.38), rgba(255,255,255,0.26))`,
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          borderTop: `1px solid ${primaryColor}18`,
        }}
      >
        {isCodexSession && codex.sendError && (
          <div className="px-4 pt-1.5 text-xs flex items-center gap-2" style={{ color: '#e07070' }}>
            <span>{codex.sendError}</span>
            <button
              onClick={codex.retryFailed}
              style={{ border: 'none', background: 'rgba(224,112,112,0.12)', color: '#c45f5f', borderRadius: 10, padding: '2px 8px', fontFamily: 'inherit' }}
            >重试</button>
          </div>
        )}
        <MessageInput
          ref={inputRef}
          onSend={(text) => {
            console.log('[PAW] onSend received, text:', JSON.stringify(text))
            updateActiveTime()
            sendMessage(text, 'text').catch(e => console.error('[PAW] sendMessage error:', e.message))
          }}
          onSendBatch={(contents) => {
            updateActiveTime()
            sendMessageBatch(contents).catch(e => console.error('[PAW] sendMessageBatch error:', e.message))
          }}
          onStartCall={handleStartCall}
          onSendImage={handleSendImage}
          onSendFile={isFixedVpsSession ? handleSendFile : undefined}
          replyDraft={replyTarget}
          onCancelReply={() => setReplyTarget(null)}
          onOpenGomoku={() => setShowGomoku(true)}
          onOpenDice={() => setShowDice(true)}
          onOpenSpicy={() => setShowSpicy(true)}
          spicyEnabled={isVpsSession}
          gomokuEnabled={isFixedVpsSession}
          onOpenFocus={() => setShowFocusSheet(true)}
          onOpenDivination={() => setShowDivination(true)}
          disabled={isLoading}
          theme={theme}
          isLoading={isLoading}
          onStop={stopStreaming}
          draftKey={currentSessionId}
        />
      </div>

      {/* Memory modal */}
      {memoryMsg && (
        <MemoryModal
          message={memoryMsg}
          endpoint={workerUrl}
          onSave={isCodexSession ? saveCodexQuickMemory : undefined}
          onClose={() => setMemoryMsg(null)}
          onSuccess={showToast}
        />
      )}

      {/* Success toast */}
      {toast && (
        <div
          className="fixed z-50 left-1/2 -translate-x-1/2 animate-fade-up"
          style={{
            bottom: 100,
            background: 'rgba(255,255,255,0.92)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            padding: '8px 22px',
            borderRadius: 20,
            boxShadow: '0 4px 20px rgba(255,133,179,0.3)',
            color: '#8b5060',
            fontSize: 14,
            fontWeight: 500,
            border: '1px solid rgba(255,182,209,0.3)',
            whiteSpace: 'nowrap',
          }}
        >
          {toast}
        </div>
      )}

      {/* Voice call overlay */}
      {showCall && (
        <VoiceCall theme={theme} audioKit={callAudioRef.current} onClose={handleCallClose} />
      )}

      {/* Gomoku — a standalone full-screen game view (fixed inset-0, own
          board/opponent/turn/restart/quit UI, never rendered inside
          MessageList or as chat bubbles), not a route change: closing it
          just returns to this same chat, and the persisted game (if
          unfinished) is exactly where it was left next time it's opened.
          `runtime` picks which opponent/board/thread this game talks to —
          Claude Code and Codex have fully independent games (own board,
          moves, chat log, wait-state); the UI/board component itself is the
          exact same one either way, unchanged. */}
      {showGomoku && (
        <GomokuBoard
          theme={theme}
          runtime={isCodexSession ? 'codex' : 'claude-code'}
          aiName={effectiveAiName}
          aiAvatar={effectiveAiAvatar}
          userAvatar={effectiveUserAvatar}
          onClose={() => setShowGomoku(false)}
        />
      )}

      {showDice && (
        <DiceDuel
          theme={theme}
          runtime={isCodexSession ? 'codex' : 'claude-code'}
          aiName={effectiveAiName}
          aiAvatar={effectiveAiAvatar}
          userAvatar={effectiveUserAvatar}
          onClose={() => setShowDice(false)}
        />
      )}

      {showXinchaoPanel && (
        <XinchaoPanel theme={theme} state={xinchaoState} onClose={() => setShowXinchaoPanel(false)} />
      )}

      {showSearch && (
        <MessageSearch theme={theme} messages={messages} onSelect={jumpToMessage} onClose={() => setShowSearch(false)} />
      )}

      {showDivination && (
        <DivinationRoom
          theme={theme}
          onClose={() => setShowDivination(false)}
          onInterpret={(prompt) => {
            setShowDivination(false)
            updateActiveTime()
            sendMessage(prompt, 'text').catch((e) => console.error('[DIVINATION] send failed:', e.message))
          }}
        />
      )}

      {/* Focus (专注) — setup sheet and full-screen countdown are two
          independent overlays, same "standalone takeover, not a route
          change" pattern as GomokuBoard/VoiceCall above. The sheet only
          decides whether the setup form is open; once a session actually
          starts (by the user here, or for real by CC/Codex calling their
          own start_focus tool from anywhere), FocusSession's own visibility
          takes over (see focusSessionVisible above) and survives the sheet
          closing or a page reload. */}
      {showFocusSheet && (
        <FocusPomodoroSheet
          theme={theme}
          onClose={() => setShowFocusSheet(false)}
          onStart={async (opts) => {
            const result = await focusRuntime.startFocus(opts)
            if (result?.ok) setShowFocusSheet(false)
            return result
          }}
        />
      )}
      {focusSessionVisible && (
        <FocusSession
          theme={theme}
          aiName={effectiveAiName}
          aiAvatar={effectiveAiAvatar}
          focus={focusRuntime}
          onExit={() => setShowFocusSheet(false)}
        />
      )}

      {showCarryOut && currentSession && (
        <CarryOutPetModal theme={theme} session={currentSession} onClose={() => setShowCarryOut(false)} />
      )}
    </div>
  )
}
