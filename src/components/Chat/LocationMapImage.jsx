import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, Plus, Minus, LocateFixed } from 'lucide-react'
import { fetchCurrentLocationMap } from '../../services/companion'

export default function LocationMapImage({ location, className = '', style, compact = false }) {
  const viewport = useRef(null)
  const pointers = useRef(new Map())
  const [view, setView] = useState({ scale: 1.6, x: 0, y: 0 })
  const [retry, setRetry] = useState(0)
  const constrain = next => {
    const scale = Math.max(1, Math.min(4, next.scale))
    const width = viewport.current?.clientWidth || 0
    const height = viewport.current?.clientHeight || 0
    const xLimit = width * (scale - 1) / 2
    const yLimit = height * (scale - 1) / 2
    return { scale, x: Math.max(-xLimit, Math.min(xLimit, next.x)), y: Math.max(-yLimit, Math.min(yLimit, next.y)) }
  }
  const zoom = factor => setView(v => constrain({ scale: v.scale * factor, x: v.x * factor, y: v.y * factor }))
  const move = event => {
    if (!pointers.current.has(event.pointerId)) return
    const before = [...pointers.current.values()]
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const after = [...pointers.current.values()]
    if (after.length === 1) {
      setView(v => constrain({ ...v, x: v.x + after[0].x - before[0].x, y: v.y + after[0].y - before[0].y }))
    } else if (after.length === 2) {
      const center = points => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 })
      const gap = points => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      const a = center(before), b = center(after)
      const rect = viewport.current.getBoundingClientRect()
      setView(v => {
        const scale = Math.max(1, Math.min(4, v.scale * gap(after) / Math.max(1, gap(before))))
        const ratio = scale / v.scale
        return constrain({ scale, x: b.x - rect.left - rect.width / 2 - (a.x - rect.left - rect.width / 2 - v.x) * ratio, y: b.y - rect.top - rect.height / 2 - (a.y - rect.top - rect.height / 2 - v.y) * ratio })
      })
    }
  }
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!location) return
    const request = new AbortController()
    let objectUrl = ''
    setView({ scale: 1.6, x: 0, y: 0 })
    pointers.current.clear()
    setSrc('')
    setFailed(false)
    fetchCurrentLocationMap(location, request.signal).then(blob => {
      if (request.signal.aborted) return
      objectUrl = URL.createObjectURL(blob)
      setSrc(objectUrl)
    }).catch(() => {
      if (!request.signal.aborted) setFailed(true)
    })
    return () => {
      request.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [location?.latitude, location?.longitude, retry])

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: '#eceee8', fontFamily: 'system-ui, sans-serif', ...style }}>
      <div ref={viewport} className="absolute inset-0" style={{ touchAction: compact ? 'auto' : 'none', cursor: compact ? 'pointer' : 'grab' }}
        onPointerDown={compact ? undefined : event => {
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={compact ? undefined : move}
        onPointerUp={event => pointers.current.delete(event.pointerId)}
        onPointerCancel={event => pointers.current.delete(event.pointerId)}
        onLostPointerCapture={event => pointers.current.delete(event.pointerId)}>
        {src && <div className="absolute inset-0" style={{ transform: `translate(${compact ? 0 : view.x}px, ${compact ? 0 : view.y}px) scale(${compact ? 2 : view.scale})`, pointerEvents: 'none' }}>
          <img src={src} alt="当前位置地图" className="h-full w-full object-cover" draggable="false" onError={() => { setSrc(''); setFailed(true) }} />
          <svg width="38" height="54" viewBox="0 0 38 54" aria-hidden="true" style={{ position: 'absolute', left: '50%', top: '50%', transform: `translate(-50%, -100%) scale(${1 / (compact ? 2 : view.scale)})`, transformOrigin: 'bottom center', filter: 'drop-shadow(0 2px 2px #0003)' }}>
            <path d="M19 51V32" stroke="#08c66b" strokeWidth="5" strokeLinecap="round" />
            <circle cx="19" cy="19" r="18" fill="#08c66b" /><circle cx="19" cy="19" r="9" fill="white" />
          </svg>
        </div>}
      </div>
      {!src && !failed && <div className="absolute inset-0 grid place-items-center pointer-events-none" role="status"><Loader2 size={compact ? 18 : 24} className="animate-spin" style={{ color: '#8e7a82' }} /></div>}
      {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center" style={{ color: '#8e7a82', fontSize: 12 }}><MapPin size={24} /><span>地图暂时未加载</span>{!compact && <button type="button" onClick={() => setRetry(n => n + 1)}>重新加载</button>}</div>}
      {src && <span className="absolute bottom-1 right-1" style={{ fontSize: 10, background: '#ffffffdc', color: '#555', padding: '1px 4px', pointerEvents: 'none' }}>© 高德地图</span>}
      {!compact && src && <div className="absolute right-3 top-3 flex flex-col overflow-hidden rounded-xl shadow-md" style={{ background: '#fff', color: '#444' }}>
        <button type="button" aria-label="放大地图" disabled={view.scale >= 4} onClick={() => zoom(1.35)} className="grid h-11 w-11 place-items-center disabled:opacity-30"><Plus size={21} /></button>
        <button type="button" aria-label="缩小地图" disabled={view.scale <= 1} onClick={() => zoom(1 / 1.35)} className="grid h-11 w-11 place-items-center disabled:opacity-30"><Minus size={21} /></button>
        <button type="button" aria-label="回到定位点" onClick={() => setView({ scale: 1.6, x: 0, y: 0 })} className="grid h-11 w-11 place-items-center"><LocateFixed size={20} /></button>
      </div>}
    </div>
  )
}
