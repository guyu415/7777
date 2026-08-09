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
      <div className="opening-splash__brand" data-text="Eunoia" aria-hidden="true">Eunoia</div>

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
          animation: opening-splash-water-drift 6.8s ease-in-out infinite;
        }

        .opening-splash__scene-photo--night {
          inset: -4% -9%;
          background-image: url('/backgrounds/eunoia-splash-night.webp');
          animation: opening-splash-sky-drift 12s ease-in-out infinite alternate;
        }

        .opening-splash__sunlight {
          position: absolute;
          inset: -20%;
          opacity: .65;
          background:
            repeating-linear-gradient(108deg, transparent 0 28px, rgba(255,255,255,.055) 31px 33px, transparent 37px 70px),
            radial-gradient(ellipse at 50% 25%, rgba(218,255,240,.34), transparent 47%);
          filter: blur(2px);
          animation: opening-splash-shimmer 5s ease-in-out infinite alternate;
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
          animation: opening-splash-tide-back 6.8s ease-in-out infinite;
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
          animation: opening-splash-tide-front 6.8s ease-in-out infinite;
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
          animation: opening-splash-foam-back 6.8s ease-in-out infinite;
        }

        .opening-splash__foam--front {
          opacity: .3;
          top: 57%;
          animation: opening-splash-foam-front 6.8s ease-in-out infinite;
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
          animation: opening-splash-shallows 6.8s ease-in-out infinite;
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
          padding: .08em .22em .16em;
          color: transparent;
          font-family: ui-rounded, "SF Pro Rounded", "Nunito", "Avenir Next", system-ui, sans-serif;
          font-size: clamp(56px, 18vw, 112px);
          font-weight: 800;
          font-style: normal;
          letter-spacing: -.075em;
          line-height: 1;
          white-space: nowrap;
          background:
            linear-gradient(180deg,
              rgba(255,255,255,.72) 0%,
              rgba(255,255,255,.2) 20%,
              rgba(255,255,255,.06) 52%,
              rgba(218,250,255,.34) 76%,
              rgba(255,255,255,.58) 100%);
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          -webkit-text-stroke: 1.4px rgba(255,255,255,.7);
          text-shadow:
            0 -1px 0 rgba(255,255,255,.9),
            0 2px 0 rgba(214,250,255,.28),
            0 5px 0 rgba(83,151,166,.2),
            0 9px 15px rgba(19,73,83,.28);
          filter: drop-shadow(0 12px 15px rgba(18,61,77,.24));
          animation: opening-splash-brand 1.1s cubic-bezier(.2,.75,.2,1) both;
        }

        .opening-splash__brand::before,
        .opening-splash__brand::after {
          content: attr(data-text);
          position: absolute;
          inset: .08em .22em .16em;
          pointer-events: none;
        }

        .opening-splash__brand::before {
          z-index: -1;
          color: rgba(127,211,223,.18);
          -webkit-text-fill-color: rgba(127,211,223,.18);
          -webkit-text-stroke: 2.4px rgba(232,255,255,.28);
          transform: translateY(5px);
          filter: blur(.35px);
        }

        .opening-splash__brand::after {
          color: transparent;
          -webkit-text-fill-color: transparent;
          -webkit-text-stroke: 1.5px rgba(255,255,255,.88);
          clip-path: inset(0 0 58% 0);
          transform: translateY(-1px);
          filter: drop-shadow(0 2px 2px rgba(255,255,255,.5));
        }

        .opening-splash--night .opening-splash__brand {
          background: linear-gradient(180deg, rgba(255,255,255,.78), rgba(255,229,244,.12) 42%, rgba(235,207,255,.16) 68%, rgba(255,244,249,.62));
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          -webkit-text-stroke-color: rgba(255,238,249,.74);
          text-shadow:
            0 -1px 0 rgba(255,255,255,.92),
            0 3px 0 rgba(244,203,239,.25),
            0 6px 0 rgba(94,68,126,.24),
            0 11px 18px rgba(29,22,61,.36);
        }

        .opening-splash--night .opening-splash__brand::before {
          color: rgba(220,181,244,.2);
          -webkit-text-fill-color: rgba(220,181,244,.2);
          -webkit-text-stroke-color: rgba(255,232,250,.3);
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
          0%, 100% { transform: rotate(-5deg) translateY(-7%); }
          50% { transform: rotate(-5deg) translateY(8%); }
        }
        @keyframes opening-splash-tide-back {
          0%, 100% { transform: rotate(-5deg) translateY(-2%); }
          50% { transform: rotate(-5deg) translateY(5%); }
        }
        @keyframes opening-splash-foam-front {
          0%, 100% { transform: rotate(-5deg) translateY(-19%); opacity: .14; }
          50% { transform: rotate(-5deg) translateY(32%); opacity: .34; }
        }
        @keyframes opening-splash-foam-back {
          0%, 100% { transform: rotate(-5deg) translateY(-9%); }
          50% { transform: rotate(-5deg) translateY(23%); }
        }
        @keyframes opening-splash-shallows {
          0%, 100% { transform: translateY(-9%); opacity: .1; }
          50% { transform: translateY(10%); opacity: .22; }
        }
        @keyframes opening-splash-shimmer {
          from { transform: translate3d(-1%, -1%, 0) rotate(0deg); }
          to { transform: translate3d(2%, 1%, 0) rotate(.7deg); }
        }
        @keyframes opening-splash-water-drift {
          0%, 100% { transform: translate3d(0, -1.2%, 0) scale(1.035); }
          50% { transform: translate3d(-.7%, 1.1%, 0) scale(1.055); }
        }
        @keyframes opening-splash-sky-drift {
          from { transform: translate3d(-1.8%, 0, 0) scale(1.035); }
          to { transform: translate3d(1.8%, -.5%, 0) scale(1.055); }
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
