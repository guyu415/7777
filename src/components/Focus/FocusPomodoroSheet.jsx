import { useState } from 'react'
import { X, ChevronDown, Sparkles } from 'lucide-react'
import { GA_STEPS, GA_DISCLAIMER } from './focusCopy'
import { APPLE_GUIDE_URL } from '../../services/pomodoroCore'

const QUICK_MINUTES = [15, 25, 40, 60]

// The bottom-sheet setup panel opened from the "+" menu's "专注" entry (see
// MessageInput.jsx/ChatWindow.jsx). Purely a form over usePomodoro()'s
// startFocusSession — no timer runs in here; once started, ChatWindow swaps
// this out for FocusSession (the fullscreen countdown), same handoff pattern
// GomokuBoard/VoiceCall already use for their own full-screen takeovers.
export default function FocusPomodoroSheet({ theme, aiName, aiAvatar, onClose, onStart }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const [task, setTask] = useState('')
  const [minutes, setMinutes] = useState(25)
  const [customOpen, setCustomOpen] = useState(false)
  const [customValue, setCustomValue] = useState('')
  const [managed, setManaged] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  const opponentName = aiName || '小漫'

  const pickQuick = (m) => {
    setMinutes(m)
    setCustomOpen(false)
  }
  const applyCustom = () => {
    const n = Math.round(Number(customValue))
    if (Number.isFinite(n) && n >= 1 && n <= 180) setMinutes(n)
  }

  const handleStart = (overrides = {}) => {
    onStart({
      task: overrides.task ?? task,
      minutes: overrides.minutes ?? minutes,
      managed: overrides.managed ?? managed,
    })
  }

  // Preview-only affordance for this branch: shows what it'll feel like once
  // 小漫 can genuinely initiate focus sessions through real tools
  // (start_focus/extend_focus/finish_focus — not wired up yet). This fills
  // the form and starts a session locally, in this browser, right now — it
  // does NOT talk to any AI/tool backend, and the button says so.
  const handleSimulate = () => {
    const simulatedTask = task.trim() || '整理今天的学习笔记'
    setTask(simulatedTask)
    setMinutes(25)
    setManaged(true)
    handleStart({ task: simulatedTask, minutes: 25, managed: true })
  }

  return (
    <div
      className="fixed inset-0 flex items-end justify-center"
      style={{ zIndex: 60, background: 'rgba(60,20,40,0.28)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 480,
          maxHeight: '88dvh',
          overflowY: 'auto',
          background: 'linear-gradient(175deg, rgba(255,250,253,0.99), rgba(250,240,255,0.98))',
          borderRadius: '28px 28px 0 0',
          boxShadow: '0 -18px 60px rgba(139,80,150,0.22)',
          border: `1px solid ${primary}22`,
          borderBottom: 'none',
          padding: `10px 18px calc(18px + env(safe-area-inset-bottom, 0px))`,
        }}
      >
        <div style={{ width: 38, height: 4, margin: '2px auto 12px', borderRadius: 99, background: `${primary}35` }} />

        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>🍅</span>
            <span className="font-semibold text-base" style={{ color: '#6a3f56' }}>专注</span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center flex-shrink-0"
            style={{ width: 30, height: 30, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}
          >
            <X size={15} />
          </button>
        </div>

        {/* Task */}
        <label style={{ fontSize: 11, color: '#b98a96', paddingLeft: 2 }}>这次要专注做什么？</label>
        <input
          value={task}
          onChange={e => setTask(e.target.value)}
          maxLength={120}
          placeholder="比如：写完这一章练习题"
          style={{
            width: '100%', marginTop: 4, marginBottom: 14,
            padding: '11px 14px', borderRadius: 15,
            background: 'rgba(255,255,255,0.75)', border: `1px solid ${primary}30`,
            color: '#6a3f56', fontSize: 14, outline: 'none', fontFamily: 'inherit',
          }}
        />

        {/* Duration */}
        <label style={{ fontSize: 11, color: '#b98a96', paddingLeft: 2 }}>专注多久</label>
        <div className="flex items-center gap-2 flex-wrap" style={{ marginTop: 6, marginBottom: 14 }}>
          {QUICK_MINUTES.map(m => {
            const active = !customOpen && minutes === m
            return (
              <button
                key={m}
                onClick={() => pickQuick(m)}
                style={{
                  padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 500,
                  background: active ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.7)',
                  color: active ? '#fff' : '#8b5060',
                  border: active ? 'none' : `1px solid ${primary}30`,
                }}
              >
                {m} 分钟
              </button>
            )
          })}
          <button
            onClick={() => setCustomOpen(v => !v)}
            style={{
              padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 500,
              background: customOpen ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.7)',
              color: customOpen ? '#fff' : '#8b5060',
              border: customOpen ? 'none' : `1px solid ${primary}30`,
            }}
          >
            自定义{customOpen ? `：${minutes}分钟` : ''}
          </button>
        </div>
        {customOpen && (
          <div className="flex items-center gap-2" style={{ marginTop: -6, marginBottom: 14 }}>
            <input
              type="number"
              min={1}
              max={180}
              value={customValue}
              onChange={e => setCustomValue(e.target.value)}
              onBlur={applyCustom}
              placeholder={String(minutes)}
              style={{
                width: 90, padding: '8px 12px', borderRadius: 12,
                background: 'rgba(255,255,255,0.75)', border: `1px solid ${primary}30`,
                color: '#6a3f56', fontSize: 13, outline: 'none', fontFamily: 'inherit',
              }}
            />
            <span style={{ fontSize: 12, color: '#b98a96' }}>分钟（1–180）</span>
          </div>
        )}

        {/* 交给小漫管理 */}
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '12px 14px', borderRadius: 18, marginBottom: 12,
            background: managed ? `linear-gradient(135deg, ${primary}1a, ${primaryDark}12)` : 'rgba(255,255,255,0.55)',
            border: `1px solid ${primary}${managed ? '40' : '22'}`,
          }}
        >
          <div style={{
            width: 36, height: 36, borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
            background: 'rgba(255,255,255,0.7)', border: `1.5px solid ${primary}55`,
          }}>
            {aiAvatar ? <img src={aiAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸'}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: '#6a3f56' }}>交给{opponentName}管理</div>
            <div style={{ fontSize: 10.5, color: '#b98a96', marginTop: 2, lineHeight: 1.5 }}>
              开启后专注页会隐藏暂停/跳过/重来，配合 iOS 引导式访问更难中途划走
            </div>
          </div>
          <button
            onClick={() => setManaged(v => !v)}
            role="switch"
            aria-checked={managed}
            style={{
              width: 42, height: 24, borderRadius: 99, flexShrink: 0, border: 'none', position: 'relative',
              background: managed ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(0,0,0,0.12)',
              transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: managed ? 21 : 3,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.25)', transition: 'left 0.2s',
            }} />
          </button>
        </div>

        {/* Guided Access setup — collapsible, accurate copy only */}
        {managed && (
          <div style={{ marginBottom: 14 }}>
            <button
              onClick={() => setShowGuide(v => !v)}
              className="flex items-center justify-between w-full"
              style={{
                padding: '10px 14px', borderRadius: 14,
                background: 'rgba(255,255,255,0.55)', border: `1px solid ${primary}25`,
                color: '#8b5060', fontSize: 12,
              }}
            >
              <span>📌 第一次用？查看引导式访问设置步骤</span>
              <ChevronDown size={14} style={{ transform: showGuide ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
            </button>
            {showGuide && (
              <div style={{
                marginTop: 8, padding: '12px 14px', borderRadius: 16,
                background: 'rgba(255,255,255,0.5)', border: `1px solid ${primary}20`,
              }}>
                <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {GA_STEPS.map((step, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, padding: '7px 0', borderTop: i ? `1px solid ${primary}18` : 'none' }}>
                      <span style={{
                        flexShrink: 0, width: 20, height: 20, borderRadius: 7, marginTop: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, fontWeight: 600, color: '#8b5060', background: `${primary}20`,
                      }}>{i + 1}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: '#6a3f56' }}>{step.title}</div>
                        <div style={{ fontSize: 10.5, color: '#a97d8a', marginTop: 2, lineHeight: 1.6 }}>{step.body}</div>
                      </div>
                    </li>
                  ))}
                </ol>
                <a
                  href={APPLE_GUIDE_URL}
                  target="_blank" rel="noreferrer"
                  style={{ display: 'block', marginTop: 8, fontSize: 10.5, color: primary, textAlign: 'center' }}
                >
                  查看苹果官方说明 ↗
                </a>
                <p style={{ fontSize: 10, color: '#c9a2ad', lineHeight: 1.6, marginTop: 8, marginBottom: 0 }}>{GA_DISCLAIMER}</p>
              </div>
            )}
          </div>
        )}

        {/* Start */}
        <button
          onClick={() => handleStart()}
          style={{
            width: '100%', padding: '13px', borderRadius: 18, marginBottom: 10,
            background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff',
            border: 'none', fontSize: 15, fontWeight: 600,
            boxShadow: `0 6px 20px ${primary}45`,
          }}
        >
          开始专注
        </button>

        {/* Preview-only: simulate 小漫 initiating a focus session */}
        <button
          onClick={handleSimulate}
          className="flex items-center justify-center gap-1.5"
          style={{
            width: '100%', padding: '10px', borderRadius: 16, marginBottom: 4,
            background: 'rgba(255,255,255,0.55)', color: '#8b5060',
            border: `1px dashed ${primary}45`, fontSize: 12.5, fontWeight: 500,
          }}
        >
          <Sparkles size={13} />
          预览：模拟{opponentName}发起专注
        </button>
        <p style={{ fontSize: 10, color: '#c9a2ad', textAlign: 'center', lineHeight: 1.6, margin: '4px 4px 14px' }}>
          这是预览效果，本地模拟{opponentName}帮你填好任务并开始 25 分钟专注管理模式——目前还没有接入真实 AI 工具；
          正式版会通过 start_focus 等真实工具由{opponentName}发起。
        </p>

        <p style={{ fontSize: 9.5, color: '#d3b3bd', textAlign: 'center', lineHeight: 1.7, margin: 0 }}>
          专注计时逻辑改编自 <span style={{ fontWeight: 600 }}>NYRA</span> 的开源项目
          {' '}<a href="https://github.com/NyraSeithhh/guided-access-pomodoro" target="_blank" rel="noreferrer" style={{ color: primary }}>guided-access-pomodoro</a>
          {' '}（MIT License）
        </p>
      </div>
    </div>
  )
}
