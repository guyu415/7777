import { useEffect, useRef, useState } from 'react'
import { Send, Info, X, Pause, Play } from 'lucide-react'
import { GA_STEPS, GA_DISCLAIMER, GA_SHORT_REMINDER } from './focusCopy'

const QUICK_REASONS = ['上厕所', '身体不舒服', '临时有事']

function bgGradient(primary) {
  return `radial-gradient(circle at 50% 18%, ${primary}22, transparent 55%), linear-gradient(175deg, #fdf1f6 0%, #f8e4ef 35%, #f3e6fb 70%, #f9f0ff 100%)`
}

function LogLine({ msg, primary, opponentName }) {
  if (msg.from === 'system') {
    return <div style={{ textAlign: 'center', fontSize: 10.5, color: '#c9a2ad', padding: '4px 8px' }}>{msg.text}</div>
  }
  const isUser = msg.from === 'user'
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', padding: '2px 4px' }}>
      <div style={{
        maxWidth: '78%', padding: '7px 12px', borderRadius: 14, fontSize: 12.5, lineHeight: 1.5,
        background: isUser ? `linear-gradient(135deg, ${primary}, ${primary}cc)` : 'rgba(255,255,255,0.75)',
        color: isUser ? '#fff' : '#5a3548',
        border: isUser ? 'none' : `1px solid ${primary}22`,
      }}>
        {!isUser && <div style={{ fontSize: 9.5, color: primary, marginBottom: 2, fontWeight: 600 }}>{opponentName}</div>}
        {msg.text}
      </div>
    </div>
  )
}

// The full-screen countdown + (when AI-managed) a real interaction area —
// entirely driven by useFocusRuntime()'s server-authoritative state (see
// that hook and channel-server.ts's Focus section), never local state. Shown
// whenever ChatWindow.jsx's focusSessionVisible is true (state.active, or a
// just-finished completion card still pending acknowledgement).
export default function FocusSession({ theme, aiName, aiAvatar, focus, onExit }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const {
    state, remainingMs, todayCount, justFinished, acknowledgeFinished, format,
    focusInteract, requestFocus, resumeFocusFromApproval, selfPauseFocus, selfResumeFocus, selfEndFocus,
  } = focus

  const [chatText, setChatText] = useState('')
  const [sending, setSending] = useState(false)
  const [requestKind, setRequestKind] = useState(null)
  const [reasonText, setReasonText] = useState('')
  const [submittingRequest, setSubmittingRequest] = useState(false)
  const [requestError, setRequestError] = useState(null)
  const [showGuideInfo, setShowGuideInfo] = useState(false)
  const logRef = useRef(null)

  const managed = !!state?.manager
  const opponentName = state?.manager?.name || aiName || '小漫'

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [state?.log?.length])

  if (!state) return null

  // ---- Completion card (real: naturally expired, manager-finished, or an
  // approved early end — see justFinished.reason) ----
  if (justFinished) {
    const completed = justFinished.reason === 'completed'
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center px-8" style={{ zIndex: 65, background: bgGradient(primary) }}>
        <div style={{ fontSize: 46, marginBottom: 6 }}>{completed ? '🎉' : '⏹️'}</div>
        <div style={{ fontSize: 19, fontWeight: 600, color: '#5a3548', textAlign: 'center' }}>
          {completed ? '这段专注完成啦' : '专注提前结束了'}
        </div>
        <div style={{ fontSize: 12.5, color: '#a97d8a', marginTop: 6, textAlign: 'center', lineHeight: 1.7 }}>
          {completed
            ? `今天已经完成 ${todayCount} 次专注${justFinished.manager ? `，${justFinished.manager.name}都看在眼里` : ''}。`
            : (justFinished.actualMs ? `这次进行了约 ${Math.max(1, Math.round(justFinished.actualMs / 60000))} 分钟。` : '')}
        </div>
        <button
          onClick={() => { acknowledgeFinished(); onExit() }}
          style={{
            marginTop: 26, padding: '13px 32px', borderRadius: 18, border: 'none', fontSize: 14.5, fontWeight: 600,
            background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff',
            boxShadow: `0 6px 20px ${primary}45`,
          }}
        >
          好的，回到聊天
        </button>
      </div>
    )
  }

  const pending = state.pendingRequest

  const handleSendChat = async () => {
    const text = chatText.trim()
    if (!text || sending) return
    setSending(true)
    setChatText('')
    try { await focusInteract(text) } catch { /* best-effort — log stays as the source of truth */ } finally { setSending(false) }
  }

  const openRequest = (kind) => { setRequestKind(kind); setReasonText(''); setRequestError(null) }
  const submitRequest = async () => {
    if (!reasonText.trim() || submittingRequest) return
    setSubmittingRequest(true)
    setRequestError(null)
    try {
      const result = await requestFocus(requestKind, reasonText.trim())
      if (!result?.ok) { setRequestError('提交失败，请重试'); return }
      setRequestKind(null)
    } catch {
      setRequestError('提交失败，请重试')
    } finally {
      setSubmittingRequest(false)
    }
  }

  const totalMs = (state.minutes || 25) * 60000
  const pct = totalMs > 0 ? Math.min(1, Math.max(0, 1 - remainingMs / totalMs)) : 0

  return (
    <div className="fixed inset-0 flex flex-col" style={{ zIndex: 65, background: bgGradient(primary) }}>
      {/* Header — managed only: who's running this, real identity from the
          session that actually called start_focus, never a generic label. */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 14px)' }}>
        {managed ? (
          <>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', overflow: 'hidden',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              background: 'rgba(255,255,255,0.7)', border: `2px solid ${primary}55`,
              boxShadow: `0 0 14px ${primary}35`,
            }}>
              {aiAvatar ? <img src={aiAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸'}
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: '#6a3f56', marginTop: 5 }}>由{opponentName}管理这次专注</div>
          </>
        ) : (
          <div style={{ fontSize: 12, color: '#a97d8a' }}>{state.status === 'paused' ? '已暂停' : '专注中'}</div>
        )}
      </div>

      {/* Countdown ring — the visual center. Conic-gradient progress + a
          glass inner disc, no SVG/canvas needed. Only animation on this page
          is the ring's own slow glow breathing. */}
      <div className="flex-shrink-0 flex items-center justify-center" style={{ padding: '10px 0' }}>
        <div style={{ position: 'relative', width: 190, height: 190, flexShrink: 0 }}>
          <style>{`@keyframes focus-ring-breathe { 0%,100% { opacity: 0.55 } 50% { opacity: 0.9 } }`}</style>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            background: `conic-gradient(${primary} ${pct * 360}deg, rgba(255,255,255,0.35) 0deg)`,
            boxShadow: `0 0 26px ${primary}30`,
          }} />
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%', border: `1px solid ${primary}55`,
            animation: state.status === 'running' ? 'focus-ring-breathe 4.5s ease-in-out infinite' : 'none',
          }} />
          <div style={{
            position: 'absolute', inset: 13, borderRadius: '50%',
            background: 'radial-gradient(circle at 38% 30%, rgba(255,255,255,0.98), rgba(255,247,251,0.94) 70%)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 2px 10px rgba(139,80,96,0.08)',
          }}>
            <span style={{ fontSize: 38, fontWeight: 650, letterSpacing: 0.5, color: '#5a3548', fontFamily: 'ui-rounded, -apple-system, sans-serif', lineHeight: 1 }}>
              {format(remainingMs)}
            </span>
            <span style={{ fontSize: 10.5, color: '#c48a9a', marginTop: 6 }}>
              {state.status === 'paused' ? '已暂停' : '专注中'}
            </span>
          </div>
        </div>
      </div>

      {/* Task + today count */}
      <div className="flex flex-col items-center flex-shrink-0" style={{ padding: '0 24px' }}>
        {state.task && (
          <div style={{
            maxWidth: 300, padding: '6px 14px', borderRadius: 13, marginBottom: 6,
            background: 'rgba(255,255,255,0.55)', border: `1px solid ${primary}25`,
            fontSize: 12.5, color: '#6a3f56', textAlign: 'center',
          }}>
            {state.task}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: '#b98a96', marginBottom: 8 }}>今日已完成 {todayCount} 次专注</div>
      </div>

      {/* Guided Access reminder — managed + running only, short, informational */}
      {managed && state.status === 'running' && (
        <div style={{ padding: '0 20px', flexShrink: 0 }}>
          <button
            onClick={() => setShowGuideInfo(true)}
            className="flex items-start gap-2 w-full text-left"
            style={{ padding: '8px 12px', borderRadius: 14, marginBottom: 8, background: `${primary}14`, border: `1px solid ${primary}30` }}
          >
            <Info size={12} style={{ color: primary, flexShrink: 0, marginTop: 2 }} />
            <span style={{ fontSize: 10.5, color: '#8b5060', lineHeight: 1.5 }}>{GA_SHORT_REMINDER}</span>
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex-shrink-0" style={{ padding: '0 20px' }}>
        {managed ? (
          state.status === 'paused' ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: '#8b5060' }}>已批准暂停</div>
              <button
                onClick={resumeFocusFromApproval}
                className="flex items-center gap-1.5"
                style={{ padding: '10px 24px', borderRadius: 16, border: 'none', fontSize: 13, fontWeight: 600, background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff' }}
              >
                <Play size={13} /> 继续专注
              </button>
            </div>
          ) : pending ? (
            <div style={{
              textAlign: 'center', fontSize: 11.5, color: '#8b5060', padding: '10px 14px', borderRadius: 14, marginBottom: 10,
              background: 'rgba(255,255,255,0.55)', border: `1px dashed ${primary}40`,
            }}>
              {pending.kind === 'pause' ? '已申请暂停' : '已申请结束'} · 等待{opponentName}决定…
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2" style={{ marginBottom: 10 }}>
              <button onClick={() => openRequest('pause')} style={ctrlBtn(primary, false)}>申请暂停</button>
              <button onClick={() => openRequest('end')} style={ctrlBtn(primary, false)}>申请结束</button>
            </div>
          )
        ) : (
          <div className="flex items-center justify-center gap-2" style={{ marginBottom: 10 }}>
            <button onClick={state.status === 'running' ? selfPauseFocus : selfResumeFocus} className="flex items-center gap-1.5" style={ctrlBtn(primary, true)}>
              {state.status === 'running' ? <Pause size={13} /> : <Play size={13} />}
              {state.status === 'running' ? '暂停' : '继续'}
            </button>
            <button onClick={() => { selfEndFocus(); onExit() }} style={ctrlBtn(primary, false)}>结束</button>
          </div>
        )}
      </div>

      {/* Interaction area — real chat with the managing AI, same session/
          history it always has (see channel-server.ts's Focus section) —
          managed only; a self-managed session has no one to talk to here. */}
      {managed ? (
        <div className="flex-1 flex flex-col min-h-0 mx-3 mb-2 rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.4)', border: `1px solid ${primary}22` }}>
          <div ref={logRef} className="flex-1 overflow-y-auto px-1 pt-2" style={{ minHeight: 0 }}>
            {(!state.log || state.log.length === 0) && (
              <div style={{ textAlign: 'center', fontSize: 11, color: '#c9a2ad', paddingTop: 8 }}>可以和{opponentName}说说话～</div>
            )}
            {(state.log || []).map((m) => <LogLine key={m.id} msg={m} primary={primary} opponentName={opponentName} />)}
          </div>
          <div className="flex items-center gap-2" style={{ padding: '6px 8px' }}>
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSendChat() }}
              placeholder={`和${opponentName}说句话…`}
              disabled={sending}
              style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.7)', border: `1px solid ${primary}33`, borderRadius: 16, padding: '8px 12px', fontSize: 13, color: '#6a3f56', outline: 'none', fontFamily: 'inherit' }}
            />
            <button
              onClick={handleSendChat}
              disabled={sending || !chatText.trim()}
              className="flex items-center justify-center flex-shrink-0"
              style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff', opacity: (sending || !chatText.trim()) ? 0.5 : 1 }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      ) : (
        <div style={{ paddingBottom: 'max(18px, env(safe-area-inset-bottom, 0px))' }} />
      )}
      {managed && <div style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom, 0px))' }} />}

      {/* Reason picker — required for either request kind, per spec */}
      {requestKind && (
        <div className="fixed inset-0 flex items-end justify-center" style={{ zIndex: 70, background: 'rgba(60,20,40,0.32)', backdropFilter: 'blur(6px)' }} onClick={() => setRequestKind(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: 'rgba(255,252,254,0.99)', borderRadius: '24px 24px 0 0', padding: `16px 18px calc(16px + env(safe-area-inset-bottom, 0px))`, boxShadow: '0 -16px 50px rgba(90,53,72,0.2)' }}>
            <div className="flex items-center justify-between mb-3">
              <span style={{ fontSize: 14, fontWeight: 600, color: '#5a3548' }}>
                {requestKind === 'pause' ? '申请暂停' : '申请结束'}专注
              </span>
              <button onClick={() => setRequestKind(null)} style={{ width: 26, height: 26, borderRadius: '50%', border: 'none', background: `${primary}18`, color: primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <X size={13} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mb-3">
              {QUICK_REASONS.map((r) => (
                <button
                  key={r}
                  onClick={() => setReasonText(r)}
                  style={{
                    padding: '7px 14px', borderRadius: 999, fontSize: 12.5,
                    background: reasonText === r ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.7)',
                    color: reasonText === r ? '#fff' : '#8b5060',
                    border: reasonText === r ? 'none' : `1px solid ${primary}30`,
                  }}
                >
                  {r}
                </button>
              ))}
            </div>
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              maxLength={200}
              rows={2}
              placeholder="告诉对方原因…"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,0.75)', border: `1px solid ${primary}30`, color: '#6a3f56', fontSize: 13, outline: 'none', fontFamily: 'inherit', resize: 'none' }}
            />
            {requestError && <p style={{ fontSize: 11, color: '#e07070', margin: '6px 2px 0' }}>{requestError}</p>}
            <button
              onClick={submitRequest}
              disabled={!reasonText.trim() || submittingRequest}
              style={{
                width: '100%', marginTop: 10, padding: '12px', borderRadius: 16, border: 'none', fontSize: 14, fontWeight: 600,
                background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff',
                opacity: (!reasonText.trim() || submittingRequest) ? 0.5 : 1,
              }}
            >
              {submittingRequest ? '提交中…' : '提交申请'}
            </button>
          </div>
        </div>
      )}

      {/* Guided Access step reference — informational only */}
      {showGuideInfo && (
        <div className="fixed inset-0 flex items-center justify-center px-6" style={{ zIndex: 75, background: 'rgba(60,20,40,0.4)', backdropFilter: 'blur(6px)' }} onClick={() => setShowGuideInfo(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 320, maxHeight: '76dvh', overflowY: 'auto', background: 'rgba(255,252,254,0.99)', borderRadius: 22, padding: 18, boxShadow: '0 16px 50px rgba(90,53,72,0.25)' }}>
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

function ctrlBtn(primary, primaryFill) {
  return primaryFill
    ? { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px', borderRadius: 16, border: 'none', fontSize: 13, fontWeight: 600, background: `linear-gradient(135deg, ${primary}, ${primary}cc)`, color: '#fff' }
    : { padding: '10px 20px', borderRadius: 16, fontSize: 13, color: '#8b5060', background: 'rgba(255,255,255,0.55)', border: `1px solid ${primary}35` }
}
