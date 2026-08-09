import { useCallback, useEffect, useRef, useState } from 'react'

const EXIT_MS = 680

function getScene() {
  const preview = new URLSearchParams(window.location.search).get('splash')
  if (preview === 'day' || preview === 'night') return preview
  const hour = new Date().getHours()
  return hour >= 6 && hour < 18 ? 'day' : 'night'
}

export default function OpeningSplash() {
  const [scene] = useState(getScene)
  const [leaving, setLeaving] = useState(false)
  const [visible, setVisible] = useState(true)
  const closingRef = useRef(false)
  const timersRef = useRef([])

  const close = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setLeaving(true)
    timersRef.current.push(window.setTimeout(() => setVisible(false), EXIT_MS))
  }, [])

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    timersRef.current.push(window.setTimeout(close, reduceMotion ? 900 : 3200))
    return () => timersRef.current.forEach(window.clearTimeout)
  }, [close])

  if (!visible) return null

  return (
    <div
      className={`opening-splash opening-splash--${scene}${leaving ? ' opening-splash--leaving' : ''}`}
      onPointerDown={close}
      aria-label="Eunoia 启动画面，轻触进入"
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') close()
      }}
    >
      {scene === 'day' ? (
        <div className="opening-splash__day" aria-hidden="true">
          <div className="opening-splash__scene-photo opening-splash__scene-photo--day" />
          <div className="opening-splash__sunlight" />
          <div className="opening-splash__sea opening-splash__sea--back" />
          <div className="opening-splash__foam opening-splash__foam--back" />
          <div className="opening-splash__sea opening-splash__sea--front" />
          <div className="opening-splash__foam opening-splash__foam--front" />
          <div className="opening-splash__shallows" />
        </div>
      ) : (
        <div className="opening-splash__night" aria-hidden="true">
          <div className="opening-splash__scene-photo opening-splash__scene-photo--night" />
          <div className="opening-splash__sunset-glow" />
          <div className="opening-splash__cloud opening-splash__cloud--far" />
          <div className="opening-splash__cloud opening-splash__cloud--middle" />
          <div className="opening-splash__cloud opening-splash__cloud--near" />
          <div className="opening-splash__horizon" />
        </div>
      )}

      <div className="opening-splash__grain" aria-hidden="true" />
      <div className="opening-splash__brand" aria-hidden="true">
        <img src="/backgrounds/eunoia-crystal-title-v1.webp" alt="" />
      </div>

      <style>{`
        .opening-splash {
          position: fixed;
          inset: 0;
          z-index: 10000;
          overflow: hidden;
          isolation: isolate;
          background: #82c9c4;
          cursor: pointer;
          touch-action: manipulation;
          animation: opening-splash-arrive 700ms cubic-bezier(.2,.7,.2,1) both;
        }

        .opening-splash--leaving {
          pointer-events: none;
          animation: opening-splash-leave ${EXIT_MS}ms cubic-bezier(.45,0,.8,1) both;
        }

        .opening-splash__day,
        .opening-splash__night {
          position: absolute;
          inset: 0;
          overflow: hidden;
        }

        .opening-splash__day {
          background:
            radial-gradient(circle at 78% 14%, rgba(255,255,220,.42), transparent 27%),
            linear-gradient(158deg, #187f86 0%, #25aaa5 43%, #78d0c1 66%, #d9cfac 100%);
        }

        .opening-splash__scene-photo {
          position: absolute;
          inset: -3%;
          background-position: center;
          background-repeat: no-repeat;
          background-size: cover;
          will-change: transform;
        }

        .opening-splash__scene-photo--day {
          background-image: url('/backgrounds/eunoia-splash-day.webp');
          animation: opening-splash-water-drift 3.9s cubic-bezier(.42,0,.58,1) infinite;
        }

        .opening-splash__scene-photo--night {
          inset: -14% -24%;
          background-image: url('/backgrounds/eunoia-splash-night.webp');
          animation: opening-splash-sky-drift 4.1s cubic-bezier(.42,0,.58,1) infinite alternate;
        }

        .opening-splash__scene-photo--night::after {
          content: '';
          position: absolute;
          inset: -12%;
          background: inherit;
          background-position: 50% 38%;
          background-size: cover;
          opacity: .3;
          mix-blend-mode: screen;
          -webkit-mask-image: linear-gradient(180deg, #000 0 62%, transparent 88%);
          mask-image: linear-gradient(180deg, #000 0 62%, transparent 88%);
          animation: opening-splash-cloud-rush 3.6s cubic-bezier(.45,0,.55,1) infinite alternate;
        }

        .opening-splash__sunlight {
          position: absolute;
          inset: -20%;
          opacity: .65;
          background:
            repeating-linear-gradient(108deg, transparent 0 28px, rgba(255,255,255,.055) 31px 33px, transparent 37px 70px),
            radial-gradient(ellipse at 50% 25%, rgba(218,255,240,.34), transparent 47%);
          filter: blur(2px);
          animation: opening-splash-shimmer 3.2s ease-in-out infinite alternate;
        }

        .opening-splash__sea {
          position: absolute;
          left: -28%;
          width: 156%;
          border-radius: 0 0 48% 52%;
          transform: rotate(-5deg);
          transform-origin: 50% 0;
          will-change: transform;
        }

        .opening-splash__sea--back {
          top: -22%;
          height: 76%;
          opacity: .12;
          background:
            radial-gradient(ellipse at 26% 96%, rgba(255,255,255,.16) 0 10%, transparent 28%),
            linear-gradient(180deg, rgba(7,90,102,.74), rgba(19,154,156,.4));
          animation: opening-splash-tide-back 3.9s ease-in-out infinite;
        }

        .opening-splash__sea--front {
          top: -18%;
          height: 91%;
          background:
            radial-gradient(ellipse at 68% 88%, rgba(158,237,220,.4), transparent 30%),
            radial-gradient(ellipse at 22% 97%, rgba(203,249,235,.35), transparent 27%),
            linear-gradient(180deg, rgba(9,107,117,.5), rgba(22,175,166,.66));
          box-shadow: 0 22px 28px rgba(229,255,246,.28);
          opacity: .14;
          mix-blend-mode: screen;
          animation: opening-splash-tide-front 3.9s ease-in-out infinite;
        }

        .opening-splash__foam {
          position: absolute;
          left: -35%;
          width: 170%;
          height: 24%;
          border-radius: 50%;
          transform: rotate(-5deg);
          filter: blur(.5px);
          will-change: transform;
          background:
            radial-gradient(ellipse at 7% 48%, rgba(255,255,255,.9) 0 2%, transparent 3.4%),
            radial-gradient(ellipse at 18% 50%, rgba(255,255,255,.82) 0 3%, transparent 4.6%),
            radial-gradient(ellipse at 32% 43%, rgba(255,255,255,.9) 0 2.7%, transparent 4.5%),
            radial-gradient(ellipse at 48% 52%, rgba(255,255,255,.78) 0 3.4%, transparent 5%),
            radial-gradient(ellipse at 64% 46%, rgba(255,255,255,.92) 0 2.6%, transparent 4.7%),
            radial-gradient(ellipse at 79% 55%, rgba(255,255,255,.86) 0 3.5%, transparent 5.3%),
            radial-gradient(ellipse at 93% 43%, rgba(255,255,255,.82) 0 2.8%, transparent 4.8%),
            radial-gradient(ellipse at 50% 44%, rgba(247,255,252,.9) 0 12%, rgba(255,255,255,.28) 35%, transparent 65%);
        }

        .opening-splash__foam--back {
          top: 40%;
          opacity: .18;
          animation: opening-splash-foam-back 3.9s ease-in-out infinite;
        }

        .opening-splash__foam--front {
          opacity: .3;
          top: 57%;
          animation: opening-splash-foam-front 3.9s ease-in-out infinite;
        }

        .opening-splash__shallows {
          position: absolute;
          inset: 57% -20% -28%;
          background:
            radial-gradient(ellipse at 20% 10%, rgba(255,255,255,.28), transparent 24%),
            radial-gradient(ellipse at 74% 6%, rgba(255,255,255,.24), transparent 27%),
            linear-gradient(170deg, rgba(154,226,206,.38), rgba(224,210,174,.94));
          filter: blur(1px);
          opacity: .18;
          mix-blend-mode: screen;
          animation: opening-splash-shallows 3.9s ease-in-out infinite;
        }

        .opening-splash__night {
          background:
            radial-gradient(ellipse at 66% 58%, rgba(255,188,139,.58), transparent 33%),
            linear-gradient(180deg, #172348 0%, #57436d 38%, #bc687d 66%, #f1a77d 100%);
        }

        .opening-splash__sunset-glow {
          position: absolute;
          left: 50%;
          top: 61%;
          width: 96vw;
          height: 42vw;
          min-width: 430px;
          min-height: 190px;
          transform: translate(-50%, -50%);
          border-radius: 50%;
          background: radial-gradient(ellipse, rgba(255,219,167,.28), rgba(255,157,137,.12) 45%, transparent 72%);
          filter: blur(7px);
          animation: opening-splash-glow 5.5s ease-in-out infinite alternate;
        }

        .opening-splash__cloud {
          position: absolute;
          left: -35%;
          width: 180%;
          border-radius: 50%;
          will-change: transform;
          background:
            radial-gradient(ellipse at 12% 58%, currentColor 0 8%, transparent 9%),
            radial-gradient(ellipse at 26% 48%, currentColor 0 12%, transparent 13%),
            radial-gradient(ellipse at 43% 62%, currentColor 0 10%, transparent 11%),
            radial-gradient(ellipse at 61% 45%, currentColor 0 13%, transparent 14%),
            radial-gradient(ellipse at 78% 61%, currentColor 0 11%, transparent 12%),
            radial-gradient(ellipse at 94% 52%, currentColor 0 9%, transparent 10%);
          filter: blur(2px);
        }

        .opening-splash__night .opening-splash__cloud {
          display: none;
        }

        .opening-splash__cloud--far {
          top: 20%;
          height: 25%;
          color: rgba(202,154,178,.2);
          animation: opening-splash-cloud-left 16s ease-in-out infinite alternate;
        }

        .opening-splash__cloud--middle {
          top: 39%;
          height: 29%;
          color: rgba(255,170,157,.26);
          filter: blur(4px);
          animation: opening-splash-cloud-right 13s ease-in-out infinite alternate;
        }

        .opening-splash__cloud--near {
          top: 61%;
          height: 30%;
          color: rgba(59,49,80,.3);
          filter: blur(2px);
          animation: opening-splash-cloud-left 11s ease-in-out infinite alternate-reverse;
        }

        .opening-splash__horizon {
          position: absolute;
          left: -15%;
          right: -15%;
          bottom: -10%;
          height: 38%;
          background: linear-gradient(180deg, transparent, rgba(16,20,46,.2));
          filter: blur(3px);
        }

        .opening-splash__grain {
          position: absolute;
          inset: -50%;
          z-index: 2;
          pointer-events: none;
          opacity: .16;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.25'/%3E%3C/svg%3E");
          animation: opening-splash-grain 900ms steps(2) infinite;
        }

        .opening-splash__brand {
          position: absolute;
          z-index: 3;
          left: 50%;
          top: 50%;
          transform: translate(-50%, -50%);
          width: min(82vw, 520px);
          line-height: 0;
          mix-blend-mode: screen;
          filter: drop-shadow(0 13px 18px rgba(9,34,51,.3));
          animation: opening-splash-brand 1.1s cubic-bezier(.2,.75,.2,1) both;
        }

        .opening-splash__brand img {
          display: block;
          width: 100%;
          height: auto;
        }

        @keyframes opening-splash-arrive {
          from { opacity: 1; transform: scale(1.025); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes opening-splash-leave {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(1.025); }
        }
        @keyframes opening-splash-brand {
          0% { opacity: 0; transform: translate(-50%, -43%) scale(.94); filter: drop-shadow(0 8px 12px rgba(28,47,68,.14)); }
          100% { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: drop-shadow(0 13px 17px rgba(28,47,68,.22)); }
        }
        @keyframes opening-splash-tide-front {
          0%, 100% { transform: rotate(-7deg) translate3d(-3%, -24%, 0) scale(1.08); }
          52% { transform: rotate(-2deg) translate3d(4%, 24%, 0) scale(1.2); }
        }
        @keyframes opening-splash-tide-back {
          0%, 100% { transform: rotate(-7deg) translate3d(3%, -16%, 0) scale(1.05); }
          52% { transform: rotate(-2deg) translate3d(-4%, 18%, 0) scale(1.16); }
        }
        @keyframes opening-splash-foam-front {
          0%, 100% { transform: rotate(-8deg) translate3d(-4%, -58%, 0) scale(.92); opacity: .08; }
          52% { transform: rotate(-1deg) translate3d(5%, 92%, 0) scale(1.28); opacity: .4; }
        }
        @keyframes opening-splash-foam-back {
          0%, 100% { transform: rotate(-8deg) translate3d(5%, -42%, 0) scale(.96); opacity: .08; }
          52% { transform: rotate(-1deg) translate3d(-5%, 70%, 0) scale(1.2); opacity: .28; }
        }
        @keyframes opening-splash-shallows {
          0%, 100% { transform: translate3d(0, -34%, 0) scaleY(.8); opacity: .04; }
          52% { transform: translate3d(0, 27%, 0) scaleY(1.28); opacity: .3; }
        }
        @keyframes opening-splash-shimmer {
          from { transform: translate3d(-8%, -6%, 0) rotate(-2deg) scale(.94); }
          to { transform: translate3d(10%, 8%, 0) rotate(3deg) scale(1.14); }
        }
        @keyframes opening-splash-water-drift {
          0%, 100% { transform: translate3d(7%, -11%, 0) scale(1.17); }
          52% { transform: translate3d(-8%, 10%, 0) scale(1.34); }
        }
        @keyframes opening-splash-sky-drift {
          from { transform: translate3d(-12%, -7%, 0) scale(1.22); filter: saturate(.9) brightness(.88); }
          to { transform: translate3d(13%, 8%, 0) scale(1.43); filter: saturate(1.35) brightness(1.1); }
        }
        @keyframes opening-splash-cloud-rush {
          from { transform: translate3d(13%, -8%, 0) scale(1.34); opacity: .12; }
          to { transform: translate3d(-16%, 11%, 0) scale(1.08); opacity: .42; }
        }
        @keyframes opening-splash-cloud-left {
          from { transform: translate3d(-5%, 0, 0) scale(1); }
          to { transform: translate3d(7%, -2%, 0) scale(1.03); }
        }
        @keyframes opening-splash-cloud-right {
          from { transform: translate3d(6%, 1%, 0) scale(1.03); }
          to { transform: translate3d(-6%, -2%, 0) scale(1); }
        }
        @keyframes opening-splash-glow {
          from { opacity: .7; transform: translate(-52%, -48%) scale(.95); }
          to { opacity: 1; transform: translate(-48%, -52%) scale(1.08); }
        }
        @keyframes opening-splash-grain {
          0% { transform: translate(0, 0); }
          25% { transform: translate(2%, -1%); }
          50% { transform: translate(-1%, 2%); }
          75% { transform: translate(1%, 1%); }
          100% { transform: translate(-2%, -1%); }
        }

        @media (prefers-reduced-motion: reduce) {
          .opening-splash,
          .opening-splash * {
            animation-duration: 1ms !important;
            animation-iteration-count: 1 !important;
          }
          .opening-splash--leaving { transition: opacity 220ms ease; opacity: 0; }
        }
      `}</style>
    </div>
  )
}
