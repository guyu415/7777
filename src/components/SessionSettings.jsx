import { useState, useEffect, useRef } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useStore, getMessages } from '../store'

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

const selectStyle = {
  ...inputStyle,
  cursor: 'pointer',
  paddingRight: 12,
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

const THEME_LIST = [
  { id: 'pink', label: '粉色甜心', dot: '#ff85b3' },
  { id: 'mint', label: '薄荷清新', dot: '#5cc8a0' },
  { id: 'skyblue', label: '天蓝清爽', dot: '#4aacf0' },
  { id: 'lavender', label: '薰衣草紫', dot: '#9b7fd4' },
]

const FONT_LIST = [
  { id: 'noto', label: '思源黑体' },
  { id: 'zcool', label: '站酷小薇' },
  { id: 'mashan', label: '马善政楷体' },
]

export default function SessionSettings({ theme }) {
  const {
    sessions, currentSessionId, updateSession, setCurrentView,
    setSessionAiName, setSessionAiAvatar, setSessionSignature,
    setSessionTheme, setSessionFont, setSessionFontSize,
    setSessionMemoryEnabled, setSessionSystemPrompt,
    providers, selectedProviderId, selectedModelId,
    memoryEnabled: globalMemoryEnabled,
    defaultFontSize, customFonts,
    themeId: globalThemeId,
    systemPrompt: globalSystemPrompt,
  } = useStore()

  const currentSession = sessions?.find(s => s.id === currentSessionId)
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [localName, setLocalName] = useState('')
  const [localSignature, setLocalSignature] = useState('')
  const [localSystemPrompt, setLocalSystemPrompt] = useState('')
  const [localAvatar, setLocalAvatar] = useState('')
  const [showAvatarUrl, setShowAvatarUrl] = useState(false)
  const avatarFileRef = useRef(null)

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

  useEffect(() => {
    if (!currentSession) return
    setLocalName(currentSession.aiName || '')
    setLocalSignature(currentSession.signature || '')
    setLocalSystemPrompt(currentSession.systemPrompt ?? globalSystemPrompt ?? '')
    setLocalAvatar(currentSession.aiAvatar || '')
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

  const effectiveFontFamily = currentSession.fontFamily ?? 'noto'
  const effectiveFontSize = currentSession.fontSize ?? defaultFontSize
  const memoryOverride = currentSession.memoryEnabled

  const sessionProviderId = currentSession.providerId || selectedProviderId
  const sessionModelId = currentSession.modelId || selectedModelId
  const sessionProvider = providers?.find(p => p.id === sessionProviderId)

  const allFonts = [...FONT_LIST, ...customFonts.map(f => ({ id: f.id, label: f.name }))]

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
      <div className="flex items-center gap-3 px-4 py-3 safe-top flex-shrink-0"
        style={{
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

        {/* Model */}
        <GlassCard icon="🤖" title="供应商与模型">
          <div className="space-y-2">
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>供应商</label>
              <select
                value={sessionProviderId}
                onChange={e => {
                  const p = providers?.find(p => p.id === e.target.value)
                  updateSession(currentSessionId, {
                    providerId: e.target.value,
                    modelId: p?.models?.[0] || '',
                  })
                }}
                style={selectStyle}
              >
                {(providers || []).map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#6a90b8' }}>具体模型</label>
              <select
                value={sessionModelId}
                onChange={e => updateSession(currentSessionId, { modelId: e.target.value })}
                style={selectStyle}
              >
                {(sessionProvider?.models || []).map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
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

        {/* Theme */}
        <GlassCard icon="🎨" title="配色方案">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setSessionTheme(currentSessionId, null)}
              style={chipStyle(currentSession.themeId === null)}
            >
              跟随全局
            </button>
            {THEME_LIST.map(t => (
              <button key={t.id} onClick={() => setSessionTheme(currentSessionId, t.id)}
                style={{ ...chipStyle(currentSession.themeId === t.id), display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.dot, display: 'inline-block' }} />
                {t.label}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Font */}
        <GlassCard icon="🔤" title="字体与字号">
          <div className="flex flex-wrap gap-2 mb-3">
            <button onClick={() => setSessionFont(currentSessionId, null)} style={chipStyle(currentSession.fontFamily === null)}>
              跟随全局
            </button>
            {allFonts.map(f => (
              <button key={f.id} onClick={() => setSessionFont(currentSessionId, f.id)}
                style={chipStyle(effectiveFontFamily === f.id && currentSession.fontFamily !== null)}>
                {f.label}
              </button>
            ))}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm" style={{ color: '#2c5282' }}>字号 {effectiveFontSize}px</span>
              {currentSession.fontSize !== null && (
                <button onClick={() => setSessionFontSize(currentSessionId, null)}
                  className="text-xs" style={{ color: '#7a9cc0', background: 'none', border: 'none', cursor: 'pointer' }}>
                  重置
                </button>
              )}
            </div>
            <input type="range" min="12" max="20" step="1" value={effectiveFontSize}
              onChange={e => setSessionFontSize(currentSessionId, Number(e.target.value))}
              className="w-full" style={{ accentColor: primary, cursor: 'pointer' }} />
            <div className="flex justify-between text-[10px] mt-0.5" style={{ color: '#a0b8d0' }}>
              <span>12px</span><span>16px</span><span>20px</span>
            </div>
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
