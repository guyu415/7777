import { useCallback, useEffect, useRef, useState, useLayoutEffect } from 'react'
import { ArrowLeft, Menu, Cat, Search, Settings2, Trash2, Waves, X } from 'lucide-react'
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
import SpicyMonopolyBoard from './SpicyMonopolyBoard'
import SessionList from '../SessionList'
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
import { getXinchaoStatus, onXinchaoUpdate, getCodexMemoryFile, putCodexMemoryFile, uploadFileToCompanion, getTidalMemoryStatus } from '../../services/companion'

const SYNC_BASE = 'https://chat.xiaoman.xyz'
const FAV_LIST_KEY = 'user:xiaoman2.26:voice_fav_list'

function chatTidalNotice(status) {
  const tide = status?.tide
  if (!tide) return null
  const queued = Number(status?.queuedCount) > 0 ? ' · 你的消息已排队' : ''
  if (tide.status === 'running') {
    const stageText = tide.stage === 'summarizing'
      ? '正在整理对话摘要'
      : tide.stage === 'summary_ready' || tide.stage === 'compact_sending'
        ? '摘要已生成，正在压缩上下文'
        : tide.stage === 'compacted' || tide.stage === 'recovery_sending' || tide.stage === 'recovering'
          ? '正在把连续记忆还给 CC'
          : '正在整理对话记忆'
    return { key: `running:${tide.stage}:${tide.at}`, tone: 'running', text: `${stageText}${queued}`, transient: false }
  }
  if (tide.status === 'retry_wait' || tide.status === 'failed') {
    return { key: `${tide.status}:${tide.stage}:${tide.at}`, tone: 'failed', text: '潮汐整理失败，聊天已恢复；稍后会自动重试', transient: true }
  }
  if (tide.status === 'success' && tide.at && Date.now() - tide.at < 120_000) {
    return { key: `success:${tide.stage}:${tide.at}`, tone: 'success', text: '潮汐整理完成，CC 已恢复', transient: true }
  }
  return null
}

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
  const { messages, sendMessage, sendMessageBatch, sendImageMessageBatch, loadHistory, isLoading, regenerate, regenerateRound, retryFailed, deleteMsg, editMessage, stopStreaming } = active

  const effectiveAiName = currentSession?.aiName ?? globalAiName
  const effectiveAiAvatar = currentSession?.aiAvatar ?? globalAiAvatar
  const effectiveUserAvatar = currentSession?.userAvatar ?? globalUserAvatar
  const effectiveSignature = currentSession?.signature ?? '在线'
  const effectiveWebSearch = currentSession?.webSearch ?? false

  const inputRef = useRef(null)
  const [menuMsg, setMenuMsg] = useState(null)
  const [selectedMessageIds, setSelectedMessageIds] = useState(() => new Set())
  const [replyTargets, setReplyTargets] = useState([])
  const [memoryMsg, setMemoryMsg] = useState(null)
  const [editMsg, setEditMsg] = useState(null)
  const [editText, setEditText] = useState('')
  const [toast, setToast] = useState(null)
  const [showCall, setShowCall] = useState(false)
  const [showGomoku, setShowGomoku] = useState(false)
  const [showSpicy, setShowSpicy] = useState(false)
  const [showSessionDrawer, setShowSessionDrawer] = useState(false)
  const [showDivination, setShowDivination] = useState(false)
  const [showCarryOut, setShowCarryOut] = useState(false)
  const [showHeaderTools, setShowHeaderTools] = useState(false)
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
  const [tidalNotice, setTidalNotice] = useState(null)
  const tidalNoticeKeyRef = useRef('')
  const tidalNoticeTimerRef = useRef(null)

  useEffect(() => {
    setReplyTargets([])
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

  // CC's fixed-window tide runs after an ordinary reply and can briefly hold
  // subsequent messages. Poll the authoritative server state while the CC
  // chat is open so this never looks like the person vanished. Running state
  // stays visible; completion/failure remains long enough to actually read.
  useEffect(() => {
    if (!isVpsSession) {
      if (tidalNoticeTimerRef.current) clearTimeout(tidalNoticeTimerRef.current)
      tidalNoticeTimerRef.current = null
      tidalNoticeKeyRef.current = ''
      setTidalNotice(null)
      return
    }
    let live = true
    let poller = null
    const scheduleNext = (delay) => {
      clearTimeout(poller)
      if (live && document.visibilityState === 'visible') poller = setTimeout(refresh, delay)
    }
    const refresh = async () => {
      let nextDelay = 30_000
      try {
        const status = await getTidalMemoryStatus()
        if (!live) return
        // Only an active tide needs close stage tracking. An idle CC window
        // previously fetched this endpoint every 1.5 seconds forever, which
        // kept mobile radios and JS wakeups unnecessarily busy.
        if (status?.tide?.status === 'running') nextDelay = 1_500
        const next = chatTidalNotice(status)
        if (!next) {
          if (!tidalNoticeTimerRef.current) setTidalNotice(null)
          return
        }
        if (next.key === tidalNoticeKeyRef.current) return
        tidalNoticeKeyRef.current = next.key
        if (tidalNoticeTimerRef.current) clearTimeout(tidalNoticeTimerRef.current)
        tidalNoticeTimerRef.current = null
        setTidalNotice(next)
        if (next.transient) {
          tidalNoticeTimerRef.current = setTimeout(() => {
            tidalNoticeTimerRef.current = null
            if (live) setTidalNotice(null)
          }, next.tone === 'success' ? 10_000 : 14_000)
        }
      } catch {
        // Chat delivery has its own connection/error UI. A status-poll error
        // must not invent a tide failure or interfere with sending messages.
      } finally {
        scheduleNext(nextDelay)
      }
    }
    const refreshWhenVisible = () => {
      clearTimeout(poller)
      if (document.visibilityState === 'visible') void refresh()
    }
    void refresh()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      live = false
      clearTimeout(poller)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      if (tidalNoticeTimerRef.current) clearTimeout(tidalNoticeTimerRef.current)
      tidalNoticeTimerRef.current = null
    }
  // A normal reply ending is the moment a tide can be claimed server-side;
  // restarting this lightweight poll once on that transition detects it
  // immediately without paying the 1.5-second idle polling cost.
  }, [isVpsSession, isLoading])

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
  const handleSendImage = async ({ imageData, imageType, imageUrl, messages: imageMessages = [] }) => {
    updateActiveTime()
    try {
      await sendImageMessageBatch({ imageData, imageType, imageUrl, messages: imageMessages })
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

  const handleReplySelected = useCallback(() => {
    const targets = messages
      .filter((message) => selectedMessageIds.has(message.id))
      .map((msg) => {
        const raw = msg.type === 'voice'
          ? (msg.voiceText || '语音消息')
          : msg.type === 'image'
            ? (msg.content || '图片')
            : msg.type === 'file'
              ? (msg.fileName || '文件')
              : (msg.content || '')
        return {
          id: msg.id,
          label: msg.role === 'user' ? '我' : effectiveAiName,
          preview: raw.replace(/\s+/g, ' ').trim().slice(0, 80) || '消息',
        }
      })
    if (!targets.length) return
    setReplyTargets((current) => {
      const existingIds = new Set(current.map((target) => target.id))
      return [...current, ...targets.filter((target) => !existingIds.has(target.id))]
    })
    setSelectedMessageIds(new Set())
    setTimeout(() => inputRef.current?.focus?.(), 0)
  }, [effectiveAiName, messages, selectedMessageIds])

  const handleReply = (msg) => {
    const raw = msg.type === 'voice'
      ? (msg.voiceText || '语音消息')
      : msg.type === 'image'
        ? (msg.content || '图片')
        : msg.type === 'file'
          ? (msg.fileName || '文件')
          : (msg.content || '')
    const preview = raw.replace(/\s+/g, ' ').trim().slice(0, 80)
    setReplyTargets((current) => current.some((target) => target.id === msg.id)
      ? current
      : [...current, {
          id: msg.id,
          label: msg.role === 'user' ? '我' : effectiveAiName,
          preview: preview || '消息',
        }])
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
      <div className="safe-top"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)',
          paddingBottom: 12,
          paddingLeft: 13,
          paddingRight: 13,
          background: `linear-gradient(180deg, rgba(255,252,253,.7), ${primaryColor}0d)`,
          backdropFilter: 'blur(18px)',
          WebkitBackdropFilter: 'blur(18px)',
          flexShrink: 0,
          position: 'relative',
          zIndex: 10,
        }}>
        <div className="flex items-center min-w-0" style={{ gap: 8 }}>
          <button
            onClick={() => setCurrentView('sessions')}
            title="返回铃兰花园"
            aria-label="返回铃兰花园"
            className="w-9 h-9 flex items-center justify-center flex-shrink-0"
            style={{ border: 0, borderRadius: '52% 48% 58% 42% / 43% 57% 43% 57%', background: 'rgba(255,255,255,.48)', color: primaryDarkColor }}
          >
            <ArrowLeft size={20} />
          </button>
          <button
            onClick={() => setShowSessionDrawer(true)}
            title="切换对话"
            aria-label="切换对话"
            className="w-9 h-9 flex items-center justify-center flex-shrink-0"
            style={{ border: 0, borderRadius: '47% 53% 40% 60% / 58% 43% 57% 42%', background: `${primaryColor}10`, color: primaryColor }}
          >
            <Menu size={17} />
          </button>
          <div className="w-11 h-11 rounded-full overflow-hidden flex items-center justify-center text-xl flex-shrink-0"
            style={{
              background: `${primaryColor}33`,
              border: `2px solid ${primaryColor}9c`,
              boxShadow: `0 0 8px ${primaryColor}b8, 0 0 17px ${primaryColor}68, 0 2px 8px rgba(92,68,102,.18)`,
            }}>
            {effectiveAiAvatar
              ? <img src={effectiveAiAvatar} alt="" className="w-full h-full object-cover" />
              : <span style={{ fontSize: 12, fontWeight: 700, color: primaryDarkColor }}>CC</span>}
          </div>
          <div className="min-w-0" style={{ flex: 1, alignSelf: 'stretch', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div className="flex items-center min-w-0" style={{ height: 22 }}>
              <div className="font-semibold text-sm" style={{
                flex: 1, minWidth: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: primaryColor,
                textShadow: `0 0 8px ${primaryColor}cc, 0 0 18px ${primaryColor}80`,
              }}>
                {effectiveAiName || currentSession?.name || '新对话'}
              </div>
            </div>
            <div className="flex items-center min-w-0" style={{ height: 23, gap: 4 }}>
              <div className="min-w-0" style={{ flex: 1, overflow: 'hidden' }}>
                <Signature text={effectiveSignature || '在线'} color={primaryColor} shadow={`0 0 6px ${primaryColor}aa, 0 0 14px ${primaryColor}60`} />
              </div>
              {effectiveWebSearch && (
                <span style={{
                  width: 5, height: 5, borderRadius: '50%', background: '#4aacf0',
                  boxShadow: '0 0 5px rgba(74,172,240,.65)', flexShrink: 0,
                }} title="已联网" />
              )}
            </div>
          </div>
          {isFixedVpsSession && (
            <div className="flex-shrink-0" style={{ width: 34, height: 34 }}>
              <RuntimeStatusBall theme={theme} isLoading={isLoading} runtime={isCodexSession ? 'codex' : 'claude-code'} />
            </div>
          )}
          <button
            onClick={() => setShowHeaderTools((value) => !value)}
            className="btn-whale flex items-center justify-center flex-shrink-0"
            aria-expanded={showHeaderTools}
            aria-label="展开聊天工具"
            style={{ width: 56, height: 56, borderRadius: '50%', background: `${primaryColor}0b`, border: 0, overflow: 'hidden' }}
          >
            <img src="/assets/whale.png" alt="" style={{ width: 70, height: 70, objectFit: 'contain', flexShrink: 0 }} />
          </button>
        </div>
      </div>

      {/* Wave divider — 原聊天窗口的既有装饰，保留。 */}
      <div style={{ height: 8, overflow: 'hidden', marginTop: -1, flexShrink: 0 }}>
        <svg viewBox="0 0 400 8" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4 L400,8 L0,8 Z"
            fill={`${theme?.primary || '#ff85b3'}20`} />
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4"
            fill="none" stroke="#FFE4A1" strokeWidth="1.5" />
        </svg>
      </div>

      {showHeaderTools && (
        <div className="fixed inset-0" style={{ zIndex: 78 }}>
          <style>{`
            @keyframes headerToolsBloom{from{opacity:0;transform:scale(.72) rotate(-8deg)}to{opacity:1;transform:scale(1) rotate(0)}}
            .header-tool-choice{position:absolute;width:50px;height:50px;border:0;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;font-size:9px;box-shadow:0 4px 14px rgba(69,54,79,.13);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
          `}</style>
          <button className="absolute inset-0 border-0" style={{ background: 'rgba(37,30,44,.12)', backdropFilter: 'blur(2px)' }} onClick={() => setShowHeaderTools(false)} aria-label="收起聊天工具" />
          <div
            role="menu"
            aria-label="聊天工具"
            style={{
              position: 'absolute', top: 'calc(var(--safe-top) + 75px)', right: 10,
              width: 188, height: 188, borderRadius: '50%',
              background: `radial-gradient(circle,rgba(255,255,255,.94) 0 31%,${primaryColor}1c 32% 100%)`,
              boxShadow: `0 12px 38px rgba(55,42,67,.2), inset 0 0 0 1px ${primaryColor}18`,
              animation: 'headerToolsBloom .24s cubic-bezier(.2,.8,.2,1)',
            }}
          >
            <button className="header-tool-choice" style={{ left: 69, top: 8, color: primaryDarkColor, background: 'rgba(255,255,255,.86)' }} onClick={() => { setShowHeaderTools(false); setShowSearch(true) }}><Search size={17} /><span>搜索</span></button>
            <button className="header-tool-choice" disabled={!xinchaoState} style={{ right: 8, top: 69, color: primaryDarkColor, background: 'rgba(255,255,255,.86)', opacity: xinchaoState ? 1 : .4 }} onClick={() => { setShowHeaderTools(false); setShowXinchaoPanel(true) }}><Waves size={17} /><span>心潮</span></button>
            <button className="header-tool-choice" style={{ left: 69, bottom: 8, color: primaryColor, background: 'rgba(255,255,255,.86)' }} onClick={() => { setShowHeaderTools(false); setShowCarryOut(true) }}><Cat size={17} /><span>桌宠</span></button>
            <button className="header-tool-choice" style={{ left: 8, top: 69, color: primaryDarkColor, background: 'rgba(255,255,255,.86)' }} onClick={() => { setShowHeaderTools(false); setCurrentView('sessionSettings') }}><Settings2 size={17} /><span>设置</span></button>
            <div style={{ position: 'absolute', inset: 61, borderRadius: '50%', display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,.72)', boxShadow: `0 0 16px ${primaryColor}28` }}>
              <img src="/assets/whale.png" alt="" style={{ width: 61, height: 61, objectFit: 'contain' }} />
            </div>
          </div>
        </div>
      )}

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

        {isVpsSession && tidalNotice && (
          <div className="flex-shrink-0 flex justify-center px-4 pt-1.5" style={{ position: 'relative', zIndex: 4 }}>
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px]"
              style={{
                color: tidalNotice.tone === 'success' ? '#287a58' : tidalNotice.tone === 'failed' ? '#a1545e' : '#3c6f9d',
                background: tidalNotice.tone === 'success' ? 'rgba(210,246,228,.82)' : tidalNotice.tone === 'failed' ? 'rgba(255,225,226,.84)' : 'rgba(220,239,255,.84)',
                borderRadius: '48% 52% 46% 54% / 57% 45% 55% 43%',
                boxShadow: `0 3px 12px ${primaryColor}18`,
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
              }}
            >
              <Waves size={13} className={tidalNotice.tone === 'running' ? 'animate-pulse' : ''} />
              <span>{tidalNotice.text}</span>
            </div>
          </div>
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
              ☑️ 多选
            </button>
          </div>
        </div>
      )}

      {selectedMessageIds.size > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full px-2 py-2" style={{ bottom: 'calc(var(--safe-bottom) + 78px)', zIndex: 45, background: 'rgba(255,255,255,.96)', boxShadow: '0 8px 30px rgba(70,45,60,.2)', border: `1px solid ${primaryColor}30`, backdropFilter: 'blur(16px)' }}>
          <button onClick={cancelMultiSelect} className="w-9 h-9 rounded-full grid place-items-center" style={{ color: '#8b7580', background: '#f5f0f2' }} aria-label="取消多选"><X size={17} /></button>
          <span className="px-2 text-sm font-medium" style={{ color: '#76525e', minWidth: 74, textAlign: 'center' }}>已选 {selectedMessageIds.size} 条</span>
          <button onClick={handleReplySelected} className="h-9 rounded-full px-4 flex items-center gap-1.5 text-sm" style={{ color: '#8b5060', background: '#f8e9ef' }}>↩️ 引用</button>
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

      {/* 输入区：聊天页不显示主导航，输入区自己承接底部安全区。
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
          replyDrafts={replyTargets}
          onCancelReply={(id) => setReplyTargets((current) => id ? current.filter((target) => target.id !== id) : [])}
          onOpenGomoku={() => setShowGomoku(true)}
          onRollDice={() => {
            const random = new Uint32Array(1)
            crypto.getRandomValues(random)
            const value = (random[0] % 6) + 1
            updateActiveTime()
            sendMessage(`[DICE:${value}]`, 'text').catch(e => console.error('[DICE] send failed:', e.message))
          }}
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

      {showSessionDrawer && (
        <div className="fixed inset-0 z-[84] flex" role="dialog" aria-modal="true" aria-label="切换对话">
          <style>{`@keyframes eunoiaDrawerIn{from{transform:translateX(-102%)}to{transform:translateX(0)}}`}</style>
          <button
            className="absolute inset-0 border-0"
            style={{ background: 'rgba(33,29,42,.22)', backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}
            onClick={() => setShowSessionDrawer(false)}
            aria-label="关闭会话列表"
          />
          <div
            className="relative h-full overflow-hidden"
            style={{
              width: 'min(92vw, 400px)',
              borderRadius: '0 38px 34px 0',
              background: `linear-gradient(180deg,rgba(255,252,253,.76),rgba(244,248,246,.72)), url('/backgrounds/fa048-garden-v1.webp') center top / cover no-repeat`,
              boxShadow: '18px 0 55px rgba(37,29,49,.2)',
              animation: 'eunoiaDrawerIn .3s cubic-bezier(.2,.75,.2,1)',
            }}
          >
            <SessionList
              theme={theme}
              onBackHome={() => {
                setShowSessionDrawer(false)
                setCurrentView('sessions')
              }}
              onSelectSession={() => setShowSessionDrawer(false)}
              onOpenGroupChat={(id) => {
                setShowSessionDrawer(false)
                useStore.getState().setCurrentGroupChatId(id)
                setCurrentView('groupChat')
              }}
              onOpenCareHub={() => {
                setShowSessionDrawer(false)
                setCurrentView('careHub')
              }}
            />
          </div>
        </div>
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
