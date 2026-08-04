import { useEffect, useRef, useState } from 'react'
import PokerCard from './PokerCard'

// Mobile fan: the cards still fit the viewport, but curve and rotate like a
// hand of real cards instead of forming one cramped, ruler-straight strip.
export default function PokerHand({ cards = [], selected = new Set(), onCardClick, disabled = false, faceDown = false }) {
  const hostRef = useRef(null)
  const [width, setWidth] = useState(340)
  const cardWidth = 48
  const cardHeight = 68

  useEffect(() => {
    const node = hostRef.current
    if (!node) return
    const measure = () => setWidth(node.clientWidth || 340)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(node)
    window.addEventListener('resize', measure)
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  const count = cards.length
  const step = count <= 1 ? 0 : Math.max(13, Math.min(36, (width - cardWidth - 4) / (count - 1)))
  const totalWidth = count ? cardWidth + step * (count - 1) : 0
  const start = Math.max(0, (width - totalWidth) / 2)
  const middle = (count - 1) / 2

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: cardHeight + 30, overflow: 'visible' }}>
      {cards.map((card, index) => {
        const normal = middle ? (index - middle) / middle : 0
        const rotation = normal * 9
        const arcTop = 5 + Math.pow(Math.abs(normal), 1.65) * 14
        return (
          <div key={card.id} style={{ position: 'absolute', left: start + index * step, top: arcTop, zIndex: selected.has(card.id) ? count + index : index, transform: `rotate(${rotation}deg)`, transformOrigin: '50% 100%', transition: 'left .15s, top .15s, transform .15s' }}>
            <PokerCard
              card={card}
              faceDown={faceDown}
              size="hand"
              selected={selected.has(card.id)}
              onClick={!disabled && onCardClick ? () => onCardClick(card) : undefined}
            />
          </div>
        )
      })}
    </div>
  )
}
