import { useEffect, useRef, useState } from 'react'
import PokerCard from './PokerCard'

// Mobile fan: the cards still fit the viewport, but curve and rotate like a
// hand of real cards instead of forming one cramped, ruler-straight strip.
// 手牌数多（升级/拖拉机常见 25+ 张）时单排步进会被压得很窄，命中区域跟着变
// 窄导致误触——超过 TWO_ROW_THRESHOLD 张就拆成两排，每排卡数减半，同样的
// 屏宽下每张牌能分到的点击区间直接翻倍。命中层与视觉层依旧分离：每张牌固
// 定占住自己的一段横向×纵向区间去接点击，选中态的层叠/上浮只影响视觉表现，
// 不会侵占相邻牌（含另一排）的可点范围，跟 DoudizhuHand 是同一套解法（那
// 边牌少不明显，这边牌多必须要）。
const TWO_ROW_THRESHOLD = 14

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
  const twoRows = count > TWO_ROW_THRESHOLD
  const rowCardLists = twoRows
    ? [cards.slice(0, Math.ceil(count / 2)), cards.slice(Math.ceil(count / 2))]
    : [cards]
  const rowHeight = cardHeight + 30
  const rowGap = 10
  const containerHeight = twoRows ? rowHeight * 2 + rowGap : rowHeight
  const interactive = !disabled && !!onCardClick

  function layoutRow(rowCards) {
    const n = rowCards.length
    const step = n <= 1 ? 0 : Math.max(13, Math.min(36, (width - cardWidth - 4) / (n - 1)))
    const totalWidth = n ? cardWidth + step * (n - 1) : 0
    const start = Math.max(0, (width - totalWidth) / 2)
    const middle = (n - 1) / 2
    return { start, step, middle, n }
  }

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: containerHeight, overflow: 'visible' }}>
      {rowCardLists.map((rowCards, rowIndex) => {
        const { start, step, middle, n } = layoutRow(rowCards)
        const rowTop = rowIndex * (rowHeight + rowGap)
        return (
          <div key={`row-${rowIndex}`}>
            {rowCards.map((card, index) => {
              const normal = middle ? (index - middle) / middle : 0
              const rotation = normal * 9
              const arcTop = rowTop + 5 + Math.pow(Math.abs(normal), 1.65) * 14
              return (
                <div key={card.id} style={{ position: 'absolute', left: start + index * step, top: arcTop, zIndex: (selected.has(card.id) ? n + index : index) + rowIndex * 10000, transform: `rotate(${rotation}deg)`, transformOrigin: '50% 100%', transition: 'left .15s, top .15s, transform .15s' }}>
                  <PokerCard
                    card={card}
                    faceDown={faceDown}
                    size="hand"
                    selected={selected.has(card.id)}
                  />
                </div>
              )
            })}
            {interactive && rowCards.map((card, index) => {
              const hitWidth = index === n - 1 ? cardWidth : Math.min(step, cardWidth)
              return (
                <button
                  key={`hit-${card.id}`}
                  onClick={() => onCardClick(card)}
                  aria-label={`${card.suit === 'joker' ? (card.rank === 17 ? '大王' : '小王') : card.suit}${card.rank}`}
                  style={{
                    position: 'absolute', left: start + index * step, top: rowTop,
                    width: hitWidth, height: rowHeight,
                    zIndex: 30000 + rowIndex * 10000 + index,
                    background: 'transparent', border: 'none', padding: 0, margin: 0,
                    WebkitTapHighlightColor: 'transparent',
                  }}
                />
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
