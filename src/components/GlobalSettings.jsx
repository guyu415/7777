import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { useStore, getAllMessages, getMessages, deleteCustomFont, saveAssetCache } from '../store'
import { putAsset, deleteAsset } from '../services/sync'
import { pushSupportState, getCurrentSubscription, subscribePush, unsubscribePush, sendTestPush } from '../services/push'

import { THEMES } from '../themes'
import MemoryPanel from './MemoryPanel'

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.56)',
  border: 'none',
  borderRadius: '15px 20px 16px 18px',
  padding: '10px 16px',
  fontSize: 14,
  color: '#2c5282',
  outline: 'none',
  fontFamily: 'inherit',
}

// `compact` only shrinks the physical footprint (used inside the crocodile card,
// whose mouth is much flatter than the hippo's) — same value/onChange/primary
// contract, every other call site is untouched.
function Toggle({ value, onChange, primary, compact }) {
  const w = compact ? 36 : 48, h = compact ? 20 : 26, dot = compact ? 14 : 20, pad = 3
  return (
    <button
      onClick={() => onChange(!value)}
      className="relative flex-shrink-0 transition-all duration-300"
      style={{
        width: w, height: h, borderRadius: h / 2,
        background: value
          ? `linear-gradient(135deg, ${primary || '#4aacf0'}, ${primary || '#4aacf0'}cc)`
          : 'rgba(180,200,220,0.4)',
        border: 'none', cursor: 'pointer',
        boxShadow: value ? `0 2px 8px ${primary || '#4aacf0'}55` : 'none',
      }}
    >
      <div style={{
        position: 'absolute', top: pad, width: dot, height: dot, borderRadius: '50%',
        background: '#fff',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
        transition: 'left 0.25s ease-in-out',
        left: value ? w - dot - pad : pad,
      }} />
    </button>
  )
}

// Decorative animal-mouth frame card (hippo/crocodile), cropped from a hand-drawn
// design mockup. Layers, in DOM/paint order:
//   1. animal-wrapper — pure placeholder box, position: relative + z-index so
//      it always paints above ordinary in-flow siblings (padding-top keeps its
//      height stable across browsers even before the image loads — plain
//      `aspect-ratio` on the box itself does not reliably give percentage-
//      positioned descendants a definite height on real-device WebKit, which
//      is why content used to render clipped/misplaced on an iPhone despite
//      looking fine in a desktop preview). overflow: visible so the animal
//      itself — ears, eyes, tail, all of it — is never cropped by this box.
//   2. the animal image — width/height 100%, objectFit: contain.
//   3. an oval tint, NOT the old opaque rounded-rectangle "settings card" —
//      barely-there fill, `pad`-sized and border-radius: 50% so it reads as an
//      oval sitting inside the mouth rather than a card pasted over it.
//   4. the actual text/toggle/button content, unclipped and laid out with the
//      SAME `pad` rectangle (measured off each PNG's real alpha-channel hole,
//      per-animal, not a shared guess) — kept as a plain rectangle rather than
//      the mouth's exact jagged tooth-by-tooth outline, because clipping a
//      flexed, multi-line paragraph to that jagged shape chops text mid-line
//      wherever a tooth notch happens to land (tried it, real bug, reverted).
function FrameCard({ frameSrc, w, h, pad, icon, title, titleSize = 11.5, iconSize = 13, children }) {
  return (
    <div className="animal-wrapper relative w-full" style={{ overflow: 'visible', zIndex: 1 }}>
      <div style={{ width: '100%', paddingTop: `${(h / w) * 100}%` }} />
      <img src={frameSrc} alt="" draggable={false}
        className="absolute top-0 left-0 w-full h-full pointer-events-none select-none"
        style={{ objectFit: 'contain' }} />
      {/* `pad` is spread as top/right/bottom/left INSET properties (an
          absolutely-positioned box's own edges), never as `padding`. CSS
          resolves padding-top/bottom percentages against the containing
          block's WIDTH, not its own height — a classic gotcha that silently
          shoved this whole content well downward on the crocodile specifically
          (its image is ~2.1x wider than tall, so a "43.5%" meant-as-height
          padding-top came out ~2x too large once read as a width percentage,
          landing on the lower teeth; the hippo's closer-to-square ratio hid
          the same bug as a smaller, easy-to-miss offset). top/bottom on an
          absolute box correctly resolve against height, left/right against
          width, which is what these numbers were actually measured as. */}
      <div className="absolute rounded-full" style={{ ...pad, background: 'rgba(255,253,248,0.4)' }} />
      {/* text-shadow inherited by every child — there's no opaque card behind
          this text anymore, so it's what keeps small text legible over the
          hand-drawn background showing through. */}
      <div className="absolute flex flex-col justify-center" style={{ ...pad, padding: '2px 4px', textShadow: '0 1px 3px rgba(255,255,255,0.9), 0 0px 6px rgba(255,255,255,0.7)' }}>
        <div className="flex items-center gap-1.5 flex-shrink-0" style={{ marginBottom: 2 }}>
          <span style={{ fontSize: iconSize, lineHeight: 1 }}>{icon}</span>
          <span className="font-semibold" style={{ color: '#2c5282', fontSize: titleSize, lineHeight: 1 }}>{title}</span>
        </div>
        {children}
      </div>
    </div>
  )
}

// Measured off each cropped PNG's own alpha channel (largest enclosed
// transparent region inside the mouth, not eyeballed) — see
// public/assets/hippo-frame.png (448x300) and croc-frame.png (476x228).
// Deliberately not shared: the hippo's mouth is a tall oval; the crocodile's
// is a flat tapering sliver at a different offset entirely.
const HIPPO_PAD = { top: '42%', bottom: '27%', left: '19%', right: '18%' }
const CROC_PAD = { top: '43.5%', bottom: '30.5%', left: '27%', right: '21%' }

function GlassCard({ icon, title, children }) {
  return (
    <div className="forest-settings-card" style={{
      background: 'rgba(255,255,255,0.48)',
      backdropFilter: 'blur(9px)',
      WebkitBackdropFilter: 'blur(9px)',
      borderRadius: '28px 20px 31px 19px',
      padding: 16,
      border: 'none',
      boxShadow: '0 6px 18px rgba(66,88,82,0.06)',
    }}>
      <div className="flex items-center gap-2 mb-3">
        <span>{icon}</span>
        <span className="font-medium text-sm" style={{ color: '#2c5282' }}>{title}</span>
      </div>
      {children}
    </div>
  )
}

// 设备推送通知：只控制 Web Push 是否送到本设备，不控制主动消息生成
// （iOS 需先"添加到主屏幕"并从桌面图标打开，16.4+）
function NotificationCard({ primary }) {
  const [state, setState] = useState('checking') // checking | need-install | unsupported | off | on
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    const support = pushSupportState()
    if (support !== 'supported') { setState(support); return }
    getCurrentSubscription()
      .then(sub => setState(sub ? 'on' : 'off'))
      .catch(() => setState('off'))
  }, [])

  const password = () => localStorage.getItem('auth.password') || ''

  const handleToggle = async (next) => {
    if (busy) return
    setBusy(true)
    setMsg('')
    try {
      if (next) {
        await subscribePush(password())
        setState('on')
        setMsg('已开启，主动消息会推送到这台设备 ✓（不影响消息生成开关）')
      } else {
        await unsubscribePush(password())
        setState('off')
        setMsg('已关闭')
      }
    } catch (e) {
      setMsg(`失败：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    if (busy) return
    setBusy(true)
    setMsg('正在发送测试通知...')
    try {
      const r = await sendTestPush(password())
      setMsg(r.ok ? '测试通知已发出，几秒内应弹出 🔔' : `推送服务返回异常：${JSON.stringify(r.results || r.error).slice(0, 140)}`)
    } catch (e) {
      setMsg(`失败：${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <FrameCard
      frameSrc="/assets/hippo-frame.png"
      w={448} h={300}
      pad={HIPPO_PAD}
      icon="🔔" title="设备推送通知"
    >
      {state === 'need-install' && (
        <p style={{ color: '#7a9cc0', lineHeight: 1.35, fontSize: 9 }}>
          iOS 需先把 Eunoia 添加到主屏幕，再从桌面图标打开后回来开启通知。
        </p>
      )}
      {state === 'unsupported' && (
        <p style={{ color: '#7a9cc0', fontSize: 10 }}>当前浏览器不支持消息推送。</p>
      )}
      {(state === 'on' || state === 'off') && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span style={{ color: '#2c5282', fontSize: 10.5, lineHeight: 1.25 }}>在这台设备接收主动消息</span>
            <Toggle value={state === 'on'} onChange={handleToggle} primary={primary} />
          </div>
          <p style={{ color: '#7a9cc0', fontSize: 8.5, lineHeight: 1.25, marginTop: 1 }}>只控制通知投递，不会关闭主动消息生成</p>
          {state === 'on' && (
            <button
              onClick={handleTest}
              disabled={busy}
              className="w-full rounded-full font-medium flex-shrink-0"
              style={{
                marginTop: 3,
                padding: '3px 0',
                fontSize: 9.5,
                background: `${primary}18`,
                border: `1px solid ${primary}55`,
                color: primary,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              发送测试通知
            </button>
          )}
        </>
      )}
      {msg && <p style={{ color: '#7a9cc0', fontSize: 8.5, lineHeight: 1.2, marginTop: 1 }}>{msg}</p>}
    </FrameCard>
  )
}

// Ordinary API proactive messages are generated by the scheduled-message
// Worker.  This is deliberately not the same thing as Web Push permission:
// the former controls whether the Worker may generate/store a message, while
// the latter only controls delivery to this device.  It is also deliberately
// not the CC switch, which remains in the Claude Code session settings and is
// backed by companion's VPS config.
function ApiProactiveCard({ primary, value, onChange }) {
  return (
    <FrameCard
      frameSrc="/assets/croc-frame.png"
      w={476} h={228}
      pad={CROC_PAD}
      icon="💬" title="普通窗口主动消息"
      iconSize={11} titleSize={10}
    >
      <div className="flex items-center justify-between gap-2">
        <span style={{ color: '#2c5282', fontSize: 9, lineHeight: 1.15 }}>允许接 API 的普通会话主动发消息</span>
        <Toggle value={value} onChange={onChange} primary={primary} compact />
      </div>
      <p style={{ color: '#7a9cc0', fontSize: 6.5, lineHeight: 1.1, marginTop: 0 }}>
        只影响普通 API 会话；CC 的开关仍在 CC 会话设置里，Codex 不会接收这条链路的消息。
      </p>
    </FrameCard>
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
    apiProactiveEnabled, setApiProactiveEnabled,
    aiVoiceEnabled, setAiVoiceEnabled,
    aiVoiceFrequency, setAiVoiceFrequency,
    acWorkerUrl, setAcWorkerUrl,
    sessions,
  } = useStore()
  const [syncing, setSyncing] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'
  const fontFileRef = useRef(null)

  const chipStyle = (active) => ({
    padding: '6px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
    border: 'none',
    background: active ? `${primary}27` : 'rgba(255,255,255,0.46)',
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
        try { await saveAssetCache(assetKey, fontUrl) } catch (e) { console.warn('[FONT] IDB缓存写入失败:', e.message) } // 当场写本地缓存，刷新后零回拉
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
    <div className="global-settings-garden flex flex-col h-full" style={{ background: 'transparent' }}>
      <style>{`
        .global-settings-garden .forest-settings-card:nth-of-type(3n+1){border-radius:29px 19px 27px 22px;transform:rotate(-.2deg)}
        .global-settings-garden .forest-settings-card:nth-of-type(3n+2){border-radius:20px 31px 22px 29px;transform:rotate(.25deg)}
        .global-settings-garden__scroll{scrollbar-width:none}
        .global-settings-garden__scroll::-webkit-scrollbar{display:none}
      `}</style>
      {/* Header */}
      <div className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)',
          paddingBottom: 12,
          background: 'transparent',
        }}>
        <span className="font-semibold text-sm" style={{ color: '#536573' }}>花园设置</span>
        <img src="/assets/whale.png" alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
      </div>

      <div className="global-settings-garden__scroll flex-1 overflow-y-auto px-4 pt-2 space-y-4" style={{ paddingBottom: 72 }}>

        {/* Push notifications */}
        <NotificationCard primary={primary} />

        {/* Ordinary API proactive generation (separate from CC and push) */}
        <ApiProactiveCard
          primary={primary}
          value={apiProactiveEnabled !== false}
          onChange={setApiProactiveEnabled}
        />

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

        {/* Account (常用：退出登录) */}
        <GlassCard icon="👤" title="账号">
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { if (confirm('确定退出登录？')) onLogout?.() }}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition-all duration-200"
              style={{ background: 'rgba(100,100,255,0.08)', color: '#6a90b8', border: '1px solid rgba(100,100,255,0.2)' }}
            >
              退出登录
            </button>
          </div>
        </GlassCard>

        {/* ── 高级设置（默认折叠：低频 / 调试 / 高级配置） ── */}
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-medium transition-all"
          style={{
            background: 'rgba(255,255,255,0.42)',
            border: '1px solid rgba(200,220,255,0.3)',
            color: '#2c5282',
          }}
        >
          <span>⚙️ 高级设置</span>
          <ChevronDown size={16} style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', color: '#7a9cc0' }} />
        </button>

        {showAdvanced && (
          <>
            {/* Worker Proxy */}
            <GlassCard icon="☁️" title="Worker 配置">
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

            {/* 数据同步 */}
            <GlassCard icon="🔄" title="数据同步">
              <p className="text-xs mb-3" style={{ color: '#7a9cc0' }}>
                云端同步异常时使用。将本地所有会话消息重新上传到云端。
              </p>
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
            </GlassCard>

            {/* Summary API key — stored only in localStorage, never synced */}
            <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>
              <SummaryKeyButton />
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SummaryKeyButton() {
  const [open, setOpen] = useState(false)
  const [val, setVal] = useState(() => localStorage.getItem('summary.deepseek.key') || '')
  const [saved, setSaved] = useState(false)
  const hasKey = !!localStorage.getItem('summary.deepseek.key')
  return (
    <>
      <button
        onClick={() => { setOpen(true); setSaved(false) }}
        title="摘要配置"
        style={{
          flexShrink: 0,
          width: 46, height: 46, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: hasKey ? 'linear-gradient(135deg, #7ab4f0, #4a90d0)' : 'rgba(180,200,220,0.35)',
          boxShadow: hasKey ? '0 4px 12px rgba(74,144,208,0.35)' : 'none',
          fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        🔑
      </button>
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: 'rgba(240,246,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 20, padding: '24px 20px', width: 300, boxShadow: '0 8px 32px rgba(80,120,180,0.25)' }}
          >
            <p style={{ fontSize: 15, fontWeight: 600, color: '#2c5282', marginBottom: 6 }}>摘要 API 配置</p>
            <p style={{ fontSize: 12, color: '#7a9cc0', marginBottom: 14 }}>仅存本地，不同步云端，用于长对话自动摘要。</p>
            <input
              type="password"
              value={val}
              autoFocus
              onChange={e => { setVal(e.target.value); setSaved(false) }}
              placeholder="DeepSeek API Key"
              style={{ width: '100%', background: 'rgba(255,255,255,0.8)', border: '1px solid rgba(120,160,220,0.4)', borderRadius: 12, padding: '10px 14px', fontSize: 14, color: '#2c5282', outline: 'none', boxSizing: 'border-box' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={() => setOpen(false)}
                style={{ flex: 1, padding: '9px 0', borderRadius: 12, border: '1px solid rgba(120,160,220,0.3)', background: 'none', color: '#7a9cc0', fontSize: 13, cursor: 'pointer' }}
              >
                取消
              </button>
              <button
                onClick={() => { localStorage.setItem('summary.deepseek.key', val.trim()); setSaved(true); setTimeout(() => setOpen(false), 600) }}
                style={{ flex: 2, padding: '9px 0', borderRadius: 12, border: 'none', cursor: 'pointer', background: saved ? 'linear-gradient(135deg, #6dcf90, #4db875)' : 'linear-gradient(135deg, #7ab4f0, #4a90d0)', color: '#fff', fontSize: 13, fontWeight: 600 }}
              >
                {saved ? '已保存 ✓' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
