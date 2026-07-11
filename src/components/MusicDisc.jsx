import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, Play, Pause, X } from 'lucide-react'
import { searchSongs, getPlayUrl } from '../services/music'

function fmt(s) {
  if (!Number.isFinite(s)) return '0:00'
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// 网易云碟片挂件：收起是一张小黑胶（播放时旋转），点开是搜歌 + 迷你播放器。
// visible=false 时只隐藏 UI，不卸载组件，切页面音乐不断。
export default function MusicDisc({ theme, visible = true }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [current, setCurrent] = useState(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [err, setErr] = useState('')
  const audioRef = useRef(null)

  const primary = theme?.primary || '#ff85b3'

  const getAudio = () => {
    if (!audioRef.current) {
      const a = new Audio()
      a.addEventListener('timeupdate', () => setProgress(a.currentTime))
      a.addEventListener('durationchange', () => setDuration(a.duration || 0))
      a.addEventListener('play', () => setPlaying(true))
      a.addEventListener('pause', () => setPlaying(false))
      a.addEventListener('ended', () => setPlaying(false))
      audioRef.current = a
    }
    return audioRef.current
  }

  useEffect(() => () => { try { audioRef.current?.pause() } catch {} }, [])

  const handleSearch = async () => {
    const kw = query.trim()
    if (!kw || searching) return
    setSearching(true)
    setErr('')
    try {
      setResults(await searchSongs(kw))
    } catch (e) {
      setErr(e.message)
    } finally {
      setSearching(false)
    }
  }

  const playSong = useCallback(async (song) => {
    setErr('')
    try {
      const { ok, url } = await getPlayUrl(song.id)
      if (!ok || !url) {
        setErr(song.fee === 1
          ? '这首是 VIP 歌曲，需要在 Worker 配置 NCM_COOKIE（VIP 账号）才能播'
          : '拿不到播放链接，可能无版权或已下架')
        return
      }
      const a = getAudio()
      a.src = url
      await a.play()
      setCurrent(song)
      // 锁屏/控制中心显示歌曲信息
      if ('mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: song.name, artist: song.artists, album: song.album,
            artwork: song.cover ? [{ src: song.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
          })
          navigator.mediaSession.setActionHandler('play', () => getAudio().play())
          navigator.mediaSession.setActionHandler('pause', () => getAudio().pause())
        } catch {}
      }
    } catch (e) {
      setErr(`播放失败：${e.message}`)
    }
  }, [])

  const togglePlay = () => {
    const a = getAudio()
    if (!a.src) return
    if (a.paused) a.play().catch(() => {})
    else a.pause()
  }

  const seek = (e) => {
    const a = getAudio()
    if (!a.src || !duration) return
    a.currentTime = Number(e.target.value)
  }

  if (!visible) return null

  return (
    <div style={{ position: 'absolute', right: 10, top: 86, zIndex: 30 }}>
      <style>{`@keyframes disc-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* 收起态：小黑胶 */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            width: 54, height: 54, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer',
            background: 'radial-gradient(circle at center, #3a3a3e 0%, #1c1c20 62%, #2a2a2e 100%)',
            boxShadow: `0 4px 16px rgba(0,0,0,0.28), 0 0 0 2px ${primary}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'disc-spin 8s linear infinite',
            animationPlayState: playing ? 'running' : 'paused',
          }}
        >
          {current?.cover ? (
            <img src={current.cover} alt="" style={{ width: 34, height: 34, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,0.25)' }} />
          ) : (
            <span style={{ fontSize: 20 }}>🎵</span>
          )}
        </button>
      )}

      {/* 展开态：搜歌 + 迷你播放器 */}
      {open && (
        <div style={{
          width: 'min(300px, calc(100vw - 24px))',
          background: 'rgba(255,255,255,0.82)',
          backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 18, padding: 12,
          border: `1px solid ${primary}33`,
          boxShadow: '0 10px 36px rgba(0,0,0,0.16)',
        }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold" style={{ color: '#8b5060' }}>🎶 网易云点歌</span>
            <button onClick={() => setOpen(false)} style={{ border: 'none', background: 'transparent', color: '#b08794', cursor: 'pointer', padding: 4 }}>
              <X size={16} />
            </button>
          </div>

          <div className="flex gap-2 mb-2">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="歌名 / 歌手"
              style={{
                flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.7)',
                border: `1px solid ${primary}33`, borderRadius: 12,
                padding: '7px 12px', fontSize: 14, color: '#8b5060', outline: 'none', fontFamily: 'inherit',
              }}
            />
            <button
              onClick={handleSearch}
              disabled={searching}
              style={{
                width: 36, height: 36, borderRadius: 12, border: 'none', cursor: 'pointer',
                background: `${primary}22`, color: primary,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}
            >
              <Search size={16} />
            </button>
          </div>

          {err && <p className="text-xs mb-2" style={{ color: '#e07070' }}>{err}</p>}
          {searching && <p className="text-xs mb-2" style={{ color: '#b08794' }}>搜索中…</p>}

          {results.length > 0 && (
            <div style={{ maxHeight: 220, overflowY: 'auto', margin: '0 -4px' }}>
              {results.map(song => (
                <button
                  key={song.id}
                  onClick={() => playSong(song)}
                  className="w-full flex items-center gap-2 text-left"
                  style={{
                    border: 'none', cursor: 'pointer', padding: '6px 4px', borderRadius: 10,
                    background: current?.id === song.id ? `${primary}18` : 'transparent',
                  }}
                >
                  {song.cover
                    ? <img src={`${song.cover}?param=80y80`} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', flexShrink: 0 }} />
                    : <div style={{ width: 34, height: 34, borderRadius: 8, background: `${primary}22`, flexShrink: 0 }} />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <p className="text-sm truncate" style={{ color: '#7a4a58' }}>{song.name}{song.fee === 1 && <span style={{ color: primary, fontSize: 10 }}> VIP</span>}</p>
                    <p className="text-xs truncate" style={{ color: '#b08794' }}>{song.artists}</p>
                  </div>
                  <span className="text-xs flex-shrink-0" style={{ color: '#c9a2ad' }}>{fmt(song.duration)}</span>
                </button>
              ))}
            </div>
          )}

          {current && (
            <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${primary}22` }}>
              <div className="flex items-center gap-2">
                <img
                  src={current.cover ? `${current.cover}?param=100y100` : ''}
                  alt=""
                  style={{
                    width: 38, height: 38, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                    animation: 'disc-spin 8s linear infinite',
                    animationPlayState: playing ? 'running' : 'paused',
                    border: `2px solid ${primary}44`,
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <p className="text-sm truncate" style={{ color: '#7a4a58' }}>{current.name}</p>
                  <p className="text-xs truncate" style={{ color: '#b08794' }}>{current.artists}</p>
                </div>
                <button
                  onClick={togglePlay}
                  style={{
                    width: 38, height: 38, borderRadius: '50%', border: 'none', cursor: 'pointer',
                    background: `linear-gradient(135deg, ${primary}, ${primary}cc)`, color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    boxShadow: `0 4px 12px ${primary}55`,
                  }}
                >
                  {playing ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: 2 }} />}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <span className="text-xs" style={{ color: '#c9a2ad', width: 32 }}>{fmt(progress)}</span>
                <input
                  type="range" min="0" max={duration || 0} step="1" value={Math.min(progress, duration || 0)}
                  onChange={seek}
                  style={{ flex: 1, accentColor: primary, height: 4 }}
                />
                <span className="text-xs" style={{ color: '#c9a2ad', width: 32, textAlign: 'right' }}>{fmt(duration)}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
