import { useEffect, useRef, useState } from 'react'
import PokerCard from './PokerCard'

// A real mobile card rack: every card stays inside the viewport and overlaps
// just enough to keep its rank/suit readable. ResizeObserver matters on iOS
// because the usable width changes when the safe-area/orientation changes.
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

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: cardHeight + 18, overflow: 'visible' }}>
      {cards.map((card, index) => (
        <PokerCard
          key={card.id}
          card={card}
          faceDown={faceDown}
          size="hand"
          selected={selected.has(card.id)}
          onClick={!disabled && onCardClick ? () => onCardClick(card) : undefined}
          style={{ position: 'absolute', left: start + index * step, top: 14, zIndex: selected.has(card.id) ? count + index : index }}
        />
      ))}
    </div>
  )
}
