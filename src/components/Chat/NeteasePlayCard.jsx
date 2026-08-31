import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ExternalLink, Music2, Play } from 'lucide-react'
import { getNeteaseLyrics } from '../../services/music'
import { attachPhonePlaybackLyrics, calibratePhonePlayback, getPlayerState, startPhonePlayback } from '../../services/player'

export default function NeteasePlayCard({ action }) {
  const songId = String(action?.songId || '').trim()
  const valid = /^\d+$/.test(songId)
  const [lyrics, setLyrics] = useState([])
  const [lyricsState, setLyricsState] = useState('loading')
  const [player, setPlayer] = useState(() => getPlayerState())
  const [expanded, setExpanded] = useState(false)
  const isThisPlayback = valid && player.action?.songId === songId && player.startedAt > 0
  const hasEnded = isThisPlayback && player.ended
  const isActive = isThisPlayback && !player.ended

  useEffect(() => {
    if (!valid) return
    let cancelled = false
    setLyricsState('loading')
    getNeteaseLyrics(songId).then((lines) => {
      if (cancelled) return
      setLyrics(lines)
      setLyricsState(lines.length ? 'ready' : 'empty')
      if (lines.length) setPlayer(attachPhonePlaybackLyrics(songId, lines))
    }).catch(() => { if (!cancelled) setLyricsState('empty') })
    return () => { cancelled = true }
  }, [songId, valid])

  useEffect(() => {
    if (!isActive) return undefined
    const tick = () => setPlayer(getPlayerState())
    tick()
    const timer = setInterval(tick, 700)
    return () => clearInterval(timer)
  }, [isActive, songId])

  const visibleLyrics = useMemo(() => {
    const source = isActive && player.lyrics?.length ? player.lyrics : lyrics
    if (!source.length) return []
    const activeIndex = isActive ? player.lyricIndex : -1
    const center = activeIndex >= 0 ? activeIndex : 0
    const start = Math.max(0, center - 1)
    return source.slice(start, center + 2).map((line, index) => ({ ...line, active: activeIndex >= 0 && start + index === activeIndex }))
  }, [isActive, lyrics, player.lyricIndex, player.lyrics])

  if (!valid) return null
  const deepLink = `orpheus://song/${songId}/?autoplay=1`
  const webUrl = `https://music.163.com/song?id=${songId}`
  const handlePlay = () => setPlayer(startPhonePlayback(action, lyrics))
  const nudge = (deltaMs) => setPlayer(calibratePhonePlayback(Math.max(0, player.positionMs + deltaMs)))
  const compactLyric = hasEnded
    ? '播放已结束'
    : isActive
    ? (player.currentLyric?.text || '正在等待第一句…')
    : (lyricsState === 'loading' ? '正在取歌词…' : (visibleLyrics[0]?.text || '点播放后显示歌词'))

  return (
    <div className={`netease-play-card${expanded ? ' is-expanded' : ''}`} onClick={() => setExpanded(value => !value)}>
      <div className="netease-play-card__glow" />
      <div className="netease-play-card__head">
        <div className={`netease-play-card__cover${isActive ? ' is-playing' : ''}`}>
          {action.cover ? <img src={action.cover} alt="" /> : <Music2 size={22} aria-hidden="true" />}
        </div>
        <div className="netease-play-card__info">
          <div className="netease-play-card__title">
            <strong>{action.name || '网易云歌曲'}</strong>
            <span>· {action.artists || action.album || '网易云音乐'}</span>
          </div>
          <p className="netease-play-card__compact-lyric">{compactLyric}</p>
        </div>
        <ChevronDown className="netease-play-card__chevron" size={13} aria-hidden="true" />
        <a className="netease-play-card__open" href={deepLink} onClick={(event) => { event.stopPropagation(); handlePlay() }} aria-label={`在网易云播放${action.name || '这首歌'}`}>
          <Play size={13} fill="currentColor" aria-hidden="true" />
        </a>
      </div>

      <div className="netease-play-card__expanded" aria-hidden={!expanded}>
      <div className="netease-play-card__lyrics" aria-live="polite">
        {lyricsState === 'loading' && <span className="netease-play-card__hint">正在取歌词…</span>}
        {lyricsState === 'empty' && <span className="netease-play-card__hint">这首歌暂时没有滚动歌词</span>}
        {lyricsState === 'ready' && !isActive && <><p className="is-preview">{visibleLyrics[0]?.text}</p><span className="netease-play-card__hint">点播放后开始估算同步</span></>}
        {lyricsState === 'ready' && isActive && visibleLyrics.map((line) => (
          <p key={`${line.timeMs}-${line.text}`} className={line.active ? 'is-current' : ''}>
            {line.text}{line.active && line.translation && <small>{line.translation}</small>}
          </p>
        ))}
      </div>

      <div className="netease-play-card__foot">
        {isActive ? <div className="netease-play-card__sync">
          <span><i />估算同步</span><button type="button" onClick={(event) => { event.stopPropagation(); nudge(-5000) }}>−5s</button><button type="button" onClick={(event) => { event.stopPropagation(); nudge(5000) }}>+5s</button>
        </div> : <span className="netease-play-card__source">网易云音乐</span>}
        <a className="netease-play-card__fallback" href={webUrl} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} aria-label="打开歌曲网页"><ExternalLink size={12} aria-hidden="true" /></a>
      </div>
      </div>

      <style>{`
        .netease-play-card { position:relative; width:min(306px,calc(100vw - 82px)); margin-top:8px; padding:10px; overflow:hidden; cursor:pointer; border:1px solid rgba(255,255,255,.56); border-radius:19px; background:linear-gradient(145deg,rgba(255,255,255,.58),rgba(255,231,240,.28)); box-shadow:inset 0 1px 0 rgba(255,255,255,.72),0 9px 24px rgba(99,60,78,.11); backdrop-filter:blur(20px) saturate(1.35); -webkit-backdrop-filter:blur(20px) saturate(1.35); transition:border-radius .25s ease,box-shadow .25s ease; }
        .netease-play-card.is-expanded { padding:13px; border-radius:22px; box-shadow:inset 0 1px 0 rgba(255,255,255,.72),0 12px 32px rgba(99,60,78,.13); }
        .netease-play-card__glow { position:absolute; width:150px; height:120px; right:-55px; top:-64px; pointer-events:none; border-radius:50%; background:rgba(255,174,198,.42); filter:blur(28px); }
        .netease-play-card__head { position:relative; display:flex; min-width:0; align-items:center; gap:10px; }
        .netease-play-card__cover { display:grid; width:44px; height:44px; flex:none; place-items:center; overflow:hidden; border:1px solid rgba(255,255,255,.7); border-radius:14px; color:#d84c69; background:rgba(255,255,255,.36); box-shadow:0 5px 14px rgba(108,66,82,.12); }
        .netease-play-card__cover.is-playing { animation:netease-cover-pulse 2.4s ease-in-out infinite; }
        .netease-play-card__cover img { width:100%; height:100%; object-fit:cover; }
        .netease-play-card__info { min-width:0; flex:1; }
        .netease-play-card__title { display:flex; min-width:0; align-items:baseline; gap:3px; }
        .netease-play-card__info strong,.netease-play-card__info span { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .netease-play-card__info strong { color:#5f4651; font-size:14px; line-height:1.35; }
        .netease-play-card__info span { min-width:0; color:rgba(101,72,84,.58); font-size:10.5px; }
        .netease-play-card__compact-lyric { margin:3px 0 0; overflow:hidden; color:rgba(95,69,80,.55); font-size:10.5px; line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }
        .netease-play-card__chevron { flex:none; color:rgba(93,67,77,.3); transition:transform .25s ease; }
        .netease-play-card.is-expanded .netease-play-card__chevron { transform:rotate(180deg); }
        .netease-play-card__open { display:grid; width:30px; height:30px; flex:none; place-items:center; padding:0; border:1px solid rgba(255,255,255,.66); border-radius:50%; color:#fff; background:linear-gradient(135deg,rgba(229,61,88,.92),rgba(217,77,117,.82)); box-shadow:0 5px 14px rgba(205,51,79,.2),inset 0 1px rgba(255,255,255,.25); text-decoration:none; -webkit-tap-highlight-color:transparent; }
        .netease-play-card__open:active { transform:scale(.96); }
        .netease-play-card__expanded { max-height:0; overflow:hidden; opacity:0; transition:max-height .3s ease,opacity .2s ease; }
        .netease-play-card.is-expanded .netease-play-card__expanded { max-height:150px; opacity:1; }
        .netease-play-card__lyrics { position:relative; display:flex; min-height:88px; flex-direction:column; justify-content:center; gap:4px; margin-top:11px; padding:9px 12px; overflow:hidden; border:1px solid rgba(255,255,255,.36); border-radius:16px; background:rgba(255,255,255,.2); mask-image:linear-gradient(to bottom,transparent,#000 18%,#000 82%,transparent); -webkit-mask-image:linear-gradient(to bottom,transparent,#000 18%,#000 82%,transparent); }
        .netease-play-card__lyrics p { margin:0; overflow:hidden; color:rgba(92,68,78,.34); font-size:11px; line-height:1.45; text-align:center; text-overflow:ellipsis; white-space:nowrap; transition:all .35s ease; }
        .netease-play-card__lyrics p.is-current,.netease-play-card__lyrics p.is-preview { color:#674954; font-size:13px; font-weight:650; text-shadow:0 1px rgba(255,255,255,.72); }
        .netease-play-card__lyrics small { display:block; margin-top:2px; color:rgba(103,73,84,.52); font-size:9px; font-weight:400; }
        .netease-play-card__hint { color:rgba(102,77,87,.48); font-size:10px; text-align:center; }
        .netease-play-card__foot { position:relative; display:flex; min-height:22px; align-items:flex-end; justify-content:space-between; margin-top:7px; }
        .netease-play-card__source { color:rgba(102,75,85,.45); font-size:9px; letter-spacing:.06em; }
        .netease-play-card__sync { display:flex; align-items:center; gap:5px; color:rgba(102,75,85,.52); font-size:9px; }
        .netease-play-card__sync span { display:flex; align-items:center; gap:4px; margin-right:2px; }
        .netease-play-card__sync i { width:5px; height:5px; border-radius:50%; background:#df5872; box-shadow:0 0 0 3px rgba(223,88,114,.12); }
        .netease-play-card__sync button { height:22px; padding:0 7px; border:1px solid rgba(255,255,255,.52); border-radius:8px; color:rgba(91,65,75,.66); background:rgba(255,255,255,.3); font:inherit; }
        .netease-play-card__fallback { display:grid; width:22px; height:22px; place-items:center; border-radius:8px; color:rgba(102,75,85,.46); background:rgba(255,255,255,.25); text-decoration:none; }
        @keyframes netease-cover-pulse { 50% { transform:translateY(-1px); box-shadow:0 7px 17px rgba(214,69,101,.2); } }
        @media (prefers-reduced-motion:reduce) { .netease-play-card__cover.is-playing { animation:none; } }
      `}</style>
    </div>
  )
}
