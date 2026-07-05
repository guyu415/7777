import { useEffect, useRef, useState, useLayoutEffect } from 'react'
import MessageBubble from './MessageBubble'
import FallingParticles from './FallingParticles'
import MessageInput from './MessageInput'
import MemoryModal from './MemoryModal'
import VoiceCall from '../Voice/VoiceCall'
import BottomNav from '../BottomNav'
import { useChat } from '../../hooks/useChat'
import { useScheduledMessages } from '../../hooks/useScheduledMessages'
import { useStore, deleteMessageFromDB, getBlob } from '../../store'
import { putAsset } from '../../services/sync'

const SYNC_BASE = 'https://chat.xiaoman.xyz'
const FAV_LIST_KEY = 'user:xiaoman2.26:voice_fav_list'

const draftsBySession = {}

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

export default function ChatWindow({ theme }) {
  const { messages, sendMessage, loadHistory, isLoading, regenerate, regenerateRound, deleteMsg, editMessage, stopStreaming } = useChat()
  const { fetchPendingMessages, updateActiveTime } = useScheduledMessages()
  const {
    currentView, setCurrentView, apiKey, aiAvatar: globalAiAvatar, aiName: globalAiName,
    userAvatar: globalUserAvatar,
    deleteMessagesFrom, workerUrl, currentSessionId, sessions, providers, selectedProviderId,
    summaryToast, setSummaryToast,
  } = useStore()

  const currentSession = sessions?.find(s => s.id === currentSessionId)
  const effectiveAiName = currentSession?.aiName ?? globalAiName
  const effectiveAiAvatar = currentSession?.aiAvatar ?? globalAiAvatar
  const effectiveUserAvatar = currentSession?.userAvatar ?? globalUserAvatar
  const effectiveSignature = currentSession?.signature ?? '在线'
  const effectiveWebSearch = currentSession?.webSearch ?? false

  const bottomRef = useRef(null)
  const inputRef = useRef(null)
  const [menuMsg, setMenuMsg] = useState(null)
  const [memoryMsg, setMemoryMsg] = useState(null)
  const [editMsg, setEditMsg] = useState(null)
  const [editText, setEditText] = useState('')
  const [toast, setToast] = useState(null)
  const [showCall, setShowCall] = useState(false)
  const callAudioRef = useRef(null)

  const selectedProvider = providers?.find(p => p.id === selectedProviderId)
  const effectiveApiKey = selectedProvider?.apiKey || apiKey

  const showToast = (msg = '✨ 已记住~') => {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  useEffect(() => {
    loadHistory()
  }, [currentSessionId])

  useEffect(() => {
    if (!summaryToast) return
    showToast(summaryToast)
    setSummaryToast(null)
  }, [summaryToast])

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

  const lastScrollTimeRef = useRef(0)
  useEffect(() => {
    const now = Date.now()
    if (now - lastScrollTimeRef.current < 150) return
    lastScrollTimeRef.current = now
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, messages[messages.length - 1]?.content?.length])

  // Draft preservation: save on unmount/session-change, restore on mount/session-change
  useEffect(() => {
    const draft = draftsBySession[currentSessionId] || ''
    if (draft) setTimeout(() => inputRef.current?.fill(draft), 0)
    return () => {
      const text = inputRef.current?.getText() || ''
      if (text.trim()) draftsBySession[currentSessionId] = text
      else delete draftsBySession[currentSessionId]
    }
  }, [currentSessionId])

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

  const handleSendImage = ({ imageData, imageType, imageUrl }) => {
    updateActiveTime()
    sendMessage('', 'image', { imageData, imageType, imageUrl })
  }

  const handleEdit = async (msg) => {
    setMenuMsg(null)
    const idx = messages.findIndex(m => m.id === msg.id)
    if (idx === -1) return
    for (const m of messages.slice(idx)) {
      await deleteMessageFromDB(m.id)
    }
    deleteMessagesFrom(msg.id)
    inputRef.current?.fill(msg.type === 'text' ? msg.content : '')
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
    await deleteMsg(msg.id)
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

  // Find the last assistant message id (the only one that gets a regenerate button)
  const lastAiId = messages.reduceRight((acc, m) => acc ?? (m.role === 'assistant' ? m.id : null), null)

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
        }}>
        <div className="flex items-center gap-3 min-w-0">
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
            <div className="font-semibold text-sm" style={{
              color: primaryColor,
              textShadow: `0 0 8px ${primaryColor}cc, 0 0 18px ${primaryColor}80`,
            }}>
              {effectiveAiName || '小满'}
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

      {/* Wave divider */}
      <div style={{ height: 8, overflow: 'hidden', marginTop: -1, flexShrink: 0 }}>
        <svg viewBox="0 0 400 8" preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4 L400,8 L0,8 Z"
            fill={`${theme?.primary || '#ff85b3'}20`} />
          <path d="M0,4 C50,0 100,8 150,4 C200,0 250,8 300,4 C350,0 400,8 400,4"
            fill="none" stroke="#FFE4A1" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Messages + particle layer */}
      <div className="flex-1 relative overflow-hidden">
        {/* Falling + stacking accessory particles — clipped to this area */}
        <FallingParticles />
      <div className="absolute inset-0 overflow-y-auto px-3 py-4" style={{ zIndex: 1 }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-3">
            <div className="text-5xl">🌸</div>
            <div className="font-medium" style={{ color: '#c47a8a' }}>你好，我是{effectiveAiName || '小满'}！</div>
            <div className="text-sm max-w-[200px]" style={{ color: '#d4a0b0' }}>
              {effectiveApiKey ? '说点什么开始聊天吧～' : '请先在设置中配置 API Key'}
            </div>
            {!effectiveApiKey && (
              <button
                onClick={() => setCurrentView('globalSettings')}
                className="mt-2 px-6 py-2.5 rounded-full text-sm font-medium text-white transition-all duration-300"
                style={{ background: `linear-gradient(135deg, ${theme?.primary || '#4aacf0'}, ${theme?.primaryDark || '#2196d3'})`, boxShadow: `0 4px 16px ${theme?.primary || '#4aacf0'}66` }}
              >
                去配置 <img src="/assets/whale.png" alt="" style={{ width: 20, height: 20, objectFit: 'contain', verticalAlign: 'middle', display: 'inline-block' }} />
              </button>
            )}
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onLongPress={setMenuMsg}
            onRegenerate={msg.id === lastAiId ? regenerate : null}
            onRegenerateRound={msg.id === lastAiId ? regenerateRound : null}
            isLoading={isLoading}
            userAvatar={effectiveUserAvatar}
            aiAvatar={effectiveAiAvatar}
            theme={theme}
          />
        ))}
        <div ref={bottomRef} />
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
          </div>
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

      {/* Unified input + nav — one shared glass panel, no seam */}
      <div
        className="safe-bottom flex-shrink-0"
        style={{
          background: `linear-gradient(to bottom, rgba(255,255,255,0.38), rgba(255,255,255,0.26))`,
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          borderTop: `1px solid ${primaryColor}18`,
        }}
      >
        <MessageInput
          ref={inputRef}
          onSend={(text) => {
            console.log('[PAW] onSend received, text:', JSON.stringify(text))
            updateActiveTime()
            sendMessage(text, 'text').catch(e => console.error('[PAW] sendMessage error:', e.message))
          }}
          onStartCall={handleStartCall}
          onSendImage={handleSendImage}
          disabled={isLoading}
          theme={theme}
          isLoading={isLoading}
          onStop={stopStreaming}
        />
        <BottomNav
          currentView={currentView}
          onChange={setCurrentView}
          theme={theme}
          bare
        />
      </div>

      {/* Memory modal */}
      {memoryMsg && (
        <MemoryModal
          message={memoryMsg}
          endpoint={workerUrl}
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
    </div>
  )
}
