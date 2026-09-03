import { CheckCircle2, Clock3, MessageCircleMore, TimerOff } from 'lucide-react'

export default function FocusSummaryCard({ summary, theme }) {
  if (!summary) return null
  const completed = summary.reason === 'completed'
  const primary = theme?.primary || '#7fcfc9'
  const actual = Math.max(0, Number(summary.actualMinutes) || 0)
  const planned = Math.max(1, Number(summary.plannedMinutes) || 1)
  const pct = Math.min(100, Math.round(actual / planned * 100))

  return (
    <section
      aria-label="本次专注总结"
      style={{
        width: 'min(286px, 72vw)', padding: '15px 16px', borderRadius: 22,
        background: 'linear-gradient(145deg, rgba(235,255,253,.88), rgba(218,243,255,.76))',
        border: '1px solid rgba(255,255,255,.82)',
        boxShadow: '0 10px 30px rgba(77,154,175,.18), inset 0 1px 0 rgba(255,255,255,.9)',
        backdropFilter: 'blur(18px) saturate(145%)', WebkitBackdropFilter: 'blur(18px) saturate(145%)',
        color: '#315d69', overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ width: 31, height: 31, borderRadius: 12, display: 'grid', placeItems: 'center', color: primary, background: 'rgba(255,255,255,.62)' }}>
          {completed ? <CheckCircle2 size={18} /> : <TimerOff size={18} />}
        </span>
        <div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 14 }}>{completed ? '本次学习完成' : '本次学习已结束'}</strong>
          <span style={{ display: 'block', fontSize: 11, opacity: .68, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary.task || '专注学习'}</span>
        </div>
      </div>

      <div style={{ height: 5, margin: '13px 0 11px', borderRadius: 999, background: 'rgba(82,151,167,.13)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 'inherit', background: `linear-gradient(90deg, ${primary}, #75bfe5)` }} />
      </div>

      <div style={{ display: 'flex', gap: 18, fontSize: 11.5 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Clock3 size={13} /> 实际 {actual} 分钟</span>
        <span style={{ opacity: .7 }}>计划 {planned} 分钟</span>
      </div>
      {Number(summary.interactionCount) > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 10.5, opacity: .68 }}>
          <MessageCircleMore size={12} /> 专注中互动 {summary.interactionCount} 次
        </div>
      )}
    </section>
  )
}
