import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, Info, X } from 'lucide-react'
import { GA_STEPS, GA_DISCLAIMER, GA_SHORT_REMINDER, xiaomanLines } from './focusCopy'

const LINE_ROTATE_MS = 22000

// The full-screen countdown takeover — shown whenever a focus/break session
// is running/paused, OR a phase just finished (completion card), driven
// entirely by usePomodoro()'s state (see ChatWindow.jsx's mount condition).
// Deliberately no FallingParticles / heavy motion here — "安静，不放大量装饰
// 粒子" — the only animation is a slow breathing glow on the ring itself.
export default function FocusSession({ theme, aiName, aiAvatar, pomodoro, onExit }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const { state, remainingMs, todayCount, justCompleted, pauseFocus, resumeFocus, endFocus, startBreak, skipBreak, acknowledgeCompletion, format } = pomodoro

  const opponentName = aiName || '小漫'
  const [lineIdx, setLineIdx] = useState(0)
  const [showGuideInfo, setShowGuideInfo] = useState(false)
  const lines = useMemo(() => xiaomanLines(), [])

  useEffect(() => {
    if (!(state.managed && state.mode === 'focus' && state.status === 'running')) return
    const t = setInterval(() => setLineIdx(i => (i + 1) % lines.length), LINE_ROTATE_MS)
    return () => clearInterval(t)
  }, [state.managed, state.mode, state.status, lines.length])

  // ---- Completion card (focus just finished, or break just finished) ----
  if (justCompleted) {
    const focusDone = justCompleted === 'focus'
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center px-8" style={{ zIndex: 65, background: bgGradient(primary) }}>
        <div style={{ fontSize: 46, marginBottom: 6 }}>{focusDone ? '🎉' : '🌿'}</div>
        <div style={{ fontSize: 19, fontWeight: 600, color: '#5a3548', textAlign: 'center' }}>
          {focusDone ? '这段专注完成啦' : '休息结束'}
        </div>
        <div style={{ fontSize: 12.5, color: '#a97d8a', marginTop: 6, textAlign: 'center', lineHeight: 1.7 }}>
          {focusDone
            ? `今天已经完成 ${todayCount} 次专注，${opponentName}都看在眼里。`
            : '休息够了的话，我们可以开始下一段专注。'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 300, marginTop: 28 }}>
          {focusDone ? (
            <>
              <button
                onClick={startBreak}
                style={{
                  padding: '13px', borderRadius: 18, border: 'none', fontSize: 14.5, fontWeight: 600,
                  background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff',
                  boxShadow: `0 6px 20px ${primary}45`,
                }}
              >
                开始休息（{state.breakMinutes} 分钟）
              </button>
              <button
                onClick={() => { skipBreak(); acknowledgeCompletion(); onExit() }}
                style={{ padding: '12px', borderRadius: 18, border: `1px solid ${primary}35`, fontSize: 13.5, color: '#8b5060', background: 'rgba(255,255,255,0.55)' }}
              >
                先不休息了
              </button>
            </>
          ) : (
            <button
              onClick={() => { acknowledgeCompletion(); onExit() }}
              style={{
                padding: '13px', borderRadius: 18, border: 'none', fontSize: 14.5, fontWeight: 600,
                background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff',
                boxShadow: `0 6px 20px ${primary}45`,
              }}
            >
              好的，回到聊天
            </button>
          )}
        </div>
      </div>
    )
  }

  // ---- Live countdown ----
  const totalMs = (state.mode === 'break' ? state.breakMinutes : state.focusMinutes) * 60000
  const pct = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) : 0
  const managedFocus = state.managed && state.mode === 'focus'
  const line = lines[lineIdx % lines.length]

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 65, background: bgGradient(primary) }}>
      {/* Xiaoman header — reads current session's own name/avatar, never a
          hardcoded identity. Only shown during managed focus (that's the
          "陪伴/监督" slot); plain countdown otherwise stays uncluttered. */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 22px)' }}>
        {managedFocus && (
          <>
            <div style={{
              width: 52, height: 52, borderRadius: '50%', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22,
              background: 'rgba(255,255,255,0.7)', border: `2px solid ${primary}55`,
              boxShadow: `0 0 16px ${primary}40`,
            }}>
              {aiAvatar ? <img src={aiAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸'}
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#6a3f56', marginTop: 6 }}>{opponentName}正在陪你专注</div>
            <div key={lineIdx} className="animate-fade-up" style={{ fontSize: 11.5, color: '#a97d8a', marginTop: 4, padding: '0 32px', textAlign: 'center', lineHeight: 1.6, minHeight: 32 }}>
              {line}
            </div>
          </>
        )}
        {!managedFocus && (
          <div style={{ fontSize: 12.5, color: '#a97d8a' }}>{state.mode === 'break' ? '休息一下' : '专注中'}</div>
        )}
      </div>

      {/* Countdown ring — the visual center. Conic-gradient progress ring +
          a glass inner disc, no SVG/canvas needed. The one and only
          animation on this page is the ring's own slow glow breathing. */}
      <div className="flex-1 flex items-center justify-center min-h-0">
        <div style={{ position: 'relative', width: 232, height: 232, flexShrink: 0 }}>
          <style>{`
            @keyframes focus-ring-breathe { 0%,100% { opacity: 0.55 } 50% { opacity: 0.9 } }
          `}</style>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: `conic-gradient(${primary} ${pct * 360}deg, rgba(255,255,255,0.35) 0deg)`,
            boxShadow: `0 0 32px ${primary}35`,
          }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `1px solid ${primary}55`,
            animation: state.status === 'running' ? 'focus-ring-breathe 4.5s ease-in-out infinite' : 'none',
          }} />
          <div style={{
            position: 'absolute', inset: 15, borderRadius: '50%',
            background: 'radial-gradient(circle at 38% 30%, rgba(255,255,255,0.98), rgba(255,247,251,0.94) 70%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 2px 10px rgba(139,80,96,0.08)',
          }}>
            <span style={{ fontSize: 44, fontWeight: 650, letterSpacing: 0.5, color: '#5a3548', fontFamily: 'ui-rounded, -apple-system, sans-serif', lineHeight: 1 }}>
              {format(remainingMs)}
            </span>
            <span style={{ fontSize: 11, color: '#c48a9a', marginTop: 8 }}>
              {state.status === 'paused' ? '已暂停' : state.mode === 'break' ? '休息中' : '专注中'}
            </span>
          </div>
        </div>
      </div>

      {/* Task + today count */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ padding: '0 24px' }}>
        {state.task && (
          <div style={{
            maxWidth: 300, padding: '8px 16px', borderRadius: 14, marginBottom: 10,
            background: 'rgba(255,255,255,0.55)', border: `1px solid ${primary}25`,
            fontSize: 13, color: '#6a3f56', textAlign: 'center',
          }}>
            {state.task}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#b98a96', marginBottom: 14 }}>今日已完成 {todayCount} 次专注</div>
      </div>

      {/* Guided Access reminder — managed + focus + running only, short and
          non-blocking; a real triple-click is the only thing that actually
          starts iOS's own system lock, this page cannot do it for the user. */}
      {managedFocus && state.status === 'running' && (
        <div style={{ padding: '0 20px', flexShrink: 0 }}>
          <button
            onClick={() => setShowGuideInfo(true)}
            className="flex items-start gap-2 w-full text-left"
            style={{
              padding: '10px 14px', borderRadius: 16, marginBottom: 14,
              background: `${primary}14`, border: `1px solid ${primary}30`,
            }}
          >
            <Info size={13} style={{ color: primary, flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 11, color: '#8b5060', lineHeight: 1.6 }}>{GA_SHORT_REMINDER}</span>
          </button>
        </div>
      )}

      {/* Manual mode controls — pause/resume + end. Managed mode shows
          NEITHER (hides pause/skip/restart entirely, per spec) — the only
          way out during managed focus is the real iOS Guided Access exit,
          or just letting the timer run out. */}
      {!state.managed && (
        <div className="flex items-center justify-center gap-3 flex-shrink-0" style={{ padding: '0 24px', paddingBottom: 'max(22px, calc(env(safe-area-inset-bottom, 0px) + 14px))' }}>
          <button
            onClick={state.status === 'running' ? pauseFocus : resumeFocus}
            className="flex items-center gap-1.5"
            style={{
              padding: '12px 22px', borderRadius: 18, border: 'none', fontSize: 13.5, fontWeight: 600,
              background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff',
              boxShadow: `0 6px 18px ${primary}40`,
            }}
          >
            {state.status === 'running' ? <Pause size={14} /> : <Play size={14} />}
            {state.status === 'running' ? '暂停' : '继续'}
          </button>
          <button
            onClick={() => { endFocus(); onExit() }}
            style={{
              padding: '12px 22px', borderRadius: 18, fontSize: 13.5, color: '#8b5060',
              background: 'rgba(255,255,255,0.55)', border: `1px solid ${primary}35`,
            }}
          >
            结束
          </button>
        </div>
      )}
      {state.managed && <div style={{ paddingBottom: 'max(18px, env(safe-area-inset-bottom, 0px))' }} />}

      {/* Guided Access step reference — informational only, never pauses or
          ends the session; just lets the user re-check the steps mid-focus. */}
      {showGuideInfo && (
        <div
          className="fixed inset-0 flex items-center justify-center px-6"
          style={{ zIndex: 70, background: 'rgba(60,20,40,0.4)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowGuideInfo(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{ width: '100%', maxWidth: 320, maxHeight: '76dvh', overflowY: 'auto', background: 'rgba(255,252,254,0.99)', borderRadius: 22, padding: 18, boxShadow: '0 16px 50px rgba(90,53,72,0.25)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontSize: 13, fontWeight: 600, color: '#5a3548' }}>📌 引导式访问设置步骤</span>
              <button onClick={() => setShowGuideInfo(false)} style={{ width: 26, height: 26, borderRadius: '50%', border: 'none', background: `${primary}18`, color: primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={13} />
              </button>
            </div>
            <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {GA_STEPS.map((step, i) => (
                <li key={i} style={{ padding: '7px 0', borderTop: i ? `1px solid ${primary}18` : 'none' }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: '#6a3f56' }}>{i + 1}. {step.title}</div>
                  <div style={{ fontSize: 10.5, color: '#a97d8a', marginTop: 2, lineHeight: 1.6 }}>{step.body}</div>
                </li>
              ))}
            </ol>
            <p style={{ fontSize: 10, color: '#c9a2ad', lineHeight: 1.6, marginTop: 10, marginBottom: 0 }}>{GA_DISCLAIMER}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function bgGradient(primary) {
  return `radial-gradient(circle at 50% 18%, ${primary}22, transparent 55%), linear-gradient(175deg, #fdf1f6 0%, #f8e4ef 35%, #f3e6fb 70%, #f9f0ff 100%)`
}
