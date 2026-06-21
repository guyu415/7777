import { useState, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore, clearAllData, getAllMessages, getMessages, deleteCustomFont } from '../store'
import { putAsset, deleteAsset } from '../services/sync'

import { THEMES } from '../themes'
import MemoryPanel from './MemoryPanel'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(200,220,255,0.4)',
  borderRadius: 14,
  padding: '10px 16px',
  fontSize: 14,
  color: '#2c5282',
  outline: 'none',
  fontFamily: 'inherit',
}

function Toggle({ value, onChange, primary }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative flex-shrink-0 transition-all duration-300"
      style={{
        width: 48, height: 26, borderRadius: 13,
        background: value
          ? `linear-gradient(135deg, ${primary || '#4aacf0'}, ${primary || '#4aacf0'}cc)`
          : 'rgba(180,200,220,0.4)',
        border: 'none', cursor: 'pointer',
        boxShadow: value ? `0 2px 8px ${primary || '#4aacf0'}55` : 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: 3, width: 20, height: 20, borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        transition: 'left 0.25s ease-in-out',
        left: value ? 25 : 3,
      }} />
    </button>
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

const FONT_LIST = [
  { id: 'noto', label: '思源黑体', family: "'Noto Sans SC', 'PingFang SC', sans-serif" },
  { id: 'zcool', label: '站酷小薇', family: "'ZCOOL XiaoWei', serif" },
  { id: 'mashan', label: '马善政楷体', family: "'Ma Shan Zheng', cursive" },
]

const THEME_LIST = [
  { id: 'pink', label: '粉色甜心', dot: '#ff85b3' },
  { id: 'mint', label: '薄荷清新', dot: '#5cc8a0' },
  { id: 'skyblue', label: '天蓝清爽', dot: '#4aacf0' },
  { id: 'lavender', label: '薰衣草紫', dot: '#9b7fd4' },
]

export default function GlobalSettings({ theme, onLogout, onForceSync }) {
  const {
    themeId, setChatTheme,
    fontFamily, setFontFamily,
    defaultFontSize, setDefaultFontSize,
    customFonts, addCustomFont, removeCustomFont,
    memoryEnabled, setMemoryEnabled,
    workerUrl, setWorkerUrl,
    useWorkerProxy, setUseWorkerProxy,
    aiVoiceEnabled, setAiVoiceEnabled,
    aiVoiceFrequency, setAiVoiceFrequency,
    acWorkerUrl, setAcWorkerUrl,
    sessions,
  } = useStore()
  const [syncing, setSyncing] = useState(false)

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'
  const fontFileRef = useRef(null)

  const chipStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
    border: active ? `1.5px solid ${primary}` : '1.5px solid rgba(200,220,255,0.4)',
    background: active ? `${primary}22` : 'rgba(255,255,255,0.4)',
    color: active ? primaryDark : '#6a90b8',
    fontWeight: active ? 600 : 400,
  })

  const handleImportFont = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const name = file.name.replace(/\.[^.]+$/, '')
    const family = `custom-${genId()}`
    try {
      const ab = await file.arrayBuffer()
      const blob = new Blob([ab], { type: file.type || 'font/ttf' })
      const id = genId()
      const password = localStorage.getItem('auth.password')

      let fontUrl
      let assetKey = null
      if (password) {
        assetKey = `asset:font:${id}`
        fontUrl = await putAsset(password, assetKey, blob) // uploads to KV, returns data URL
      } else {
        fontUrl = URL.createObjectURL(blob)
      }

      const fontFace = new FontFace(family, `url(${fontUrl})`)
      await fontFace.load()
      document.fonts.add(fontFace)
      addCustomFont({ id, name, family, assetKey })
      setFontFamily(id)
    } catch (err) {
      alert('字体加载失败：' + err.message)
    }
  }

  const handleRemoveFont = async (font) => {
    const password = localStorage.getItem('auth.password')
    if (font.assetKey && password) {
      try { await deleteAsset(password, font.assetKey) } catch {}
    }
    await deleteCustomFont(font.id)
    removeCustomFont(font.id)
  }

  const handleExportAllJSON = async () => {
    const allMsgs = await getAllMessages()
    const data = { sessions, messages: allMsgs }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `all-chats-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleExportAllTxt = async () => {
    let text = ''
    for (const sess of (sessions || [])) {
      const msgs = await getMessages(sess.id)
      msgs.sort((a, b) => a.timestamp - b.timestamp)
      text += `== ${sess.name} ==\n`
      for (const msg of msgs) {
        const time = new Date(msg.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
        const role = msg.role === 'user' ? '我' : 'AI'
        const content = msg.type === 'text' ? msg.content : msg.type === 'voice' ? '[语音消息]' : '[图片]'
        text += `[${time}] ${role}: ${content}\n`
      }
      text += '\n'
    }
    const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `all-chats-${new Date().toISOString().slice(0, 10)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)',
          paddingBottom: 12,
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(200,220,255,0.25)',
          boxShadow: '0 2px 12px rgba(74,172,240,0.08)',
        }}>
        <span className="font-semibold text-sm" style={{ color: '#2c5282' }}>全局设置</span>
        <span className="text-lg">⚙️</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

        {/* Worker Proxy */}
        <GlassCard icon="☁️" title="Worker 配置">
          <p className="text-xs mb-2" style={{ color: '#7a9cc0' }}>
            填入 scheduled-message-worker 的部署地址。启用代理后，所有 API 请求经由 Worker 转发，国内无需翻墙。
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
              <span className="text-sm" style={{ color: '#2c5282' }}>通过 Worker 代理 API 请求</span>
              <p className="text-xs mt-0.5" style={{ color: '#7a9cc0' }}>前端 → Worker → 中转API，国内可用</p>
            </div>
            <Toggle value={useWorkerProxy} onChange={setUseWorkerProxy} primary={primary} />
          </div>
          <div className="flex items-center justify-between mt-3">
            <div>
              <span className="text-sm" style={{ color: '#2c5282' }}>全局记忆注入</span>
              <p className="text-xs mt-0.5" style={{ color: '#7a9cc0' }}>可在会话设置中单独覆盖</p>
            </div>
            <Toggle value={memoryEnabled} onChange={setMemoryEnabled} primary={primary} />
          </div>
        </GlassCard>

        {workerUrl && (
          <GlassCard icon="🧠" title="记忆管理">
            <MemoryPanel workerUrl={workerUrl} />
          </GlassCard>
        )}

        {/* AC Control */}
        <GlassCard icon="❄️" title="空调控制">
          <p className="text-xs mb-2" style={{ color: '#7a9cc0' }}>AI 将根据对话自动控制空调。留空则禁用。</p>
          <input value={acWorkerUrl} onChange={e => setAcWorkerUrl(e.target.value)}
            placeholder="https://ac.xiaoman.xyz" style={inputStyle} />
        </GlassCard>

        {/* Default theme */}
        <GlassCard icon="🎨" title="默认配色方案">
          <p className="text-xs mb-2" style={{ color: '#7a9cc0' }}>新建会话时继承此配色。</p>
          <div className="flex flex-wrap gap-2">
            {THEME_LIST.map(t => (
              <button key={t.id} onClick={() => setChatTheme(t.id)}
                style={{ ...chipStyle(themeId === t.id), display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: t.dot, display: 'inline-block', boxShadow: `0 0 4px ${t.dot}88` }} />
                {t.label}
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Font */}
        <GlassCard icon="🔤" title="字体">
          <div className="flex flex-wrap gap-2 mb-3">
            {FONT_LIST.map(f => (
              <button key={f.id} onClick={() => setFontFamily(f.id)}
                style={{ ...chipStyle(fontFamily === f.id), fontFamily: f.family }}>
                {f.label}
              </button>
            ))}
            {customFonts.map(f => (
              <div key={f.id} className="flex items-center gap-1">
                <button onClick={() => setFontFamily(f.id)}
                  style={{ ...chipStyle(fontFamily === f.id), fontFamily: f.family }}>
                  {f.name}
                </button>
                <button onClick={() => handleRemoveFont(f)} className="text-xs" style={{ color: '#e07070' }}>×</button>
              </div>
            ))}
          </div>
          <button
            onClick={() => fontFileRef.current?.click()}
            className="w-full py-2 rounded-full text-sm transition-all duration-200"
            style={{ background: 'rgba(74,172,240,0.08)', color: '#6a90b8', border: '1px dashed rgba(74,172,240,0.35)' }}
          >
            + 导入自定义字体 (.ttf / .woff2)
          </button>
          <input ref={fontFileRef} type="file" accept=".ttf,.woff2,.woff,.otf" className="hidden" onChange={handleImportFont} />

          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm" style={{ color: '#2c5282' }}>默认字号</span>
              <span className="text-xs" style={{ color: '#6a90b8' }}>{defaultFontSize}px</span>
            </div>
            <input type="range" min="12" max="20" step="1" value={defaultFontSize}
              onChange={e => setDefaultFontSize(Number(e.target.value))}
              className="w-full" style={{ accentColor: primary, cursor: 'pointer' }} />
            <div className="flex justify-between text-[10px] mt-0.5" style={{ color: '#a0b8d0' }}>
              <span>12px</span><span>16px</span><span>20px</span>
            </div>
          </div>
        </GlassCard>

        {/* Export all */}
        <GlassCard icon="📤" title="导出所有对话">
          <p className="text-xs mb-3" style={{ color: '#7a9cc0' }}>
            导出全部会话的聊天记录。单个会话的导出在会话设置里。
          </p>
          <div className="flex gap-2">
            <button onClick={handleExportAllJSON}
              className="flex-1 py-2.5 rounded-full text-sm font-medium text-white transition-all duration-200"
              style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, boxShadow: `0 4px 12px ${primary}40`, border: 'none' }}>
              导出 JSON
            </button>
            <button onClick={handleExportAllTxt}
              className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200"
              style={{ background: 'rgba(255,255,255,0.6)', color: '#6a90b8', border: '1px solid rgba(200,220,255,0.4)' }}>
              导出 TXT
            </button>
          </div>
        </GlassCard>

        {/* Account */}
        <GlassCard icon="👤" title="账号">
          <p className="text-xs mb-3" style={{ color: '#7a9cc0' }}>
            退出后将清除本地登录状态，云端配置保留。下次重新输入密码即可恢复。
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { if (confirm('确定退出登录？')) onLogout?.() }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition-all duration-200"
              style={{ background: 'rgba(100,100,255,0.08)', color: '#6a90b8', border: '1px solid rgba(100,100,255,0.2)' }}
            >
              退出登录
            </button>
            <button
              disabled={syncing}
              onClick={async () => {
                if (!confirm('将重新把本地所有会话消息上传到云端，确定？')) return
                localStorage.removeItem('msgSyncV1')
                setSyncing(true)
                try { await onForceSync?.() } finally { setSyncing(false) }
              }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition-all duration-200"
              style={{
                background: syncing ? 'rgba(60,120,220,0.05)' : 'rgba(60,120,220,0.10)',
                color: syncing ? '#a0b8d0' : '#4a80c0',
                border: '1px solid rgba(60,120,220,0.2)',
                cursor: syncing ? 'default' : 'pointer',
              }}
            >
              {syncing ? '上传中...' : '强制重新同步到云端'}
            </button>
          </div>
        </GlassCard>

        {/* Danger */}
        <GlassCard icon="⚠️" title="危险操作">
          <button
            onClick={async () => {
              if (confirm('确定要清空所有聊天记录吗？此操作不可撤销。')) {
                await clearAllData()
                window.location.reload()
              }
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition-all duration-200"
            style={{ background: 'rgba(255,100,100,0.08)', color: '#e07070', border: '1px solid rgba(255,100,100,0.2)' }}
          >
            <Trash2 size={14} />
            清空所有聊天记录
          </button>
        </GlassCard>
      </div>
    </div>
  )
}
