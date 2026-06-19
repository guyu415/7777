import { useState, useRef, useEffect } from 'react'
import { Play, Pause } from 'lucide-react'
import { getBlob } from '../../store'

export default function VoicePlayer({ blobId, url: initialUrl, duration, isUser, naked }) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [audioUrl, setAudioUrl] = useState(initialUrl)
  const audioRef = useRef(null)

  useEffect(() => {
    if (!initialUrl && blobId) {
      getBlob(blobId).then(blob => {
        if (blob) setAudioUrl(URL.createObjectURL(blob))
      })
    }
  }, [blobId, initialUrl])

  useEffect(() => {
    if (!audioRef.current) return
    const audio = audioRef.current
    const onEnded = () => { setIsPlaying(false); setProgress(0) }
    const onTimeUpdate = () => setProgress(audio.currentTime / (audio.duration || 1))
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    return () => { audio.removeEventListener('ended', onEnded); audio.removeEventListener('timeupdate', onTimeUpdate) }
  }, [audioUrl])

  const toggle = () => {
    if (!audioRef.current) return
    if (isPlaying) {
      audioRef.current.pause()
    } else {
      audioRef.current.play()
    }
    setIsPlaying(!isPlaying)
  }

  const fmtDuration = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  const btnCls = isUser
    ? 'bg-white/20 text-white'
    : naked ? 'bg-white/30 text-[#3d6b52]' : 'bg-pink-100 text-pink-500'
  const waveCls = isUser ? 'bg-white/70' : naked ? 'bg-[#3d6b52]/60' : 'bg-pink-400'
  const trackCls = isUser ? 'bg-white/30' : naked ? 'bg-white/30' : 'bg-pink-100'
  const fillCls  = isUser ? 'bg-white'    : naked ? 'bg-[#3d6b52]/60' : 'bg-pink-400'
  const timeCls  = isUser ? 'text-white/80' : naked ? 'text-[#3d6b52]/70' : 'text-pink-400'

  return (
    <div className={naked
      ? 'flex items-center gap-2 min-w-[130px]'
      : `flex items-center gap-2 px-3 py-2 rounded-2xl min-w-[140px] ${isUser ? 'bg-pink-500' : 'bg-white border border-pink-100'}`}>
      {audioUrl && <audio ref={audioRef} src={audioUrl} preload="metadata" />}
      <button onClick={toggle} className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${btnCls}`}>
        {isPlaying ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="flex-1 flex items-center gap-1">
        {isPlaying ? (
          // Animated wave when playing
          <div className="flex items-end gap-[3px] h-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className={`w-[3px] rounded-full wave-bar ${waveCls}`} style={{ animationDelay: `${i * 0.1}s` }} />
            ))}
          </div>
        ) : (
          // Progress bar when paused
          <div className={`flex-1 h-1 rounded-full ${trackCls}`}>
            <div className={`h-full rounded-full transition-all ${fillCls}`} style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>
      <span className={`text-xs flex-shrink-0 ${timeCls}`}>{fmtDuration(duration || 0)}</span>
    </div>
  )
}
