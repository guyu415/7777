import { rankLabel } from './cards'

// 斗地主/炸金花共用的单张牌视觉——选中时上浮一点，方便小屏幕触控点选；
// 背面用于"还没揭示"的牌（对手的手牌、比牌前的自己）。
export default function PokerCard({ card, size = 'md', selected, faceDown, onClick, style }) {
  const dims = size === 'micro' ? { w: 18, h: 27, font: 7.5 }
    : size === 'sm' ? { w: 28, h: 40, font: 11.5 }
      : size === 'hand' ? { w: 48, h: 68, font: 16 }
        : size === 'lg' ? { w: 46, h: 64, font: 17 }
          : { w: 36, h: 51, font: 13.5 }
  if (faceDown || !card) {
    return (
      <div
        style={{
          width: dims.w, height: dims.h, borderRadius: 6, flexShrink: 0,
          background: 'linear-gradient(135deg,#e3a6b8,#b3627e)',
          border: '1px solid rgba(255,255,255,0.5)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          ...style,
        }}
      />
    )
  }
  const isJoker = card.suit === 'joker'
  const isRed = card.suit === '♥' || card.suit === '♦'
  const color = isJoker ? (card.rank === 17 ? '#c94b4b' : '#4a4a4a') : (isRed ? '#d1435b' : '#3a3a3a')
  const Tag = onClick ? 'button' : 'div'
  const isHand = size === 'hand'
  return (
    <Tag
      onClick={onClick}
      data-testid="poker-card"
      className={`flex flex-col flex-shrink-0 ${isHand ? 'items-start justify-start' : 'items-center justify-center'}`}
      style={{
        width: dims.w, height: dims.h, borderRadius: 6,
        boxSizing: 'border-box',
        padding: isHand ? '5px 0 0 4px' : 0,
        background: '#fffaf7',
        border: selected ? '2px solid #ff6b9d' : '1px solid rgba(0,0,0,0.15)',
        transform: selected ? 'translateY(-14px)' : 'none',
        transition: 'transform 0.15s',
        color, fontSize: dims.font, fontWeight: 700, lineHeight: 1.1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        ...style,
      }}
    >
      {isJoker ? (
        isHand
          ? <><span style={{ fontSize: 11 }}>{card.rank === 17 ? '大' : '小'}</span><span style={{ fontSize: 11 }}>王</span></>
          : <span>{card.rank === 17 ? '大王' : '小王'}</span>
      ) : (
        <><span>{rankLabel(card.rank)}</span><span style={{ fontSize: dims.font * 0.85 }}>{card.suit}</span></>
      )}
    </Tag>
  )
}
