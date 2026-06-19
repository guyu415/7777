import { MODE_LABELS, WIND_LABELS } from '../../services/ac'

const MODE_ICONS = { cool: '❄️', heat: '🔥', auto: '♻️', fan: '💨', dry: '💧' }

export default function AcCard({ status }) {
  const { action, temp, mode, wind, success, error } = status
  const isOff = action === 'off'

  return (
    <div
      className="mt-2 rounded-2xl px-4 py-3 flex items-center gap-3"
      style={{
        background: 'rgba(255,255,255,0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(160,220,180,0.35)',
        boxShadow: '0 2px 12px rgba(160,220,180,0.15)',
        maxWidth: 240,
      }}
    >
      {/* Power indicator */}
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-lg flex-shrink-0"
        style={{
          background: isOff
            ? 'rgba(210,210,210,0.4)'
            : 'linear-gradient(135deg, rgba(100,200,230,0.5), rgba(120,220,180,0.5))',
          border: `1.5px solid ${isOff ? 'rgba(180,180,180,0.3)' : 'rgba(100,200,200,0.4)'}`,
        }}
      >
        {isOff ? '⏻' : (MODE_ICONS[mode] || '❄️')}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-semibold" style={{ color: '#3d7a6a' }}>
          空调{isOff ? '已关闭' : '已开启'}
          {!success && <span style={{ color: '#e07070' }}> · 失败</span>}
        </div>
        {!isOff && (
          <div className="text-[11px] mt-0.5" style={{ color: '#6aaa90' }}>
            {temp}°C · {MODE_LABELS[mode] || mode} · {WIND_LABELS[wind] || wind}
          </div>
        )}
        {error && (
          <div className="text-[10px] mt-0.5 truncate" style={{ color: '#e07070' }}>{error}</div>
        )}
      </div>

      {/* Status dot */}
      <div
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ background: success ? (isOff ? '#aaa' : '#4ade80') : '#f87171' }}
      />
    </div>
  )
}
