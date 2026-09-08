import { useEffect, useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import { fetchCurrentLocationMap } from '../../services/companion'

export default function LocationMapImage({ location, className = '', style, compact = false }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!location) return
    const request = new AbortController()
    let objectUrl = ''
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
  }, [location?.latitude, location?.longitude])

  return (
    <div className={`relative overflow-hidden ${className}`} style={{ background: '#e9e3e6', ...style }}>
      {src && <img src={src} alt="当前位置地图" className="h-full w-full object-cover" draggable="false" />}
      {!src && !failed && <div className="absolute inset-0 grid place-items-center" role="status"><Loader2 size={compact ? 18 : 24} className="animate-spin" style={{ color: '#8e7a82' }} /></div>}
      {failed && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center" style={{ color: '#8e7a82' }}><MapPin size={compact ? 22 : 30} /><span style={{ fontSize: compact ? 11 : 13 }}>地图加载失败，请刷新重试</span></div>}
    </div>
  )
}
