import { useState } from 'react'
import { History, X } from 'lucide-react'
import PokerCard from './PokerCard'

function entryText(entry, players) {
  const name = players?.[entry.player]?.name || (entry.player === 0 ? '我' : `玩家${entry.player + 1}`)
  if (entry.type === 'pass') return `${name}：过`
  if (entry.type === 'play') return `${name}${entry.auto ? '（托管）' : ''}`
  return ''
}

function MiniCards({ cards = [] }) {
  return (
    <div style={{ position: 'relative', height: 29, width: Math.min(68, 18 + Math.max(0, cards.length - 1) * 8) }}>
      {cards.map((card, i) => (
        <PokerCard key={card.id} card={card} size="micro" style={{ position: 'absolute', left: i * 8, top: 0, zIndex: i }} />
      ))}
    </div>
  )
}

export default function PokerPlayHistory({ history = [], players = [], accent = '#ff85b3' }) {
  const [open, setOpen] = useState(false)
  const entries = history.filter((h) => h.type === 'play' || h.type === 'pass')
  if (!entries.length) return null
  const recent = entries.slice(-5)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="查看出牌记录"
        style={{ position: 'absolute', right: 7, top: 8, width: 74, maxHeight: 182, overflow: 'hidden', border: `1px solid ${accent}25`, borderRadius: 14, background: 'rgba(255,255,255,.68)', backdropFilter: 'blur(10px)', padding: '6px 5px', zIndex: 3 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, color: '#8d6675', fontSize: 9.5, marginBottom: 4 }}><History size={10} /> 出牌记录</div>
        {recent.map((entry, i) => (
          <div key={`${entry.player}-${i}-${entry.type}`} style={{ minHeight: 25, borderTop: i ? '1px solid rgba(0,0,0,.04)' : 'none', paddingTop: 3, textAlign: 'left' }}>
            <div style={{ color: '#8d6675', fontSize: 8.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entryText(entry, players)}</div>
            {entry.type === 'play' && <MiniCards cards={entry.cards} />}
          </div>
        ))}
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
