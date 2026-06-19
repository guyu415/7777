import { useState, useRef } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useStore, clearAllData, getAllMessages } from '../store'
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

function formatDate(ts) {
  return new Date(ts).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}

function roleLabel(role) {
  return role === 'user' ? '我' : 'AI'
}

export default function SettingsPage() {
  const {
    systemPrompt, setSystemPrompt,
    memoryEnabled, setMemoryEnabled,
    workerUrl, setWorkerUrl,
    userAvatar, setUserAvatar,
    aiAvatar, setAiAvatar,
    aiName, setAiName,
    setCurrentView,
    sessions,
  } = useStore()

  const [saved, setSaved] = useState(false)

  const handleSave = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
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
        <GlassCard icon="☁️" title="Worker 配置">
          <p className="text-xs mb-2" style={{ color: '#d4a0b0' }}>
            填入 scheduled-message-worker 的部署地址，记忆存储和主动消息均通过此 Worker 访问 KV。
          </p>
          <input
            type="url"
            value={workerUrl}
            onChange={e => setWorkerUrl(e.target.value)}
            placeholder="https://scheduled-message-worker.your-subdomain.workers.dev"
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
        </GlassCard>

        {workerUrl && (
          <GlassCard icon="🧠" title="记忆管理">
            <MemoryPanel workerUrl={workerUrl} />
          </GlassCard>
        )}

        {/* Export */}
        <GlassCard icon="📤" title="导出记录">
          <div className="flex gap-2">
            <button
              onClick={handleExportJSON}
              className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
              style={{
                background: 'linear-gradient(135deg, #ff85b3, #ff6b9d)',
                color: '#fff',
                boxShadow: '0 4px 12px rgba(255,133,179,0.35)',
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
