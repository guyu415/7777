import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, MapPin, X } from 'lucide-react'
import LocationMapImage from './LocationMapImage'
import { formatDistance } from '../../services/location'

export default function LocationMessageCard({ card, theme }) {
  const [open, setOpen] = useState(false)
  if (!card?.location) return null
  const title = card.address || '我的位置'
  const distance = Number(card.distanceMeters)
  const primary = theme?.primary || '#5bcaa4'

  return (
    <>
      <button type="button" aria-label={`打开定位详情：${title}`} onClick={() => setOpen(true)} className="block overflow-hidden text-left" style={{ width: 'min(70vw, 310px)', borderRadius: 16, border: 0, padding: 0, background: '#fff', boxShadow: '0 4px 18px rgba(45,36,42,.14)', color: '#3c3236' }}>
        <div className="truncate px-4 py-3 text-sm font-semibold">{title}</div>
        <LocationMapImage location={card.location} compact style={{ height: 150 }} />
      </button>

      {open && createPortal(<div className="fixed inset-0 z-[100]" role="dialog" aria-modal="true" aria-label="定位详情" style={{ background: '#17191b' }}>
        <LocationMapImage location={card.location} className="absolute inset-0" />
        <button onClick={() => setOpen(false)} aria-label="返回聊天" className="absolute grid place-items-center rounded-full" style={{ top: 'max(18px, env(safe-area-inset-top))', left: 18, width: 44, height: 44, border: 0, background: 'rgba(255,255,255,.94)', color: '#282527', boxShadow: '0 3px 14px rgba(0,0,0,.2)' }}><ArrowLeft size={23} /></button>
        <section className="absolute inset-x-0 bottom-0 rounded-t-[28px] px-6 pt-7" style={{ paddingBottom: 'max(28px, env(safe-area-inset-bottom))', background: '#fffafb', color: '#44383d', boxShadow: '0 -10px 32px rgba(0,0,0,.2)' }}>
          <div className="mx-auto mb-5 h-1 w-12 rounded-full" style={{ background: '#cfc5c9' }} />
          <h2 className="text-xl font-bold leading-snug">{title}</h2>
          <div className="mt-4 flex items-end gap-2">
            <span className="text-sm">距离 500 Howard Street</span>
            <strong className="text-xl" style={{ color: primary }}>{Number.isFinite(distance) ? formatDistance(distance) : '—'}</strong>
          </div>
          <p className="mt-2 text-xs opacity-55">直线距离 · 按给定坐标估算</p>
          <button onClick={() => setOpen(false)} className="mt-6 w-full rounded-full py-3 text-sm font-medium text-white" style={{ border: 0, background: primary }}><X size={16} className="mr-1 inline" />关闭</button>
        </section>
      </div>, document.body)}
    </>
  )
}
