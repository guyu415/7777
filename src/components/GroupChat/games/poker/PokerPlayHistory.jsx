import { useState } from 'react'
import { History, X } from 'lucide-react'
import PokerCard from './PokerCard'

function entryText(entry, players) {
  const name = players?.[entry.player]?.name || (entry.player === 0 ? '我' : `玩家${entry.player + 1}`)
  if (entry.type === 'pass') return `${name}：过`
  if (entry.type === 'play') return `${name}${entry.auto ? '（托管）' : ''}`
  return ''
}

export default function PokerPlayHistory({ history = [], players = [], accent = '#ff85b3', top = 8 }) {
  const [open, setOpen] = useState(false)
  const entries = history.filter((h) => h.type === 'play' || h.type === 'pass')
  if (!entries.length) return null
  const playedCards = entries.filter((entry) => entry.type === 'play').flatMap((entry) => entry.cards || [])
  const pile = playedCards.slice(-10)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="查看出牌记录"
        style={{ position: 'absolute', left: 7, top, width: 68, height: 53, overflow: 'visible', border: 0, background: 'transparent', padding: 0, zIndex: 3 }}
      >
        <div style={{ position: 'relative', height: 45, width: 58 }}>
          {pile.map((card, i) => (
            <PokerCard key={`${card.id}-${i}`} card={card} size="sm" style={{ position: 'absolute', left: 9 + i * 2.1, top: 2 + (i % 3), zIndex: i, transform: `rotate(${(i % 5) - 2}deg)`, transformOrigin: 'bottom center', boxShadow: '0 2px 5px rgba(80,45,60,.18)' }} />
          ))}
          <span style={{ position: 'absolute', right: 0, bottom: 0, zIndex: 20, minWidth: 19, height: 19, padding: '0 4px', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, background: accent, color: '#fff', fontSize: 8, boxShadow: '0 2px 5px rgba(80,45,60,.18)' }}><History size={8} />{playedCards.length}</span>
        </div>
      </button>

      {open && (
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 120, background: 'rgba(31,18,25,.32)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxHeight: '68dvh', overflow: 'hidden', borderRadius: '24px 24px 0 0', background: '#fffaf9', paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: '1px solid rgba(0,0,0,.06)' }}>
              <strong style={{ color: '#573847', fontSize: 14 }}>本局出牌记录</strong>
              <button onClick={() => setOpen(false)} style={{ width: 30, height: 30, border: 0, borderRadius: '50%', background: 'rgba(0,0,0,.05)', color: '#775463' }}><X size={15} /></button>
            </div>
            <div style={{ overflowY: 'auto', maxHeight: 'calc(68dvh - 58px)', padding: '8px 14px' }}>
              {entries.map((entry, i) => (
                <div key={`${entry.player}-${i}-${entry.type}`} style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 42, borderBottom: '1px solid rgba(0,0,0,.045)' }}>
                  <span style={{ width: 86, flexShrink: 0, color: '#765362', fontSize: 11 }}>{entryText(entry, players)}</span>
                  {entry.type === 'play' ? <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>{entry.cards.map((c) => <PokerCard key={c.id} card={c} size="sm" />)}</div> : <span style={{ color: '#b79ba6', fontSize: 11 }}>没有出牌</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
