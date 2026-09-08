import { useEffect, useRef, useState } from 'react'
import { Loader2, MapPin, RefreshCw, X } from 'lucide-react'
import { getCurrentLocation, distanceMeters, formatDistance } from '../../services/location'
import { resolveCurrentLocation } from '../../services/companion'
import LocationMapImage from './LocationMapImage'

export default function LocationPreview({ theme, onClose, onConfirm }) {
  const [attempt, setAttempt] = useState(0)
  const [location, setLocation] = useState(null)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const sent = useRef(false)
  const closeRef = useRef(null)
  const primary = theme?.primary || '#d880a1'

  useEffect(() => {
    const previousFocus = document.activeElement
    closeRef.current?.focus()
    return () => previousFocus?.focus?.()
  }, [])

  useEffect(() => {
    const request = new AbortController()
    let lookupTimer
    setBusy(true)
    setError('')
    setLocation(null)
    setAddress('')
    setExpired(false)
    const run = async () => {
      try {
        const fix = await getCurrentLocation({ signal: request.signal })
        if (request.signal.aborted) return
        setLocation(fix)
        const lookup = new AbortController()
        const cancelLookup = () => lookup.abort()
        request.signal.addEventListener('abort', cancelLookup, { once: true })
        lookupTimer = setTimeout(cancelLookup, 8000)
        try {
          const result = await resolveCurrentLocation(fix, lookup.signal)
          if (!request.signal.aborted) setAddress(typeof result?.address === 'string' ? result.address : '')
        } catch {
          // A valid GPS fix still supports the map and distance without an address.
        } finally {
          clearTimeout(lookupTimer)
          request.signal.removeEventListener('abort', cancelLookup)
        }
      } catch (e) {
        if (!request.signal.aborted) setError(e.message || '定位失败，请重试')
      } finally {
        if (!request.signal.aborted) setBusy(false)
      }
    }
    void run()
    return () => { request.abort(); clearTimeout(lookupTimer) }
  }, [attempt])

  useEffect(() => {
    if (!location) return
    const timer = setTimeout(() => setExpired(true), Math.max(0, location.timestamp + 120000 - Date.now()))
    return () => clearTimeout(timer)
  }, [location])

  const confirm = () => {
    if (!location || busy || sent.current) return
    if (Date.now() - location.timestamp >= 120000) { setExpired(true); return }
    sent.current = true
    onConfirm(location, address)
  }

  const trapKeys = event => {
    if (event.key === 'Escape') onClose()
    if (event.key !== 'Tab') return
    const items = [...event.currentTarget.querySelectorAll('button:not(:disabled), a[href], iframe')]
    const first = items[0], last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-3" style={{ background: 'rgba(48,35,45,.3)', backdropFilter: 'blur(5px)' }} onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="location-preview-title" onKeyDown={trapKeys} onClick={e => e.stopPropagation()}
        className="w-full max-w-md rounded-3xl overflow-y-auto shadow-xl" style={{ background: '#fffafb', color: '#664954', maxHeight: 'calc(100dvh - 32px)', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3">
          <h2 id="location-preview-title" className="text-base font-semibold flex items-center gap-2"><MapPin size={19} />发送当前位置</h2>
          <button ref={closeRef} onClick={onClose} aria-label="关闭定位预览" className="w-10 h-10 rounded-full grid place-items-center"><X size={20} /></button>
        </div>
        <div className="mx-4 rounded-2xl overflow-hidden" style={{ height: 'clamp(190px, 34dvh, 280px)', background: '#f0e9ed' }}>
          {location ? <LocationMapImage location={location} className="h-full w-full" />
            : <div className="h-full flex flex-col items-center justify-center gap-3 px-5 text-center text-sm" role="status">{busy && <Loader2 className="animate-spin" />}<span>{error || '正在获取你的位置…'}</span></div>}
        </div>
        <div className="px-5 pt-3 space-y-3">
          {location && <div className="text-sm" aria-live="polite">
            <p className="font-medium">{address || (busy ? '正在解析地址…' : '我的位置')}</p>
          </div>}
          <div className="rounded-2xl p-4" style={{ background: '#f8edf2' }}>
            <p className="text-xs">距离 500 Howard Street</p>
            <p className="text-2xl font-semibold mt-1" style={{ color: primary }}>{location ? formatDistance(distanceMeters(location)) : '等待定位'}</p>
            <p className="text-xs mt-1 opacity-60">直线距离 · 按给定坐标估算</p>
          </div>
          {expired && <p role="status" className="text-xs text-rose-600">定位已超过两分钟，请刷新后再发送。</p>}
          <div className="flex gap-3 pt-1">
            <button onClick={() => setAttempt(n => n + 1)} disabled={busy} className="rounded-full py-3 px-4 text-sm flex items-center gap-1.5 disabled:opacity-40" style={{ background: '#f0e8ec' }}><RefreshCw size={15} />刷新</button>
            <button onClick={confirm} disabled={!location || busy || expired} className="flex-1 rounded-full py-3 text-sm font-medium text-white disabled:opacity-40" style={{ background: primary }}>发送此定位</button>
          </div>
        </div>
      </section>
    </div>
  )
}
