import { useEffect, useRef, useState } from 'react'
import PokerCard from './PokerCard'

// Mobile fan: the cards still fit the viewport, but curve and rotate like a
// hand of real cards instead of forming one cramped, ruler-straight strip.
// 手牌数多（升级/拖拉机常见 25+ 张）时步进会被压得很窄，牌与牌大面积重叠——
// 命中层与视觉层分离：每张牌固定占住自己的一段横向区间去接点击，选中态的
// 层叠/上浮只影响视觉表现，不会侵占相邻牌（尤其是被压在下面那张）的可点范
// 围，跟 DoudizhuHand 是同一套解法（那边牌少不明显，这边牌多必须要）。
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
  const containerHeight = cardHeight + 30
  const interactive = !disabled && !!onCardClick

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: containerHeight, overflow: 'visible' }}>
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
            />
          </div>
        )
      })}
      {interactive && cards.map((card, index) => {
        const hitWidth = index === count - 1 ? cardWidth : Math.min(step, cardWidth)
        return (
          <button
            key={`hit-${card.id}`}
            onClick={() => onCardClick(card)}
            aria-label={`${card.suit === 'joker' ? (card.rank === 17 ? '大王' : '小王') : card.suit}${card.rank}`}
            style={{
              position: 'absolute', left: start + index * step, top: 0,
              width: hitWidth, height: containerHeight,
              zIndex: 10000 + index,
              background: 'transparent', border: 'none', padding: 0, margin: 0,
              WebkitTapHighlightColor: 'transparent',
            }}
          />
        )
      })}
    </div>
  )
}
