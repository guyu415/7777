import { Heart } from 'lucide-react'
import { extractHeartRate, heartBeatDurationMs } from '../../utils/heartRate'

export default function HeartRateCard({ content = '', streaming = false }) {
  const bpm = extractHeartRate(content)
  const duration = heartBeatDurationMs(bpm)
  const isReading = streaming && bpm === null

  return (
    <div
      className="heart-rate-card mt-1.5 mb-1"
      role="status"
      aria-live="polite"
      aria-label={bpm ? `Apple Watch 最近心率 ${bpm} BPM` : '正在读取 Apple Watch 心率'}
      style={{ '--heart-beat-duration': `${duration}ms` }}
    >
      <style>{`
        @keyframes watch-heart-beat {
          0%, 42%, 100% { transform: scale(1); }
          10% { transform: scale(1.17); }
          18% { transform: scale(.97); }
          27% { transform: scale(1.09); }
          35% { transform: scale(1); }
        }
        @keyframes watch-heart-aura {
          0%, 42%, 100% { opacity: .18; transform: scale(.76); }
          12% { opacity: .5; transform: scale(1.18); }
          34% { opacity: 0; transform: scale(1.36); }
        }
        @keyframes watch-heart-scan {
          0% { transform: translateX(-115%); opacity: 0; }
          18% { opacity: .52; }
          60%, 100% { transform: translateX(135%); opacity: 0; }
        }
        .heart-rate-card__heart,
        .heart-rate-card__aura {
          animation-duration: var(--heart-beat-duration);
          animation-timing-function: ease-out;
          animation-iteration-count: infinite;
          transform-origin: center;
        }
        .heart-rate-card__heart { animation-name: watch-heart-beat; }
        .heart-rate-card__aura { animation-name: watch-heart-aura; }
        .heart-rate-card__scan { animation: watch-heart-scan 1.8s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .heart-rate-card__heart, .heart-rate-card__aura, .heart-rate-card__scan { animation: none !important; }
        }
      `}</style>

      <div className="heart-rate-card__wash" aria-hidden="true" />
      <div className="heart-rate-card__scan" aria-hidden="true" />

      <div className="heart-rate-card__visual" aria-hidden="true">
        <span className="heart-rate-card__aura" />
        <span className="heart-rate-card__heart">
          <Heart size={38} strokeWidth={1.55} fill="#f44370" />
        </span>
      </div>

      <div className="heart-rate-card__copy">
        <div className="heart-rate-card__eyebrow">
          <span className={`heart-rate-card__dot${isReading ? ' is-reading' : ''}`} />
          Apple Watch · 最近一次记录
        </div>
        {bpm !== null ? (
          <div className="heart-rate-card__reading">
            <span>{bpm}</span><small>BPM</small>
          </div>
        ) : (
          <div className="heart-rate-card__loading">正在读取心率…</div>
        )}
      </div>
    </div>
  )
}

