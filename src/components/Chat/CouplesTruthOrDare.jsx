import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Dices, Heart, RefreshCcw } from 'lucide-react'
import { drawCouplesCard } from './couplesTruthOrDare'
import { rollD6 } from '../../utils/dice'

function readGame(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}

const Deck = ({ type, disabled, active, onClick }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="relative h-[120px] w-[88px] rounded-[20px] disabled:opacity-50 transition-transform active:scale-95"
    style={{
      border: `1px solid ${type === 'truth' ? '#b7d8ee' : '#ff9ebd'}`,
      color: type === 'truth' ? '#47718d' : '#fff',
      background: type === 'truth'
        ? 'linear-gradient(145deg,#edf8ff,#bcdcf0)'
        : 'linear-gradient(145deg,#ff9fbe,#e75d8c)',
      boxShadow: active ? '0 0 0 4px rgba(255,255,255,.7),0 14px 28px rgba(111,55,83,.28)' : '0 9px 20px rgba(111,55,83,.16)',
      transform: active ? 'translateY(-10px) rotate(-3deg)' : undefined,
    }}
  >
    <span className="absolute inset-1.5 rounded-[15px]" style={{ border: '1px solid rgba(255,255,255,.6)' }} />
    <span className="relative block text-2xl">{type === 'truth' ? '♡' : '♢'}</span>
    <span className="relative mt-1 block text-xs font-semibold">{type === 'truth' ? '真心话' : '大冒险'}</span>
  </button>
)

const CouplesTruthOrDare = forwardRef(function CouplesTruthOrDare({
  theme, sessionId, aiName, onRequestUserRoll, onCardReady, onClearCard, onClose,
}, ref) {
  const storageKey = `couples-truth-dare:${sessionId}`
  const saved = useMemo(() => readGame(storageKey), [storageKey])
  const [round, setRound] = useState(Number(saved?.round) || 1)
  const [rollResult, setRollResult] = useState(null)
  const [current, setCurrent] = useState(null)
  const [lastCardId, setLastCardId] = useState(saved?.lastCardId || '')
  const [waitingForAi, setWaitingForAi] = useState(false)
  const [aiPicking, setAiPicking] = useState(false)
  const [pickedDeck, setPickedDeck] = useState('')
  const [cardSent, setCardSent] = useState(false)
  const timersRef = useRef([])
  const primary = theme?.primary || '#ff6f9f'
  const primaryDark = theme?.primaryDark || '#c94f78'

  const later = (fn, ms) => {
    const timer = setTimeout(fn, ms)
    timersRef.current.push(timer)
  }

  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ round, lastCardId })) } catch { /* optional */ }
  }, [storageKey, round, lastCardId])

  const revealCard = (type, target) => {
    // There are exactly two piles. Intensity is not a third choice: each pile
    // shuffles together every matching card from the complete deck.
    const card = drawCouplesCard({ level: 'all', type, previousId: lastCardId })
    if (!card) return
    const next = { ...card, type, target, round }
    setPickedDeck(type)
    setCurrent(next)
    setLastCardId(card.id)
    setCardSent(false)
    onCardReady?.(next)
  }

  useImperativeHandle(ref, () => ({
    userRolled(value) {
      if (waitingForAi || current) return false
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      setPickedDeck('')
      setRollResult({ user: value, ai: null, loser: null })
      setWaitingForAi(true)
      return true
    },
    aiRolled(user, ai) {
      setRollResult({ user, ai, loser: null })
      // Keep the table neutral until CC's chat dice finishes settling.
      later(() => {
        setWaitingForAi(false)
        if (ai === user) return
        const loser = user < ai ? 'user' : 'ai'
        setRollResult({ user, ai, loser })
        if (loser === 'ai') {
          setAiPicking(true)
          const type = rollD6() % 2 ? 'truth' : 'dare'
          setPickedDeck(type)
          later(() => {
            setAiPicking(false)
            revealCard(type, 'ai')
          }, 700)
        }
      }, 1200)
    },
    markCardSent() { setCardSent(true) },
  }))

  const resetTable = (restart = false) => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setRollResult(null)
    setCurrent(null)
    setWaitingForAi(false)
    setAiPicking(false)
    setPickedDeck('')
    setCardSent(false)
    onClearCard?.()
    if (restart) { setRound(1); setLastCardId('') }
    else setRound(value => value + 1)
  }

  const isTie = rollResult?.ai != null && rollResult.ai === rollResult.user
  const status = current
    ? (cardSent ? '已经跟着你的消息发出' : '等你开口')
    : waitingForAi
      ? `${aiName || 'CC'} 正在掷骰…`
      : isTie
        ? '平局，再来'
        : rollResult?.loser === 'user'
          ? '你输了，摸一张'
          : aiPicking
            ? `${aiName || 'CC'} 正在摸牌…`
            : '轮到你'

  return (
    <section
      className="relative flex flex-col flex-shrink-0 overflow-hidden"
      style={{
        flexBasis: 'min(54%, 365px)', minHeight: 285, zIndex: 3,
        background: 'radial-gradient(circle at 50% 20%,rgba(255,252,253,.98),rgba(255,234,243,.98) 68%,rgba(240,232,253,.97))',
        borderBottom: `1px solid ${primary}28`, boxShadow: '0 10px 28px rgba(82,39,63,.14)',
      }}
      aria-label="情侣真心话大冒险"
    >
      <div className="flex items-center gap-2.5 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid rgba(150,95,125,.12)' }}>
        <div className="w-7 h-7 rounded-xl grid place-items-center" style={{ background: `${primary}22`, color: primary }}><Heart size={16} fill="currentColor" /></div>
        <div className="font-semibold text-sm" style={{ color: '#654354' }}>真心话大冒险</div>
        <div className="text-[10px]" style={{ color: '#a78495' }}>第 {round} 轮</div>
        <button onClick={() => resetTable(true)} className="ml-auto w-8 h-8 rounded-full grid place-items-center" style={{ color: primary, background: `${primary}16` }} aria-label="重新开始"><RefreshCcw size={15} /></button>
        <button onClick={onClose} className="w-8 h-8 rounded-full grid place-items-center" style={{ color: primary, background: `${primary}16` }} aria-label="收起游戏"><ChevronLeft size={18} style={{ transform: 'rotate(90deg)' }} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <div className="min-h-[190px] rounded-[24px] px-4 py-3 text-center grid place-items-center" style={{ background: 'rgba(255,255,255,.72)', border: '1px solid rgba(255,255,255,.92)' }}>
          {current ? (
            <div className="w-full">
              <div className="text-[10px] font-semibold" style={{ color: primary }}>{current.target === 'ai' ? (aiName || 'CC') : '你'} 摸到 · {current.type === 'truth' ? '真心话' : '大冒险'}</div>
              <div className="mx-auto mt-3 max-w-[310px] text-[14px] leading-relaxed font-medium" style={{ color: '#5e4050' }}>{current.text}</div>
              <button onClick={() => resetTable(false)} className="mt-4 rounded-full px-4 py-2 text-xs text-white" style={{ border: 0, background: `linear-gradient(135deg,${primary},${primaryDark})` }}>下一轮</button>
            </div>
          ) : (
            <div className="w-full">
              <div className="flex justify-center gap-8 pt-2">
                <Deck type="truth" active={pickedDeck === 'truth'} disabled={rollResult?.loser !== 'user' || waitingForAi || aiPicking} onClick={() => revealCard('truth', 'user')} />
                <Deck type="dare" active={pickedDeck === 'dare'} disabled={rollResult?.loser !== 'user' || waitingForAi || aiPicking} onClick={() => revealCard('dare', 'user')} />
              </div>
              <div className="mt-3 text-xs font-semibold" style={{ color: primary }}>
                {waitingForAi && <Dices size={15} className="inline mr-1 animate-bounce" />}{status}
              </div>
              {!waitingForAi && !aiPicking && (!rollResult || isTie) && (
                <button
                  type="button"
                  onClick={onRequestUserRoll}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-xs font-semibold text-white active:scale-95"
                  style={{ border: 0, background: `linear-gradient(135deg,${primary},${primaryDark})`, boxShadow: `0 7px 18px ${primary}45` }}
                >
                  <Dices size={16} />{isTie ? '再掷一次' : '掷骰子'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
})

export default CouplesTruthOrDare
