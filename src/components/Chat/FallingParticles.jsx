import { useEffect, useRef, useState, useCallback } from 'react'
import clsx from 'clsx'

// 16 falling accessory icons (96×96 transparent PNGs)
const ICONS = Array.from({ length: 16 }, (_, i) => `/assets/particles/forest_icon_${String(i + 1).padStart(2, '0')}.png`)

const COUNT = 12       // particles in the air at once
const ROW_H = 40       // stacking row height (px)
const COVER_FULL = 0.8 // a row is "full" at ~80% horizontal coverage
const FADE_MS = 800    // row-0 fade-out duration

const rnd = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2)

// initial=true → staggered start (0–10s); respawn → re-enter promptly (0–3s)
function makeFalling(initial) {
  return {
    id: uid(),
    src: pick(ICONS),
    left: rnd(0, 95),                 // %
    size: Math.round(rnd(24, 36)),    // px (square)
    duration: rnd(14, 22),            // s
    delay: initial ? rnd(0, 10) : rnd(0, 3), // s
    spin: Math.random() < 0.5 ? 1 : -1,
    rotate: Math.round(rnd(0, 360)),  // frozen landing angle
  }
}

// Horizontal coverage of a set of landed particles over the container width.
// Union of [leftPx, leftPx+size] intervals / width.
function coverage(parts, width) {
  if (!parts.length || !width) return 0
  const ivs = parts
    .map(p => { const x = (p.left / 100) * width; return [x, x + p.size] })
    .sort((a, b) => a[0] - b[0])
  let covered = 0, curS = ivs[0][0], curE = ivs[0][1]
  for (let i = 1; i < ivs.length; i++) {
    const [s, e] = ivs[i]
    if (s <= curE) curE = Math.max(curE, e)
    else { covered += curE - curS; curS = s; curE = e }
  }
  covered += curE - curS
  return covered / width
}

export default function FallingParticles() {
  const rootRef = useRef(null)
  const [size, setSize] = useState({ w: 360, h: 500 })
  const [falling, setFalling] = useState(() => Array.from({ length: COUNT }, () => makeFalling(true)))
  const [landed, setLanded] = useState([]) // { id, src, left, size, rotate, row, fading }
  const shiftingRef = useRef(false)
  const widthRef = useRef(360)

  // Measure the layer so falls land exactly above the input and rows sit at the bottom.
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      widthRef.current = r.width
      setSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // A particle finished falling → freeze it into the stack, and spawn a replacement
  // so the airborne count stays constant (DOM-stable over time).
  const onLand = useCallback((p) => {
    setLanded(prev => {
      const topRow = prev.reduce((m, x) => Math.max(m, x.row), 0)
      const rowParts = prev.filter(x => x.row === topRow && !x.fading)
      const full = coverage(rowParts, widthRef.current) >= COVER_FULL
      const targetRow = prev.length && full ? topRow + 1 : topRow
      return [...prev, { id: p.id, src: p.src, left: p.left, size: p.size, rotate: p.rotate, row: targetRow, fading: false }]
    })
    setFalling(prev => [...prev.filter(x => x.id !== p.id), makeFalling(false)])
  }, [])

  // When a second row begins, fade row-0 out (800ms) then drop everyone down a row.
  useEffect(() => {
    if (shiftingRef.current) return
    const hasUpper = landed.some(p => p.row >= 1)
    const row0Active = landed.some(p => p.row === 0 && !p.fading)
    if (hasUpper && row0Active) {
      shiftingRef.current = true
      setLanded(prev => prev.map(p => p.row === 0 ? { ...p, fading: true } : p))
      const t = setTimeout(() => {
        setLanded(prev => prev
          .filter(p => !(p.row === 0 && p.fading))
          .map(p => ({ ...p, row: p.row - 1 })))
        shiftingRef.current = false
      }, FADE_MS)
      return () => clearTimeout(t)
    }
  }, [landed])

  const fallH = Math.max(120, size.h - ROW_H) // translateY end ≈ just above the stacking rows

  return (
    <div
      ref={rootRef}
      className="absolute inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: 5 }}
    >
      {/* Falling layer */}
      {falling.map(p => (
        <img
          key={p.id}
          src={p.src}
          alt=""
          className="pfall"
          onAnimationEnd={() => onLand(p)}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            ['--dur']: `${p.duration}s`,
            ['--delay']: `${p.delay}s`,
            ['--spin']: `${p.spin * 360}deg`,
            ['--fall']: `${fallH}px`,
          }}
        />
      ))}

      {/* Landed / stacked layer */}
      {landed.map(p => (
        <img
          key={p.id}
          src={p.src}
          alt=""
          className={clsx('pland', p.fading && 'pfade')}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size,
            bottom: p.row * ROW_H,
            transform: `rotate(${p.rotate}deg)`,
          }}
        />
      ))}
    </div>
  )
}
