import { ExternalLink, Music2 } from 'lucide-react'

export default function NeteasePlayCard({ action }) {
  const songId = String(action?.songId || '').trim()
  if (!/^\d+$/.test(songId)) return null
  // Rebuild both hrefs from the validated numeric id instead of trusting a
  // persisted/synced message to provide a navigation URL.
  const deepLink = `orpheus://song/${songId}/?autoplay=1`
  const webUrl = `https://music.163.com/song?id=${songId}`

  return (
    <div className="netease-play-card">
      <div className="netease-play-card__song">
        <div className="netease-play-card__cover">
          {action.cover
            ? <img src={action.cover} alt="" />
            : <Music2 size={24} aria-hidden="true" />}
        </div>
        <div className="netease-play-card__info">
          <strong>{action.name || '网易云歌曲'}</strong>
          <span>{action.artists || action.album || '网易云音乐'}</span>
        </div>
      </div>

      <a className="netease-play-card__open" href={deepLink} aria-label={`在网易云播放${action.name || '这首歌'}`}>
        <Music2 size={16} aria-hidden="true" />
        <span>在网易云播放</span>
      </a>

      <a className="netease-play-card__fallback" href={webUrl} target="_blank" rel="noreferrer">
        App 没打开？查看歌曲页 <ExternalLink size={12} aria-hidden="true" />
      </a>

      <style>{`
        .netease-play-card {
          width: min(286px, calc(100vw - 92px));
          margin-top: 7px;
          padding: 12px;
          border: 1px solid rgba(208, 111, 139, .2);
          border-radius: 19px;
          background: linear-gradient(145deg, rgba(255,255,255,.91), rgba(255,238,244,.9));
          box-shadow: 0 7px 20px rgba(128, 74, 96, .1);
        }
        .netease-play-card__song { display: flex; min-width: 0; align-items: center; gap: 10px; }
        .netease-play-card__cover {
          display: grid;
          width: 48px;
          height: 48px;
          flex: none;
          place-items: center;
          overflow: hidden;
          border-radius: 14px;
          color: #d54f68;
          background: rgba(228, 63, 86, .1);
        }
        .netease-play-card__cover img { width: 100%; height: 100%; object-fit: cover; }
        .netease-play-card__info { min-width: 0; flex: 1; }
        .netease-play-card__info strong,
        .netease-play-card__info span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .netease-play-card__info strong { color: #694c57; font-size: 14px; line-height: 1.35; }
        .netease-play-card__info span { margin-top: 4px; color: #a1848e; font-size: 11px; }
        .netease-play-card__open {
          display: flex;
          height: 42px;
          align-items: center;
          justify-content: center;
          gap: 7px;
          margin-top: 11px;
          border-radius: 999px;
          color: #fff;
          background: #e64356;
          box-shadow: 0 6px 14px rgba(220, 55, 78, .22);
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          -webkit-tap-highlight-color: transparent;
        }
        .netease-play-card__open:active { transform: scale(.98); }
        .netease-play-card__fallback {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
          margin-top: 9px;
          color: #ad8994;
          font-size: 10px;
          text-decoration: none;
        }
      `}</style>
    </div>
  )
}
