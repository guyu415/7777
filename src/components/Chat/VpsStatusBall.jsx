import { useEffect, useRef, useState } from 'react'
import { getCompanionStatus, switchCompanionModel } from '../../services/companion'

// Exact Claude Code model IDs only — no rolling aliases. Keep this list in
// sync with MODEL_IDS in channel-server.ts on the VPS.
const MODEL_OPTIONS = [
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
]
const POLL_MS = 25000

function formatResetTime(unixSeconds) {
  if (!unixSeconds) return ''
  const d = new Date(unixSeconds * 1000)
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function ballColor(status) {
  const fh = status?.rate_limits?.five_hour?.used_percentage
  const wk = status?.rate_limits?.seven_day?.used_percentage
  if (fh == null && wk == null) return '#a0b8d0' // 等待首次响应
  const remaining = Math.min(100 - (fh ?? 0), 100 - (wk ?? 0))
  if (remaining < 20) return '#e07070'
  if (remaining < 50) return '#d4a017'
  return '#34c759'
}

// 生产常驻会话的模型/用量小球——真实数据来自官方 statusLine（见 VPS 上的
// scripts/statusline-capture.sh），不是前端自己估算的。
export default function VpsStatusBall({ theme, isLoading }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(null) // model id currently switching to
  const [switchError, setSwitchError] = useState(null)
  const panelRef = useRef(null)

  const refresh = async () => {
    try {
      const s = await getCompanionStatus()
      setStatus(s)
    } catch {
      // best-effort — leave last-known status showing rather than clearing it
    }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const doSwitch = async (modelId) => {
    if (isLoading || switching) return
    setSwitching(modelId)
    setSwitchError(null)
    try {
      const res = await switchCompanionModel(modelId)
      setStatus(s => ({ ...(s || {}), model: res.model }))
      await refresh()
    } catch (e) {
      setSwitchError(e.message || '切换失败')
    } finally {
      setSwitching(null)
    }
  }

  const fh = status?.rate_limits?.five_hour
  const wk = status?.rate_limits?.seven_day
  const cw = status?.context_window

  return (
    <div style={{ position: 'relative' }} ref={panelRef}>
      <button
        onClick={() => { setOpen(v => !v); if (!open) refresh() }}
        title="VPS 用量"
        style={{
          width: 22, height: 22, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.7)',
          background: ballColor(status), boxShadow: '0 1px 4px rgba(0,0,0,0.15)', cursor: 'pointer', flexShrink: 0,
        }}
      />
      {open && (
        <div
          style={{
            position: 'absolute', top: 30, right: 0, zIndex: 30, width: 240,
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.18)', padding: 14,
          }}
        >
          <div className="text-xs font-semibold mb-2" style={{ color: '#2c5282' }}>
            当前模型：{status?.model?.display_name || '—'}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {MODEL_OPTIONS.map(opt => {
              const active = status?.model?.id === opt.id
              const busy = switching === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => doSwitch(opt.id)}
                  disabled={isLoading || !!switching || active}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={{
                    background: active ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.6)',
                    color: active ? '#fff' : '#4a7aaa',
                    border: active ? 'none' : '1px solid rgba(120,160,220,0.35)',
                    opacity: (isLoading || switching) && !active ? 0.5 : 1,
                    cursor: (isLoading || switching || active) ? 'default' : 'pointer',
                  }}
                >
                  {busy ? '切换中…' : opt.label}
                </button>
              )
            })}
          </div>
          {isLoading && <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>对话进行中，暂不能切换模型</p>}
          {switchError && <p className="text-[10px] mb-2" style={{ color: '#e07070' }}>{switchError}</p>}

          <div className="text-[11px] mb-1" style={{ color: '#6a90b8' }}>上下文占用</div>
          {cw?.used_percentage != null ? (
            <>
              <div style={{ height: 4, background: 'rgba(200,220,255,0.3)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', width: `${cw.used_percentage}%`, background: 'linear-gradient(90deg, #9b70e0, #c084fc)' }} />
              </div>
            </>
          ) : (
            <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>等待首次响应</p>
          )}

          <div className="text-[11px] mb-1" style={{ color: '#6a90b8' }}>5 小时用量</div>
          {fh ? (
            <p className="text-[10px] mb-2" style={{ color: '#7a9cc0' }}>
              已用 {fh.used_percentage}% · 重置于 {formatResetTime(fh.resets_at)}
            </p>
          ) : (
            <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>等待首次响应</p>
          )}

          <div className="text-[11px] mb-1" style={{ color: '#6a90b8' }}>每周用量</div>
          {wk ? (
            <p className="text-[10px]" style={{ color: '#7a9cc0' }}>
              已用 {wk.used_percentage}% · 重置于 {formatResetTime(wk.resets_at)}
            </p>
          ) : (
            <p className="text-[10px]" style={{ color: '#a0b8d0' }}>等待首次响应</p>
          )}
        </div>
      )}
    </div>
  )
}
