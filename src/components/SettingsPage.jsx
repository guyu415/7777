import { useState, useRef } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useStore, clearAllData, getAllMessages } from '../store'
import { THEMES } from '../themes'
import MemoryPanel from './MemoryPanel'
import ProviderSettings from './ProviderSettings'

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,182,209,0.35)',
  borderRadius: 14,
  padding: '10px 16px',
  fontSize: 14,
  color: '#8b5060',
  outline: 'none',
  transition: 'all 0.25s ease-in-out',
  fontFamily: 'inherit',
}

function AvatarUpload({ label, value, onChange, defaultEmoji }) {
  const ref = useRef(null)
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onChange(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => ref.current?.click()}
        className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-3xl transition-all duration-300"
        style={{
          background: 'rgba(255,182,209,0.3)',
          border: '2px dashed rgba(255,133,179,0.4)',
          boxShadow: '0 4px 12px rgba(255,133,179,0.15)',
        }}
      >
        {value
          ? <img src={value} alt="" className="w-full h-full object-cover" />
          : defaultEmoji}
      </button>
      <span className="text-xs" style={{ color: '#c47a8a' }}>{label}</span>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

function ImageUpload({ value, onChange }) {
  const ref = useRef(null)
  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => onChange(reader.result)
    reader.readAsDataURL(file)
    e.target.value = ''
  }
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => ref.current?.click()}
        className="w-full py-2.5 rounded-full text-sm font-medium transition-all duration-300"
        style={{
          background: value ? 'rgba(92,200,160,0.15)' : 'rgba(255,182,209,0.2)',
          border: '1px dashed rgba(255,133,179,0.4)',
          color: '#c47a8a',
        }}
      >
        {value ? '✓ 已选图片（点击更换）' : '📁 上传背景图片'}
      </button>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

function formatDate(ts) {
  return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

function roleLabel(role) {
  return role === 'user' ? '我' : 'AI'
}

const THEME_LIST = [
  { id: 'pink', label: '粉色甜心', dot: '#ff85b3' },
  { id: 'mint', label: '薄荷清新', dot: '#5cc8a0' },
  { id: 'milktea', label: '奶茶暖棕', dot: '#c8956c' },
  { id: 'lavender', label: '薰衣草紫', dot: '#9b7fd4' },
]

const FONT_LIST = [
  { id: 'noto', label: '思源黑体', sample: 'Aa' },
  { id: 'zcool', label: '站酷小薇', sample: 'Aa' },
  { id: 'mashan', label: '马善政楷体', sample: 'Aa' },
]

const FONT_MAP = {
  noto: "'Noto Sans SC', 'PingFang SC', -apple-system, sans-serif",
  zcool: "'ZCOOL XiaoWei', serif",
  mashan: "'Ma Shan Zheng', cursive",
}

export default function SettingsPage({ theme }) {
  const {
    systemPrompt, setSystemPrompt,
    memoryEnabled, setMemoryEnabled,
    workerUrl, setWorkerUrl,
    userAvatar: globalUserAvatar, setUserAvatar,
    aiAvatar: globalAiAvatar, setAiAvatar,
    aiName: globalAiName, setAiName,
    themeId, setChatTheme,
    chatBg, setChatBg,
    fontFamily, setFontFamily,
    ttsApiKey, setTtsApiKey,
    ttsGroupId, setTtsGroupId,
    ttsVoiceId, setTtsVoiceId,
    aiVoiceEnabled, setAiVoiceEnabled,
    aiVoiceFrequency, setAiVoiceFrequency,
    acWorkerUrl, setAcWorkerUrl,
    setCurrentView,
    sessions, currentSessionId, updateSession,
    setSessionAiName, setSessionAiAvatar, setSessionUserAvatar, setSessionSignature,
  } = useStore()

  const currentSession = sessions?.find(s => s.id === currentSessionId)
  const effectiveAiName = currentSession?.aiName ?? globalAiName
  const effectiveAiAvatar = currentSession?.aiAvatar ?? globalAiAvatar
  const effectiveUserAvatar = currentSession?.userAvatar ?? globalUserAvatar

  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  // Per-session avatar/name handlers (also update global as default)
  const handleUserAvatarChange = (v) => {
    setUserAvatar(v)
    if (currentSessionId) setSessionUserAvatar(currentSessionId, v)
  }
  const handleAiAvatarChange = (v) => {
    setAiAvatar(v)
    if (currentSessionId) setSessionAiAvatar(currentSessionId, v)
  }
  const handleAiNameChange = (name) => {
    setAiName(name)
    if (currentSessionId) setSessionAiName(currentSessionId, name)
  }

  const handleExportJSON = async () => {
    const allMsgs = await getAllMessages()
    const bySession = {}
    for (const msg of allMsgs) {
      const sid = msg.conversationId || 'main'
      if (!bySession[sid]) bySession[sid] = []
      bySession[sid].push(msg)
    }
    const data = (sessions || []).map(s => ({
      session: s,
      messages: (bySession[s.id] || []).sort((a, b) => a.timestamp - b.timestamp),
    }))
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const d = new Date().toISOString().slice(0, 10)
    a.download = `chat-export-${d}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportTxt = async () => {
    const allMsgs = await getAllMessages()
    const bySession = {}
    for (const msg of allMsgs) {
      const sid = msg.conversationId || 'main'
      if (!bySession[sid]) bySession[sid] = []
      bySession[sid].push(msg)
    }
    let text = ''
    for (const session of (sessions || [])) {
      text += `== ${session.name} ==\n`
      const msgs = (bySession[session.id] || []).sort((a, b) => a.timestamp - b.timestamp)
      for (const msg of msgs) {
        const time = formatDate(msg.timestamp)
        const role = roleLabel(msg.role)
        const content = msg.type === 'text' ? msg.content : '[图片]'
        text += `[${time}] ${role}: ${content}\n`
      }
      text += '\n'
    }
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    const d = new Date().toISOString().slice(0, 10)
    a.download = `chat-export-${d}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  const currentTheme = THEMES[themeId] || THEMES.pink

  const chipBtnStyle = (active) => ({
    padding: '6px 14px',
    borderRadius: 20,
    fontSize: 13,
    border: active ? `1.5px solid ${currentTheme.primary}` : '1.5px solid rgba(255,182,209,0.3)',
    background: active ? `${currentTheme.primary}22` : 'rgba(255,255,255,0.4)',
    color: active ? currentTheme.primaryDark : '#c47a8a',
    cursor: 'pointer',
    transition: 'all 0.2s',
    fontWeight: active ? 600 : 400,
  })

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 safe-top"
        style={{
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(255,182,209,0.2)',
          boxShadow: '0 2px 16px rgba(255,133,179,0.08)',
        }}>
        <button
          onClick={() => setCurrentView('chat')}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all duration-300"
          style={{ background: 'rgba(255,182,209,0.3)', color: '#c47a8a' }}
        >
          <ArrowLeft size={18} />
        </button>
        <span className="font-semibold text-sm" style={{ color: '#8b5060' }}>设置</span>
        <span className="ml-auto text-lg">✿</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Avatars + Name + Signature */}
        <GlassCard icon="🎨" title="会话信息">
          <div className="flex justify-around pt-1">
            <AvatarUpload label="我的头像" value={effectiveUserAvatar} onChange={handleUserAvatarChange} defaultEmoji="🐣" />
            <div className="w-px" style={{ background: 'rgba(255,182,209,0.3)' }} />
            <AvatarUpload label="AI头像" value={effectiveAiAvatar} onChange={handleAiAvatarChange} defaultEmoji="🌸" />
          </div>
          <div className="mt-3">
            <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>AI 名字</label>
            <input
              value={effectiveAiName}
              onChange={e => handleAiNameChange(e.target.value)}
              placeholder="小满"
              style={inputStyle}
            />
          </div>
          <div className="mt-3">
            <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>签名</label>
            <input
              value={currentSession?.signature ?? ''}
              onChange={e => currentSessionId && setSessionSignature(currentSessionId, e.target.value)}
              placeholder="小满一直在这里等你～"
              style={inputStyle}
            />
          </div>
        </GlassCard>

        {/* Theme */}
        <GlassCard icon="🎨" title="主题配色">
          <div className="flex flex-wrap gap-2 pt-1">
            {THEME_LIST.map(t => (
              <button
                key={t.id}
                onClick={() => setChatTheme(t.id)}
                style={{
                  ...chipBtnStyle(themeId === t.id),
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: t.dot, display: 'inline-block', flexShrink: 0,
                  boxShadow: `0 0 4px ${t.dot}88`,
                }} />
                {t.label}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Font */}
        <GlassCard icon="🔤" title="字体">
          <div className="flex flex-wrap gap-2 pt-1">
            {FONT_LIST.map(f => (
              <button
                key={f.id}
                onClick={() => setFontFamily(f.id)}
                style={{
                  ...chipBtnStyle(fontFamily === f.id),
                  fontFamily: FONT_MAP[f.id],
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Chat Background */}
        <GlassCard icon="🖼️" title="聊天背景">
          {/* Type chips */}
          <div className="flex gap-2 mb-3">
            {[{ v: 'gradient', l: '渐变' }, { v: 'color', l: '纯色' }, { v: 'image', l: '图片' }].map(({ v, l }) => (
              <button
                key={v}
                onClick={() => setChatBg({ ...(chatBg || {}), type: v })}
                style={chipBtnStyle((chatBg?.type || 'gradient') === v)}
              >
                {l}
              </button>
            ))}
          </div>

          {/* Color picker */}
          {chatBg?.type === 'color' && (
            <div className="flex items-center gap-3 mb-3">
              <label className="text-xs" style={{ color: '#c47a8a' }}>背景颜色</label>
              <input
                type="color"
                value={chatBg?.value || '#fce4ec'}
                onChange={e => setChatBg({ ...chatBg, value: e.target.value })}
                style={{ width: 40, height: 28, borderRadius: 8, border: '1px solid rgba(255,182,209,0.3)', cursor: 'pointer', padding: 2 }}
              />
              <span className="text-xs" style={{ color: '#d4a0b0' }}>{chatBg?.value || '#fce4ec'}</span>
            </div>
          )}

          {/* Image upload */}
          {chatBg?.type === 'image' && (
            <div className="mb-3">
              <ImageUpload
                value={chatBg?.value}
                onChange={(v) => setChatBg({ ...chatBg, value: v })}
              />
            </div>
          )}

          {/* Opacity slider */}
          <div className="flex items-center gap-3">
            <label className="text-xs flex-shrink-0" style={{ color: '#c47a8a' }}>不透明度</label>
            <input
              type="range"
              min="0" max="1" step="0.05"
              value={chatBg?.opacity ?? 1.0}
              onChange={e => setChatBg({ ...(chatBg || {}), opacity: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: currentTheme.primary }}
            />
            <span className="text-xs w-8 text-right" style={{ color: '#d4a0b0' }}>
              {Math.round((chatBg?.opacity ?? 1.0) * 100)}%
            </span>
          </div>
        </GlassCard>

        {/* Provider Settings */}
        <GlassCard icon="🤖" title="模型与供应商">
          <ProviderSettings />
        </GlassCard>

        {/* System Prompt */}
        <GlassCard icon="💬" title="系统提示词">
          <textarea
            value={systemPrompt}
            onChange={e => setSystemPrompt(e.target.value)}
            rows={4}
            placeholder="描述 AI 的性格和行为..."
            style={{ ...inputStyle, resize: 'none', lineHeight: '1.6' }}
          />
        </GlassCard>

        {/* Worker + Memory */}
        {/* AC Control */}
        <GlassCard icon="❄️" title="空调控制">
          <div className="space-y-2">
            <p className="text-xs px-1" style={{ color: '#d4a0b0' }}>
              填入空调 Worker 地址，AI 将根据对话自动控制空调。留空则禁用。
            </p>
            <input
              value={acWorkerUrl}
              onChange={e => setAcWorkerUrl(e.target.value)}
              placeholder="https://ac.xiaoman.xyz"
              style={inputStyle}
            />
          </div>
        </GlassCard>

        <GlassCard icon="☁️" title="Worker 配置">
          <p className="text-xs mb-2" style={{ color: '#d4a0b0' }}>
            填入 scheduled-message-worker 的部署地址，记忆存储和主动消息均通过此 Worker 访问 KV。
          </p>
          <input
            type="url"
            value={workerUrl}
            onChange={e => setWorkerUrl(e.target.value)}
            placeholder="https://chat.xiaoman.xyz"
            style={inputStyle}
          />
          <div className="flex items-center justify-between mt-3">
            <div>
              <span className="text-sm" style={{ color: '#8b5060' }}>启用记忆注入</span>
              <p className="text-xs mt-0.5" style={{ color: '#d4a0b0' }}>每次回复前从 KV 读取相关记忆</p>
            </div>
            <button
              onClick={() => setMemoryEnabled(!memoryEnabled)}
              className="relative flex-shrink-0 transition-all duration-300"
              style={{
                width: 48, height: 26, borderRadius: 13,
                background: memoryEnabled
                  ? `linear-gradient(135deg, ${currentTheme.primary}, ${currentTheme.primaryDark})`
                  : 'rgba(210,180,195,0.4)',
                border: 'none', cursor: 'pointer',
                boxShadow: memoryEnabled ? `0 2px 8px ${currentTheme.primary}66` : 'none',
              }}
            >
              <div style={{
                position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                transition: 'left 0.25s ease-in-out',
                left: memoryEnabled ? 25 : 3,
              }} />
            </button>
          </div>
        </GlassCard>

        {workerUrl && (
          <GlassCard icon="🧠" title="记忆管理">
            <MemoryPanel workerUrl={workerUrl} />
          </GlassCard>
        )}

        {/* AI Voice */}
        <GlassCard icon="🎙️" title="AI 语音消息 (MiniMax TTS)">
          <div className="space-y-2">
            <p className="text-xs px-1" style={{ color: '#d4a0b0' }}>
              配置后 AI 会自主判断是否用语音条回复，语音条可播放并可折叠查看原文。
            </p>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>API Key</label>
              <input
                type="password"
                value={ttsApiKey}
                onChange={e => setTtsApiKey(e.target.value)}
                placeholder="MiniMax API Key"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>Group ID</label>
              <input
                value={ttsGroupId}
                onChange={e => setTtsGroupId(e.target.value)}
                placeholder="MiniMax Group ID"
                style={inputStyle}
              />
            </div>
            <div>
              <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>音色 ID</label>
              <input
                value={ttsVoiceId}
                onChange={e => setTtsVoiceId(e.target.value)}
                placeholder="English_Trustworthy_Man"
                style={inputStyle}
              />
            </div>
            <div className="flex items-center justify-between px-1 pt-1">
              <div>
                <span className="text-sm" style={{ color: '#8b5060' }}>AI 语音消息</span>
                <p className="text-xs mt-0.5" style={{ color: '#d4a0b0' }}>关闭后 AI 仅用文字回复</p>
              </div>
              <button
                onClick={() => setAiVoiceEnabled(!aiVoiceEnabled)}
                className="w-12 h-6 rounded-full transition-all duration-300 relative flex-shrink-0"
                style={{ background: aiVoiceEnabled ? 'linear-gradient(135deg, #ff85b3, #ff6b9d)' : 'rgba(210,180,195,0.3)' }}
              >
                <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 transition-all duration-300"
                  style={{ left: aiVoiceEnabled ? 26 : 2, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }} />
              </button>
            </div>
            <div className="px-1 pt-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm" style={{ color: '#8b5060' }}>语音频率</span>
                <span className="text-xs" style={{ color: '#c47a8a' }}>
                  {aiVoiceFrequency < 0.3 ? '少发语音' : aiVoiceFrequency > 0.7 ? '多发语音' : '适中'}
                </span>
              </div>
              <input
                type="range" min="0" max="1" step="0.1"
                value={aiVoiceFrequency}
                onChange={e => setAiVoiceFrequency(parseFloat(e.target.value))}
                className="w-full accent-pink-400"
                style={{ cursor: 'pointer' }}
              />
              <div className="flex justify-between text-[10px] mt-0.5" style={{ color: '#d4a0b0' }}>
                <span>少</span><span>适中</span><span>多</span>
              </div>
            </div>
          </div>
        </GlassCard>

        {/* Export */}
        <GlassCard icon="📤" title="导出记录">
          <div className="flex gap-2">
            <button
              onClick={handleExportJSON}
              className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
              style={{
                background: `linear-gradient(135deg, ${currentTheme.primary}, ${currentTheme.primaryDark})`,
                color: '#fff',
                boxShadow: `0 4px 12px ${currentTheme.primary}59`,
                border: 'none',
              }}
            >
              导出 JSON
            </button>
            <button
              onClick={handleExportTxt}
              className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
              style={{
                background: 'rgba(255,255,255,0.6)',
                color: '#c47a8a',
                border: '1px solid rgba(255,182,209,0.35)',
              }}
            >
              导出 TXT
            </button>
          </div>
        </GlassCard>

        {/* Danger */}
        <GlassCard icon="⚠️" title="危险操作">
          <button
            onClick={async () => {
              if (confirm('确定要清空所有聊天记录吗？')) {
                await clearAllData()
                window.location.reload()
              }
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition-all duration-300"
            style={{
              background: 'rgba(255,100,100,0.1)',
              color: '#e07070',
              border: '1px solid rgba(255,100,100,0.2)',
            }}
          >
            <Trash2 size={14} />
            清空聊天记录
          </button>
        </GlassCard>
      </div>

      {/* Save */}
      <div className="px-4 pb-6 pt-3 safe-bottom">
        <button
          onClick={handleSave}
          className="w-full py-3 rounded-full font-semibold text-sm text-white transition-all duration-300"
          style={saved ? {
            background: 'linear-gradient(135deg, #6dcf90, #4db875)',
            boxShadow: '0 6px 20px rgba(100,200,130,0.4)',
          } : {
            background: `linear-gradient(135deg, ${currentTheme.primary}, ${currentTheme.primaryDark}, ${currentTheme.primary})`,
            boxShadow: `0 6px 20px ${currentTheme.primary}73`,
          }}
        >
          {saved ? '✅ 已保存' : '保存设置 ✿'}
        </button>
      </div>
    </div>
  )
}

function GlassCard({ icon, title, children }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.42)',
      backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
      borderRadius: 20,
      padding: 16,
      border: '1px solid rgba(255,182,209,0.22)',
      boxShadow: '0 4px 20px rgba(255,133,179,0.07)',
    }}>
      <div className="flex items-center gap-2 mb-3">
        <span>{icon}</span>
        <span className="font-medium text-sm" style={{ color: '#8b5060' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}
