import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, Eye, EyeOff } from 'lucide-react'
import { useStore, getMessages, saveBlob } from '../store'

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,220,255,0.4)',
  borderRadius: 14,
  padding: '10px 16px',
  color: '#2c5282',
  outline: 'none',
  fontFamily: 'inherit',
  fontSize: 'inherit',
}

function GlassCard({ icon, title, children }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.42)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderRadius: 20,
      padding: 16,
      border: '1px solid rgba(200,220,255,0.3)',
      boxShadow: '0 4px 20px rgba(74,172,240,0.06)',
    }}>
      <div className="flex items-center gap-2 mb-3">
        <span>{icon}</span>
        <span className="font-medium text-sm" style={{ color: '#2c5282' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

export default function SessionSettings({ theme }) {
  const {
    sessions, currentSessionId, updateSession, setCurrentView,
    setSessionAiName, setSessionAiAvatar, setSessionUserAvatar, setSessionSignature,
    setSessionMemoryEnabled, setSessionSystemPrompt,
    setSessionChatBg,
    setSessionApiKey, setSessionBaseUrl, setSessionProviderName, setSessionModel,
    setSessionTtsApiKey, setSessionTtsGroupId, setSessionTtsVoiceId, setSessionVoiceFrequency,
    setSessionFollowGlobalTts,
    memoryEnabled: globalMemoryEnabled,
    systemPrompt: globalSystemPrompt,
    aiVoiceFrequency: globalVoiceFrequency,
  } = useStore()

  const currentSession = sessions?.find(s => s.id === currentSessionId)
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [localName, setLocalName] = useState('')
  const [localSignature, setLocalSignature] = useState('')
  const [localSystemPrompt, setLocalSystemPrompt] = useState('')
  const [localAvatar, setLocalAvatar] = useState('')
  const [localUserAvatar, setLocalUserAvatar] = useState('')
  const [showAvatarUrl, setShowAvatarUrl] = useState(false)
  const avatarFileRef = useRef(null)
  const userAvatarFileRef = useRef(null)
  const bgFileRef = useRef(null)

  const [localApiKey, setLocalApiKey] = useState('')
  const [localBaseUrl, setLocalBaseUrl] = useState('')
  const [localProviderName, setLocalProviderName] = useState('')
  const [localModel, setLocalModel] = useState('')
  const [localTtsApiKey, setLocalTtsApiKey] = useState('')
  const [localTtsGroupId, setLocalTtsGroupId] = useState('')
  const [localTtsVoiceId, setLocalTtsVoiceId] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [showTtsKey, setShowTtsKey] = useState(false)

  const handleAvatarFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      setLocalAvatar(dataUrl)
      setSessionAiAvatar(currentSessionId, dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleUserAvatarFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result
      setLocalUserAvatar(dataUrl)
      setSessionUserAvatar(currentSessionId, dataUrl)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleBgFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop().toLowerCase()
    const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp']
    const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']
    const mimeOk = !file.type || ALLOWED_TYPES.includes(file.type.toLowerCase())
    const extOk = ALLOWED_EXTS.includes(ext)
    if (!mimeOk && !extOk) {
      if (ext === 'heic' || ext === 'heif') {
        alert('HEIC/HEIF 格式暂不支持，请先在相册中将图片转换为 JPG 再上传。')
      } else {
        alert(`不支持的图片格式：${file.type || ext}`)
      }
      return
    }

    try {
      console.log(`[BG] 开始处理背景图：${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`)
      let blob = file
      const MAX_SIZE = 10 * 1024 * 1024
      if (file.size > MAX_SIZE) {
        console.log('[BG] 图片过大，正在压缩…')
        blob = await new Promise((resolve, reject) => {
          const img = new window.Image()
          const url = URL.createObjectURL(file)
          img.onload = () => {
            URL.revokeObjectURL(url)
            let { width, height } = img
            const MAX_DIM = 1920
            if (width > MAX_DIM || height > MAX_DIM) {
              const scale = MAX_DIM / Math.max(width, height)
              width = Math.round(width * scale)
              height = Math.round(height * scale)
            }
            const canvas = document.createElement('canvas')
            canvas.width = width
            canvas.height = height
            canvas.getContext('2d').drawImage(img, 0, 0, width, height)
            canvas.toBlob(b => {
              if (b) { console.log(`[BG] 压缩完成：${(b.size / 1024 / 1024).toFixed(2)} MB`); resolve(b) }
              else reject(new Error('canvas.toBlob 失败'))
            }, 'image/jpeg', 0.82)
          }
          img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')) }
          img.src = url
        })
      }

      const blobKey = `bg:${currentSessionId}`
      await saveBlob(blobKey, blob)
      console.log('[BG] 已存入 IndexedDB，key:', blobKey)
      setSessionChatBg(currentSessionId, { type: 'image', blobKey, opacity: currentSession?.chatBg?.opacity ?? 0.9 })
      console.log('[BG] 背景已更新')
    } catch (err) {
      console.error('[BG] 背景图处理失败', err)
      alert('背景图处理失败：' + err.message)
    }
  }

  useEffect(() => {
    if (!currentSession) return
    setLocalName(currentSession.aiName || '')
    setLocalSignature(currentSession.signature || '')
    setLocalSystemPrompt(currentSession.systemPrompt ?? globalSystemPrompt ?? '')
    setLocalAvatar(currentSession.aiAvatar || '')
    setLocalUserAvatar(currentSession.userAvatar || '')
    setLocalApiKey(currentSession.apiKey || '')
    setLocalBaseUrl(currentSession.baseUrl || '')
    setLocalProviderName(currentSession.providerName || '')
    setLocalModel(currentSession.model || '')
    setLocalTtsApiKey(currentSession.ttsApiKey || '')
    setLocalTtsGroupId(currentSession.ttsGroupId || '')
    setLocalTtsVoiceId(currentSession.ttsVoiceId || '')
  }, [currentSessionId])

  if (!currentSession) {
    return (
      <div className="flex items-center justify-center h-full">
        <span style={{ color: '#7a9cc0' }}>没有活跃的会话</span>
      </div>
    )
  }

  const chipStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
    border: active ? `1.5px solid ${primary}` : '1.5px solid rgba(200,220,255,0.4)',
    background: active ? `${primary}22` : 'rgba(255,255,255,0.4)',
    color: active ? primaryDark : '#6a90b8',
    fontWeight: active ? 600 : 400,
  })

  const memoryOverride = currentSession.memoryEnabled

  const handleExportJSON = async () => {
    const msgs = await getMessages(currentSessionId)
    msgs.sort((a, b) => a.timestamp - b.timestamp)
    const blob = new Blob([JSON.stringify({ session: currentSession, messages: msgs }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const d = new Date().toISOString().slice(0, 10)
    const safeName = (currentSession.name || 'chat').replace(/[^\w一-鿿]/g, '_')
    a.download = `${safeName}-${d}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportTxt = async () => {
    const msgs = await getMessages(currentSessionId)
    msgs.sort((a, b) => a.timestamp - b.timestamp)
    let text = `== ${currentSession.name} ==\n`
    for (const msg of msgs) {
      const time = new Date(msg.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
      const role = msg.role === 'user' ? '我' : 'AI'
      const content = msg.type === 'text' ? msg.content : msg.type === 'voice' ? '[语音消息]' : '[图片]'
      text += `[${time}] ${role}: ${content}\n`
    }
    const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const d = new Date().toISOString().slice(0, 10)
    const safeName = (currentSession.name || 'chat').replace(/[^\w一-鿿]/g, '_')
    a.download = `${safeName}-${d}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)',
          paddingBottom: 12,
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(200,220,255,0.25)',
          boxShadow: '0 2px 12px rgba(74,172,240,0.08)',
        }}>
        <button
          onClick={() => setCurrentView('chat')}
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200"
          style={{ background: `${primary}18`, color: primary }}
        >
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-sm flex-1" style={{ color: '#2c5282' }}>当前会话设置</span>
        <span className="text-xs truncate max-w-[100px]" style={{ color: '#7a9cc0' }}>
          {currentSession.name}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

        {/* AI Identity */}
        <GlassCard icon="🌸" title="AI 角色">
          <div className="space-y-2">
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>AI 名字</label>
              <input
                value={localName}
                onChange={e => setLocalName(e.target.value)}
                onBlur={() => setSessionAiName(currentSessionId, localName.trim() || '小漫')}
                placeholder="小漫"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs pl-1 mb-2 block" style={{ color: '#6a90b8' }}>AI 头像</label>
              <div className="flex items-center gap-3 mb-1">
                <div style={{
                  width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                  background: `${primary}18`, border: `2px solid ${primary}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
                }}>
                  {localAvatar
                    ? <img src={localAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🌸'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <button
                    onClick={() => avatarFileRef.current?.click()}
                    style={{
                      padding: '7px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                      background: `${primary}18`, color: primaryDark,
                      border: `1.5px solid ${primary}44`, textAlign: 'center',
                    }}
                  >
                    📷 从相册上传
                  </button>
                  <button
                    onClick={() => setShowAvatarUrl(v => !v)}
                    style={{ fontSize: 12, color: '#7a9cc0', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                  >
                    {showAvatarUrl ? '▾ 收起URL输入' : '▸ 或输入图片URL'}
                  </button>
                </div>
                {localAvatar && (
                  <button
                    onClick={() => { setLocalAvatar(''); setSessionAiAvatar(currentSessionId, '') }}
                    style={{ fontSize: 12, color: '#a0b8d0', background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                  >
                    ✕
                  </button>
                )}
                <input ref={avatarFileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
              </div>
              {showAvatarUrl && (
                <input
                  value={localAvatar.startsWith('data:') ? '' : localAvatar}
                  onChange={e => setLocalAvatar(e.target.value)}
                  onBlur={() => { if (!localAvatar.startsWith('data:')) setSessionAiAvatar(currentSessionId, localAvatar.trim()) }}
                  placeholder={localAvatar.startsWith('data:') ? '（已上传图片）' : 'https://example.com/avatar.jpg'}
                  style={{ ...inputStyle, marginTop: 6 }}
                  disabled={localAvatar.startsWith('data:')}
                />
              )}
            </div>
            <div>
              <label className="text-xs pl-1 mb-2 block" style={{ color: '#6a90b8' }}>用户头像</label>
              <div className="flex items-center gap-3 mb-1">
                <div style={{
                  width: 52, height: 52, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
                  background: `${primary}18`, border: `2px solid ${primary}44`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24,
                }}>
                  {localUserAvatar
                    ? <img src={localUserAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🐣'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                  <button
                    onClick={() => userAvatarFileRef.current?.click()}
                    style={{
                      padding: '7px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                      background: `${primary}18`, color: primaryDark,
                      border: `1.5px solid ${primary}44`, textAlign: 'center',
                    }}
                  >
                    📷 从相册上传
                  </button>
                </div>
                {localUserAvatar && (
                  <button
                    onClick={() => { setLocalUserAvatar(''); setSessionUserAvatar(currentSessionId, '') }}
                    style={{ fontSize: 12, color: '#a0b8d0', background: 'none', border: 'none', cursor: 'pointer', padding: 4, flexShrink: 0 }}
                  >
                    ✕
                  </button>
                )}
                <input ref={userAvatarFileRef} type="file" accept="image/*" className="hidden" onChange={handleUserAvatarFile} />
              </div>
            </div>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>签名 / 状态</label>
              <input
                value={localSignature}
                onChange={e => setLocalSignature(e.target.value)}
                onBlur={() => setSessionSignature(currentSessionId, localSignature)}
                placeholder="小漫一直在这里等你～"
                style={inputStyle}
              />
            </div>
          </div>
        </GlassCard>

        {/* System Prompt */}
        <GlassCard icon="💬" title="系统提示词">
          <textarea
            value={localSystemPrompt}
            onChange={e => setLocalSystemPrompt(e.target.value)}
            onBlur={() => setSessionSystemPrompt(currentSessionId, localSystemPrompt)}
            rows={5}
            placeholder="输入此会话的系统提示词…"
            style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.6 }}
          />
          <button
            onClick={() => {
              setLocalSystemPrompt(globalSystemPrompt || '')
              setSessionSystemPrompt(currentSessionId, globalSystemPrompt || '')
            }}
            className="mt-2 text-xs"
            style={{ color: '#7a9cc0', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
          >
            ↩ 恢复全局默认
          </button>
        </GlassCard>

        {/* API Config */}
        <GlassCard icon="🔑" title="API 配置">
          <div className="space-y-2">
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>供应商名称</label>
              <input
                value={localProviderName}
                onChange={e => setLocalProviderName(e.target.value)}
                onBlur={() => setSessionProviderName(currentSessionId, localProviderName.trim())}
                placeholder="如 OpenAI / DeepSeek"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>Base URL</label>
              <input
                value={localBaseUrl}
                onChange={e => setLocalBaseUrl(e.target.value)}
                onBlur={() => setSessionBaseUrl(currentSessionId, localBaseUrl.trim())}
                placeholder="https://api.anthropic.com"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>API Key</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={localApiKey}
                  onChange={e => setLocalApiKey(e.target.value)}
                  onBlur={() => setSessionApiKey(currentSessionId, localApiKey.trim())}
                  placeholder="sk-..."
                  style={{ ...inputStyle, paddingRight: 44 }}
                />
                <button
                  onClick={() => setShowApiKey(v => !v)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', color: '#7a9cc0', padding: 0,
                  }}
                >
                  {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>模型</label>
              <input
                value={localModel}
                onChange={e => setLocalModel(e.target.value)}
                onBlur={() => setSessionModel(currentSessionId, localModel.trim())}
                placeholder="claude-sonnet-4-6"
                style={inputStyle}
              />
            </div>
          </div>
        </GlassCard>

        {/* TTS Config */}
        <GlassCard icon="🎙️" title="AI 语音">
          <div className="space-y-3">
            {/* TTS config source */}
            <div>
              <label className="text-xs pl-1 mb-2 block" style={{ color: '#6a90b8' }}>TTS 配置来源</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setSessionFollowGlobalTts(currentSessionId, null)}
                  style={chipStyle(currentSession.followGlobalTts !== false)}
                >跟随全局</button>
                <button
                  onClick={() => setSessionFollowGlobalTts(currentSessionId, false)}
                  style={chipStyle(currentSession.followGlobalTts === false)}
                >本会话独立</button>
              </div>
            </div>

            {/* Session-specific TTS fields — only shown when not following global */}
            {currentSession.followGlobalTts === false && (
              <div className="space-y-2">
                <div>
                  <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>TTS API Key</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type={showTtsKey ? 'text' : 'password'}
                      value={localTtsApiKey}
                      onChange={e => setLocalTtsApiKey(e.target.value)}
                      onBlur={() => setSessionTtsApiKey(currentSessionId, localTtsApiKey.trim())}
                      placeholder="MiniMax API Key"
                      style={{ ...inputStyle, paddingRight: 44 }}
                    />
                    <button
                      onClick={() => setShowTtsKey(v => !v)}
                      style={{
                        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                        background: 'none', border: 'none', cursor: 'pointer', color: '#7a9cc0', padding: 0,
                      }}
                    >
                      {showTtsKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>Group ID</label>
                  <input
                    value={localTtsGroupId}
                    onChange={e => setLocalTtsGroupId(e.target.value)}
                    onBlur={() => setSessionTtsGroupId(currentSessionId, localTtsGroupId.trim())}
                    placeholder="MiniMax Group ID"
                    style={inputStyle}
                  />
                </div>
                <div>
                  <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>音色 ID</label>
                  <input
                    value={localTtsVoiceId}
                    onChange={e => setLocalTtsVoiceId(e.target.value)}
                    onBlur={() => setSessionTtsVoiceId(currentSessionId, localTtsVoiceId.trim())}
                    placeholder="English_Trustworthy_Man"
                    style={inputStyle}
                  />
                </div>
              </div>
            )}

            {/* Voice frequency */}
            <div>
              <label className="text-xs pl-1 mb-2 block" style={{ color: '#6a90b8' }}>语音发送频率</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: '从不', value: 0.0 },
                  { label: '偶尔', value: 0.3 },
                  { label: '经常', value: 0.7 },
                  { label: '总是', value: 1.0 },
                ].map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setSessionVoiceFrequency(currentSessionId, opt.value)}
                    style={chipStyle(currentSession.voiceFrequency === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {(currentSession.voiceFrequency ?? null) === null ? (
                <p className="text-xs mt-1.5 pl-1" style={{ color: '#a0b8d0' }}>
                  跟随全局（{Math.round((globalVoiceFrequency ?? 0.5) * 100)}%）
                </p>
              ) : (
                <button
                  onClick={() => setSessionVoiceFrequency(currentSessionId, null)}
                  className="mt-1.5 text-xs"
                  style={{ color: '#7a9cc0', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px' }}
                >
                  ↩ 恢复全局默认
                </button>
              )}
            </div>
          </div>
        </GlassCard>

        {/* Chat Background */}
        <GlassCard icon="🖼️" title="聊天背景">
          <div className="space-y-3">
            <div className="flex gap-2">
              <button
                onClick={() => bgFileRef.current?.click()}
                style={{
                  padding: '7px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                  background: `${primary}18`, color: primaryDark,
                  border: `1.5px solid ${primary}44`,
                }}
              >
                📷 上传背景图
              </button>
              {currentSession.chatBg && (
                <button
                  onClick={() => setSessionChatBg(currentSessionId, null)}
                  style={{
                    padding: '7px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                    background: 'rgba(255,100,100,0.08)', color: '#e07070',
                    border: '1.5px solid rgba(255,100,100,0.2)',
                  }}
                >
                  清除背景
                </button>
              )}
              <input ref={bgFileRef} type="file" accept="image/*" className="hidden" onChange={handleBgFile} />
            </div>
            {currentSession.chatBg?.type === 'image' && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs" style={{ color: '#6a90b8' }}>透明度</span>
                  <span className="text-xs" style={{ color: '#6a90b8' }}>{Math.round((currentSession.chatBg?.opacity ?? 0.9) * 100)}%</span>
                </div>
                <input
                  type="range" min="0.1" max="1.0" step="0.05"
                  value={currentSession.chatBg?.opacity ?? 0.9}
                  onChange={e => setSessionChatBg(currentSessionId, { ...currentSession.chatBg, opacity: Number(e.target.value) })}
                  className="w-full"
                  style={{ accentColor: primary, cursor: 'pointer' }}
                />
              </div>
            )}
          </div>
        </GlassCard>

        {/* Memory */}
        <GlassCard icon="🧠" title="记忆注入">
          <p className="text-xs mb-3" style={{ color: '#7a9cc0' }}>
            覆盖全局记忆开关。当前全局：{globalMemoryEnabled ? '已开启' : '已关闭'}
          </p>
          <div className="flex flex-wrap gap-2">
            {[
              { label: '跟随全局', value: null },
              { label: '本会话开启', value: true },
              { label: '本会话关闭', value: false },
            ].map(opt => (
              <button
                key={String(opt.value)}
                onClick={() => setSessionMemoryEnabled(currentSessionId, opt.value)}
                style={chipStyle(memoryOverride === opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Export */}
        <GlassCard icon="📤" title="导出本对话">
          <div className="flex gap-2">
            <button onClick={handleExportJSON}
              className="flex-1 py-2.5 rounded-full text-sm font-medium text-white transition-all duration-200"
              style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, boxShadow: `0 4px 12px ${primary}40`, border: 'none' }}>
              导出 JSON
            </button>
            <button onClick={handleExportTxt}
              className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200"
              style={{ background: 'rgba(255,255,255,0.6)', color: '#6a90b8', border: '1px solid rgba(200,220,255,0.4)' }}>
              导出 TXT
            </button>
          </div>
        </GlassCard>

      </div>
    </div>
  )
}
