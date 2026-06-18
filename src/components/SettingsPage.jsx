import { useState, useRef } from 'react'
import { ArrowLeft, Eye, EyeOff, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { MODEL_LABELS } from '../services/claude'
import clsx from 'clsx'

const MODELS = Object.keys(MODEL_LABELS)

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

const cardStyle = {
  background: 'rgba(255,255,255,0.45)',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  borderRadius: 20,
  padding: '16px',
  border: '1px solid rgba(255,182,209,0.25)',
  boxShadow: '0 4px 20px rgba(255,133,179,0.08)',
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

export default function SettingsPage() {
  const {
    apiKey, setApiKey,
    apiBaseUrl, setApiBaseUrl,
    model, setModel,
    systemPrompt, setSystemPrompt,
    memoryEnabled, setMemoryEnabled,
    memoryEndpoint, setMemoryEndpoint,
    userAvatar, setUserAvatar,
    aiAvatar, setAiAvatar,
    aiName, setAiName,
    setCurrentView,
  } = useStore()

  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 safe-top"
        style={{
          background: 'rgba(255,255,255,0.45)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
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

        {/* Avatars */}
        <GlassCard icon="🎨" title="头像设置">
          <div className="flex justify-around pt-1">
            <AvatarUpload label="我的头像" value={userAvatar} onChange={setUserAvatar} defaultEmoji="🐣" />
            <div className="w-px" style={{ background: 'rgba(255,182,209,0.3)' }} />
            <AvatarUpload label="AI头像" value={aiAvatar} onChange={setAiAvatar} defaultEmoji="🌸" />
          </div>
          <div className="mt-3">
            <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>AI 名字</label>
            <input
              value={aiName}
              onChange={e => setAiName(e.target.value)}
              placeholder="小漫"
              style={inputStyle}
            />
          </div>
        </GlassCard>

        {/* API Key */}
        <GlassCard icon="🔑" title="API 配置">
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              style={{ ...inputStyle, paddingRight: 40 }}
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2"
              style={{ color: '#d4a0b0' }}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <p className="text-xs mt-1.5 pl-1" style={{ color: '#d4a0b0' }}>Key 存储在浏览器本地，不会上传</p>
          <div className="mt-3">
            <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>API Base URL</label>
            <input
              type="url"
              value={apiBaseUrl}
              onChange={e => setApiBaseUrl(e.target.value)}
              placeholder="https://api.anthropic.com"
              style={inputStyle}
            />
            <p className="text-xs mt-1.5 pl-1" style={{ color: '#d4a0b0' }}>可填中转代理地址</p>
          </div>
        </GlassCard>

        {/* Model */}
        <GlassCard icon="🤖" title="模型选择">
          <div className="grid grid-cols-3 gap-2">
            {MODELS.map(m => (
              <button
                key={m}
                onClick={() => setModel(m)}
                className="py-2 px-1 rounded-full text-xs font-medium transition-all duration-300"
                style={model === m ? {
                  background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)',
                  color: '#fff',
                  boxShadow: '0 4px 12px rgba(255,133,179,0.4)',
                  border: 'none',
                } : {
                  background: 'rgba(255,255,255,0.5)',
                  color: '#c47a8a',
                  border: '1px solid rgba(255,182,209,0.3)',
                }}
              >
                {MODEL_LABELS[m]}
              </button>
            ))}
          </div>
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

        {/* Memory */}
        <GlassCard icon="🧠" title="记忆系统">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm" style={{ color: '#8b5060' }}>接入 MCP 记忆库</span>
            <button
              onClick={() => setMemoryEnabled(!memoryEnabled)}
              className="relative transition-all duration-300"
              style={{
                width: 48, height: 26, borderRadius: 13,
                background: memoryEnabled
                  ? 'linear-gradient(135deg, #ff85b3, #ff6b9d)'
                  : 'rgba(210,180,195,0.4)',
                border: 'none', cursor: 'pointer',
                boxShadow: memoryEnabled ? '0 2px 8px rgba(255,133,179,0.4)' : 'none',
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
          {memoryEnabled && (
            <input
              type="url"
              value={memoryEndpoint}
              onChange={e => setMemoryEndpoint(e.target.value)}
              placeholder="https://memory.xiaoman.xyz"
              style={inputStyle}
            />
          )}
        </GlassCard>

        {/* Danger */}
        <GlassCard icon="⚠️" title="危险操作">
          <button
            onClick={() => {
              if (confirm('确定要清空所有聊天记录吗？')) {
                indexedDB.deleteDatabase('pink-chat')
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
            background: 'linear-gradient(135deg, #ff85b3, #ff6b9d, #ff85b3)',
            boxShadow: '0 6px 20px rgba(255,133,179,0.45)',
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
