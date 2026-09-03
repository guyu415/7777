import { CalendarHeart, MoonStar } from 'lucide-react'

function displayDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return ''
  return value.replaceAll('-', '.')
}

export default function BedtimeCard({ card }) {
  if (!card?.english) return null
  const title = card.title || 'A LITTLE NOTE BEFORE SLEEP'

  return (
    <article className="bedtime-card" aria-label="睡前英文寄语">
      <div className="bedtime-card__sky" aria-hidden="true">
        <span>✦</span><span>·</span><span>✧</span>
      </div>
      <div className="bedtime-card__heading">
        <span className="bedtime-card__moon"><MoonStar size={18} strokeWidth={1.55} /></span>
        <div>
          <div className="bedtime-card__eyebrow">GOOD NIGHT</div>
          <div className="bedtime-card__title">{title}</div>
        </div>
      </div>
      <blockquote>{card.english}</blockquote>
      {card.translation && <p className="bedtime-card__translation">{card.translation}</p>}
      <div className="bedtime-card__footer">
        <span>{card.signature || 'Sleep softly, dream freely.'}</span>
        <span className="bedtime-card__sync"><CalendarHeart size={12} /> {displayDate(card.date)} · 已存入纪念日</span>
      </div>

      <style>{`
        .bedtime-card { position:relative; width:min(100%,292px); box-sizing:border-box; overflow:hidden; padding:18px 18px 15px; border:1px solid rgba(218,207,255,.76); border-radius:24px 24px 24px 9px; color:#f9f7ff; background:radial-gradient(circle at 84% 14%,rgba(255,239,189,.2),transparent 25%),linear-gradient(145deg,#303555 0%,#42466d 52%,#625b82 100%); box-shadow:0 12px 28px rgba(41,42,75,.22),inset 0 1px 0 rgba(255,255,255,.18); user-select:text; }
        .bedtime-card::after { content:''; position:absolute; inset:6px; pointer-events:none; border:1px solid rgba(255,255,255,.1); border-radius:19px 19px 19px 6px; }
        .bedtime-card__sky { position:absolute; right:15px; top:10px; display:flex; align-items:center; gap:8px; color:#f9e8ad; opacity:.85; font-size:12px; }
        .bedtime-card__sky span:nth-child(2){font-size:18px;opacity:.55}.bedtime-card__sky span:nth-child(3){font-size:9px}
        .bedtime-card__heading { position:relative; z-index:1; display:flex; align-items:center; gap:10px; padding-right:42px; }
        .bedtime-card__moon { flex:none; width:34px; height:34px; display:grid; place-items:center; border:1px solid rgba(255,237,178,.36); border-radius:50%; color:#ffe9a8; background:rgba(255,255,255,.08); }
        .bedtime-card__eyebrow { color:#f6dfa1; font:600 9px/1.2 ui-sans-serif,sans-serif; letter-spacing:.2em; }
        .bedtime-card__title { margin-top:4px; color:#ded9f6; font:500 9px/1.25 ui-sans-serif,sans-serif; letter-spacing:.08em; }
        .bedtime-card blockquote { position:relative; z-index:1; margin:17px 1px 0; color:#fffdf9; font:italic 500 18px/1.55 Georgia,'Times New Roman',serif; letter-spacing:.012em; overflow-wrap:anywhere; }
        .bedtime-card__translation { position:relative; z-index:1; margin:11px 1px 0; padding-top:10px; border-top:1px solid rgba(255,255,255,.14); color:#dcd8eb; font:12px/1.65 var(--app-font,'Noto Sans SC',sans-serif); white-space:pre-wrap; }
        .bedtime-card__footer { position:relative; z-index:1; display:flex; flex-direction:column; gap:7px; margin-top:14px; color:#c8c4dc; font:italic 9px/1.35 Georgia,serif; }
        .bedtime-card__sync { display:flex; align-items:center; gap:5px; color:#e5d7b0; font:500 9px/1.25 var(--app-font,'Noto Sans SC',sans-serif); font-style:normal; }
      `}</style>
    </article>
  )
}
