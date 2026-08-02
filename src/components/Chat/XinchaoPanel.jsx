import { X } from 'lucide-react'

function formatTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function InfoCell({ label, value, primary }) {
  return (
    <div style={{ background: `${primary}12`, borderRadius: 12, padding: '8px 10px' }}>
      <div style={{ fontSize: 10, color: `${primary}bb` }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#8b5060' }}>{value}</div>
    </div>
  )
}

// Bottom sheet — all fields here come straight from GET /xinchao/status /
// the xinchao_update broadcast, both already reduced server-side to labels
// (see channel-server.ts's xinchaoFrontendPayload). This component only
// lays them out; it never calls a model or invents wording of its own.
// Timeline entries are xinchao's own recentConversationEvents, pre-filtered
// server-side to ones with a real interactionType (heartbeats excluded).
export default function XinchaoPanel({ theme, state, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  if (!state) return null

  const timeline = [...(state.timeline || [])].reverse()

  return (
    <div className="fixed inset-0" style={{ zIndex: 70 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)' }} />
      <div
        onClick={(e) => e.stopPropagation()}
        className="absolute bottom-0 left-0 right-0 rounded-t-3xl"
        style={{
          background: 'rgba(255,250,252,0.98)', backdropFilter: 'blur(20px)',
          padding: '16px 18px', paddingBottom: 'max(18px, env(safe-area-inset-bottom, 0px))',
          maxHeight: '70vh', overflowY: 'auto', boxShadow: '0 -8px 30px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(0,0,0,0.15)', margin: '0 auto 12px' }} />
        <div className="flex items-center justify-between mb-3">
          <span className="font-semibold text-sm" style={{ color: primary }}>心潮状态</span>
          <button
            onClick={onClose}
            style={{
              width: 26, height: 26, borderRadius: '50%', background: `${primary}18`, border: 'none',
              color: primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={13} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-3">
          <InfoCell primary={primary} label="主要驱动力" value={state.topDrive?.shortLabel || '—'} />
          <InfoCell primary={primary} label="当前基调" value={state.toneLabel || '—'} />
          <InfoCell primary={primary} label="清醒状态" value={state.consciousnessLabel || '—'} />
          <InfoCell primary={primary} label="疲劳" value={`${Math.round((state.fatigue || 0) * 100)}%`} />
        </div>

        <div className="text-[11px] mb-4" style={{ color: '#c9a2ad' }}>更新于 {formatTime(state.updatedAt)}</div>

        <div className="text-xs font-medium mb-2" style={{ color: primary }}>近期变化</div>
        {timeline.length === 0 ? (
          <div className="text-xs" style={{ color: '#c9a2ad' }}>暂无记录</div>
        ) : (
          <div className="flex flex-col gap-2">
            {timeline.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span style={{ color: '#8b5060' }}>{item.label}</span>
                <span style={{ color: '#c9a2ad' }}>{formatTime(item.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
