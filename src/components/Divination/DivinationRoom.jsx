import { useMemo, useState } from 'react'
import { ArrowLeft, RotateCcw, Sparkles } from 'lucide-react'
import { DIVINATION_DECKS, formatDivinationPrompt, getDeck } from './divinationDecks'

function ResultCard({ card, index, count, primary }) {
  const positions = count === 3 ? ['过去 / 起因', '现在 / 核心', '未来 / 走向'] : []
  return (
    <div
      className="animate-fade-up"
      style={{
        width: count === 1 ? 'min(238px, 76vw)' : 'min(168px, 48vw)',
        minHeight: count === 1 ? 250 : 218,
        flex: count > 3 ? '0 0 150px' : '0 0 auto',
        borderRadius: 24,
        padding: '18px 14px',
        background: 'linear-gradient(155deg, rgba(255,255,255,0.88), rgba(246,241,255,0.66))',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        border: `1px solid ${primary}42`,
        boxShadow: `0 12px 32px ${primary}20, inset 0 1px 0 rgba(255,255,255,0.9)`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center',
        transform: card.reversed ? 'rotate(1.3deg)' : index % 2 ? 'rotate(0.6deg)' : 'rotate(-0.6deg)',
      }}
    >
      {positions[index] && <div style={{ fontSize: 10.5, color: '#9a7180', marginBottom: 10 }}>{positions[index]}</div>}
      <div style={{ fontSize: count === 1 ? 54 : 42, lineHeight: 1, color: card.red ? '#d35870' : primary, marginBottom: 16 }}>{card.symbol}</div>
      <div style={{ fontSize: count === 1 ? 18 : 15, fontWeight: 700, color: '#4d3340', lineHeight: 1.45 }}>{card.title}</div>
      {card.subtitle && <div style={{ fontSize: 11, fontWeight: 600, color: card.reversed ? '#9a6bb0' : '#6f9b82', marginTop: 6 }}>{card.subtitle}</div>}
      {card.detail && <div style={{ fontSize: 11.5, color: '#8c6e7b', lineHeight: 1.55, marginTop: 12 }}>{card.detail}</div>}
    </div>
  )
}

export default function DivinationRoom({ theme, onClose, onInterpret }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const [deckId, setDeckId] = useState('tarot')
  const deck = useMemo(() => getDeck(deckId), [deckId])
  const [count, setCount] = useState(3)
  const [question, setQuestion] = useState('')
  const [cards, setCards] = useState([])
  const [drawVersion, setDrawVersion] = useState(0)

  const selectDeck = (next) => {
    setDeckId(next.id)
    setCount(next.defaultCount)
    setCards([])
  }

  const draw = () => {
    setCards(deck.draw(count))
    setDrawVersion((value) => value + 1)
  }

  const askAi = () => {
    if (!cards.length) return
    onInterpret(formatDivinationPrompt(deck, question.trim(), cards))
  }

  return (
    <div
      className="fixed inset-0 flex justify-center"
      style={{ zIndex: 90, background: 'rgba(37,28,43,0.32)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        className="h-full w-full max-w-md flex flex-col overflow-hidden"
        style={{
          background: `linear-gradient(155deg, ${primary}20 0%, rgba(250,247,255,0.96) 35%, rgba(239,247,240,0.96) 100%)`,
          boxShadow: '0 0 50px rgba(0,0,0,0.16)',
        }}
      >
        <header
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 14px 10px', borderBottom: `1px solid ${primary}20`, background: 'rgba(255,255,255,0.5)', backdropFilter: 'blur(18px)' }}
        >
          <button onClick={onClose} aria-label="返回聊天" className="flex items-center justify-center" style={{ width: 38, height: 38, borderRadius: '50%', border: 'none', background: `${primary}18`, color: primaryDark }}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles size={15} color={primary} />
            <span style={{ fontSize: 17, fontWeight: 700, color: '#4d3340' }}>抽签屋</span>
          </div>
          <div style={{ width: 38 }} />
        </header>

        <main className="flex-1 overflow-y-auto" style={{ minHeight: 0, padding: '14px 14px 28px' }}>
          <div style={{ fontSize: 10.5, color: '#9d7e8a', textAlign: 'center', marginBottom: 12 }}>本地随机抽取，不消耗模型用量</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {DIVINATION_DECKS.map((item) => {
              const active = item.id === deck.id
              return (
                <button
                  key={item.id}
                  onClick={() => selectDeck(item)}
                  style={{
                    border: active ? `1.5px solid ${primary}75` : '1px solid rgba(116,91,105,0.1)',
                    background: active ? `linear-gradient(135deg, ${primary}22, rgba(255,255,255,0.82))` : 'rgba(255,255,255,0.54)',
                    borderRadius: 16, padding: '10px 11px', textAlign: 'left', fontFamily: 'inherit',
                    boxShadow: active ? `0 5px 16px ${primary}18` : 'none',
                  }}
                >
                  <div className="flex items-center gap-8" style={{ gap: 8 }}>
                    <span style={{ width: 25, textAlign: 'center', color: primaryDark, fontSize: 21 }}>{item.icon}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#523744' }}>{item.label}</div>
                      <div style={{ fontSize: 9.5, color: '#9a7c88', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.description}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>

          <div style={{ marginTop: 14, padding: 13, borderRadius: 18, background: 'rgba(255,255,255,0.52)', border: '1px solid rgba(116,91,105,0.09)' }}>
            <label style={{ display: 'block', fontSize: 10.5, color: '#8f707d', marginBottom: 6 }}>{deck.id === 'answers' ? '先在心里问清楚，也可以写下来' : '想问什么？不写也可以直接抽'}</label>
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="比如：这件事接下来会怎样？"
              maxLength={160}
              style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${primary}25`, background: 'rgba(255,255,255,0.72)', borderRadius: 13, padding: '10px 12px', outline: 'none', fontFamily: 'inherit', fontSize: 13, color: '#4d3340' }}
            />
            {deck.counts.length > 1 && (
              <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
                <span style={{ fontSize: 10.5, color: '#8f707d', marginRight: 2 }}>抽几张</span>
                {deck.counts.map((option) => (
                  <button key={option} onClick={() => { setCount(option); setCards([]) }} style={{ width: 34, height: 28, borderRadius: 14, border: count === option ? `1px solid ${primary}80` : '1px solid rgba(116,91,105,0.12)', background: count === option ? `${primary}20` : 'rgba(255,255,255,0.65)', color: count === option ? primaryDark : '#8f707d', fontFamily: 'inherit', fontWeight: 600, fontSize: 11 }}>{option}</button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={draw}
            className="w-full"
            style={{ marginTop: 12, border: 'none', borderRadius: 18, padding: '12px 16px', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontFamily: 'inherit', fontWeight: 700, fontSize: 14, boxShadow: `0 8px 22px ${primary}35` }}
          >
            {cards.length ? '再抽一次' : deck.id === 'answers' ? '翻开答案' : '抽一抽'}
          </button>

          {cards.length > 0 && (
            <section key={drawVersion} style={{ marginTop: 22 }}>
              <div style={{ textAlign: 'center', fontSize: 11, color: '#8f707d', marginBottom: 12 }}>这次抽到</div>
              <div style={{ display: 'flex', justifyContent: cards.length <= 3 ? 'center' : 'flex-start', alignItems: 'stretch', gap: 10, overflowX: 'auto', padding: '2px 5px 15px' }}>
                {cards.map((card, index) => <ResultCard key={`${card.id}-${index}`} card={card} index={index} count={cards.length} primary={primary} />)}
              </div>
              <div className="flex gap-8" style={{ gap: 8, marginTop: 2 }}>
                <button onClick={draw} className="flex items-center justify-center gap-2" style={{ width: 46, height: 44, borderRadius: 16, border: `1px solid ${primary}32`, background: 'rgba(255,255,255,0.62)', color: primaryDark }} aria-label="重新抽取">
                  <RotateCcw size={15} />
                </button>
                <button onClick={askAi} className="flex-1 flex items-center justify-center gap-2" style={{ border: 'none', borderRadius: 16, background: 'rgba(255,255,255,0.84)', color: '#513744', fontFamily: 'inherit', fontWeight: 700, fontSize: 13, boxShadow: `0 6px 20px ${primary}20` }}>
                  <Sparkles size={15} color={primary} /> 让 TA 解读
                </button>
              </div>
              <div style={{ fontSize: 9.5, color: '#aa8e99', textAlign: 'center', marginTop: 8 }}>只有点这里，结果才会发给当前 AI</div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}
