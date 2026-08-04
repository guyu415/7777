import { useEffect, useRef, useState } from 'react'
import PokerCard from './PokerCard'

// 斗地主专用手牌扇——13~20 张牌沿弧线展开、按角度旋转。视觉层允许重叠，
// 但每张牌的可点击区域用一层独立的透明命中层固定分配，不受选中态层叠影响，
// 保证多选后被夹在中间的牌也始终点得到（此文件只服务斗地主，不与其他玩法共用）。
export default function DoudizhuHand({ cards = [], selected = new Set(), onCardClick, disabled = false, faceDown = false }) {
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
  // 步进只在容器实在放不下时才收紧到最小可点宽度，其余情况尽量摊宽展开。
  const step = count <= 1 ? 0 : Math.max(15, Math.min(cardWidth, (width - cardWidth) / (count - 1)))
  const totalWidth = count ? cardWidth + step * (count - 1) : 0
  const start = Math.max(0, (width - totalWidth) / 2)
  const middle = (count - 1) / 2
  const containerHeight = cardHeight + 30
  const interactive = !disabled && !!onCardClick

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: containerHeight, overflow: 'visible' }}>
      {cards.map((card, index) => {
        const normal = middle ? (index - middle) / middle : 0
        const rotation = normal * 10
        const arcTop = 5 + Math.pow(Math.abs(normal), 1.65) * 16
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
      {/* 命中层与视觉层分离：每张牌固定占住自己的一段横向区间，选中态的
          层叠/上浮只影响视觉表现，不会侵占相邻牌（尤其是被夹在中间那张）的
          可点范围。 */}
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
