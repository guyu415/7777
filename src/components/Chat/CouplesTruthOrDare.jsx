import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Dices, Heart, RefreshCcw, ShieldCheck } from 'lucide-react'
import { COUPLES_TOD_LEVELS, drawCouplesCard } from './couplesTruthOrDare'
import { rollD6 } from '../../utils/dice'

function readGame(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}

const Deck = ({ type, disabled, active, onClick, dark }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className="relative h-[104px] w-[78px] rounded-[18px] disabled:opacity-55 transition-transform active:scale-95"
    style={{
      border: `1px solid ${type === 'truth' ? '#b7d8ee' : '#ff9ebd'}`,
      color: type === 'truth' ? '#47718d' : '#fff',
      background: type === 'truth'
        ? (dark ? 'linear-gradient(145deg,#cde5f3,#9bc5df)' : 'linear-gradient(145deg,#edf8ff,#bcdcf0)')
        : 'linear-gradient(145deg,#ff9fbe,#e75d8c)',
      boxShadow: active ? '0 0 0 4px rgba(255,255,255,.65),0 12px 26px rgba(111,55,83,.24)' : '0 8px 18px rgba(111,55,83,.14)',
      transform: active ? 'translateY(-8px) rotate(-2deg)' : undefined,
    }}
  >
    <span className="absolute inset-1.5 rounded-[13px]" style={{ border: '1px solid rgba(255,255,255,.55)' }} />
    <span className="relative block text-xl">{type === 'truth' ? '♡' : '♢'}</span>
    <span className="relative mt-1 block text-xs font-semibold">{type === 'truth' ? '真心话' : '大冒险'}</span>
  </button>
)

const CouplesTruthOrDare = forwardRef(function CouplesTruthOrDare({
  theme, sessionId, aiName, onAppendDice, onRequestUserRoll, onCardReady, onClearCard, onClose,
}, ref) {
  const storageKey = `couples-truth-dare:${sessionId}`
  const saved = useMemo(() => readGame(storageKey), [storageKey])
  const [level, setLevel] = useState(saved?.level || 'intimate')
  const [adultConfirmed, setAdultConfirmed] = useState(!!saved?.adultConfirmed)
  const [round, setRound] = useState(Number(saved?.round) || 1)
  const [rollResult, setRollResult] = useState(null)
  const [current, setCurrent] = useState(null)
  const [lastCardId, setLastCardId] = useState(saved?.lastCardId || '')
  const [waitingForAi, setWaitingForAi] = useState(false)
  const [aiPicking, setAiPicking] = useState(false)
  const [pickedDeck, setPickedDeck] = useState('')
  const [cardSent, setCardSent] = useState(false)
  const [error, setError] = useState('')
  const timersRef = useRef([])
  const primary = theme?.primary || '#ff6f9f'
  const primaryDark = theme?.primaryDark || '#c94f78'
  const dark = level === 'adult'

  const later = (fn, ms) => {
    const timer = setTimeout(fn, ms)
    timersRef.current.push(timer)
  }

  useEffect(() => () => timersRef.current.forEach(clearTimeout), [])

  useEffect(() => {
    try { sessionStorage.setItem(storageKey, JSON.stringify({ level, adultConfirmed, round, lastCardId })) } catch { /* optional */ }
  }, [storageKey, level, adultConfirmed, round, lastCardId])

  const revealCard = (type, target) => {
    const card = drawCouplesCard({ level, type, previousId: lastCardId })
    if (!card) return
    const next = { ...card, type, target, round }
    setPickedDeck(type)
    setCurrent(next)
    setLastCardId(card.id)
    setCardSent(false)
    onCardReady?.(next)
  }

  const finishAiRoll = (user) => {
    const ai = rollD6()
    onAppendDice?.(ai, 'assistant')
    // Do not reveal the result on the table while CC's existing dice bubble
    // is still rolling. The deck only unlocks after that second die lands.
    later(() => {
      setWaitingForAi(false)
      if (ai === user) {
        setRollResult({ user, ai, loser: null })
        return
      }
      const loser = user < ai ? 'user' : 'ai'
      setRollResult({ user, ai, loser })
      if (loser === 'ai') {
        setAiPicking(true)
        const type = rollD6() % 2 ? 'truth' : 'dare'
        setPickedDeck(type)
        later(() => {
          setAiPicking(false)
          revealCard(type, 'ai')
        }, 650)
      }
    }, 1200)
  }

  useImperativeHandle(ref, () => ({
    userRolled(value) {
      if (waitingForAi || current) return false
      if (level === 'adult' && !adultConfirmed) {
        setError('先确认双方均已成年并自愿参与。')
        return false
      }
      setError('')
      setPickedDeck('')
      setRollResult({ user: value, ai: null, loser: null })
      setWaitingForAi(true)
      onAppendDice?.(value, 'user')
      // The second throw appears only after the user's physical dice bubble
      // has had time to land, so this reads as two people taking turns.
      later(() => finishAiRoll(value), 1350)
      return true
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
    setError('')
    onClearCard?.()
    if (restart) { setRound(1); setLastCardId('') }
    else setRound(value => value + 1)
  }

  const chooseLevel = (next) => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
    setLevel(next)
    setRollResult(null)
    setCurrent(null)
    setWaitingForAi(false)
    setAiPicking(false)
    setPickedDeck('')
    setCardSent(false)
    setError('')
    onClearCard?.()
  }

  const status = current
    ? (cardSent ? '这张牌已经跟着你的消息发出' : '牌先放在这里，等你开口')
    : waitingForAi
      ? `等 ${aiName || 'CC'} 掷骰…`
      : rollResult?.ai != null && rollResult.ai === rollResult.user
        ? '平局，你再掷一次'
        : rollResult?.loser === 'user'
          ? '你输了，自己摸一张'
          : aiPicking
            ? `${aiName || 'CC'} 正在摸牌…`
            : '先从聊天框里掷一颗骰子'

  return (
    <section
      className="relative flex flex-col flex-shrink-0 overflow-hidden"
      style={{
        flexBasis: 'min(57%, 390px)', minHeight: 300, zIndex: 3,
        background: dark
          ? 'radial-gradient(circle at 50% 25%,rgba(83,22,43,.98),rgba(36,17,31,.99) 72%)'
          : 'radial-gradient(circle at 50% 20%,rgba(255,252,253,.98),rgba(255,237,245,.97) 68%,rgba(241,235,255,.96))',
        borderBottom: `1px solid ${primary}28`, boxShadow: '0 10px 28px rgba(82,39,63,.14)',
      }}
      aria-label="情侣真心话大冒险"
    >
      <div className="flex items-center gap-2.5 px-3 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${dark ? 'rgba(255,255,255,.10)' : 'rgba(150,95,125,.12)'}` }}>
        <div className="w-7 h-7 rounded-xl grid place-items-center" style={{ background: `${primary}22`, color: primary }}><Heart size={16} fill="currentColor" /></div>
        <div className="font-semibold text-sm" style={{ color: dark ? '#ffe3ed' : '#654354' }}>真心话大冒险</div>
        <div className="text-[10px]" style={{ color: dark ? '#cf9daf' : '#a78495' }}>第 {round} 轮</div>
        <button onClick={() => resetTable(true)} className="ml-auto w-8 h-8 rounded-full grid place-items-center" style={{ color: primary, background: `${primary}16` }} aria-label="重新开始"><RefreshCcw size={15} /></button>
        <button onClick={onClose} className="w-8 h-8 rounded-full grid place-items-center" style={{ color: primary, background: `${primary}16` }} aria-label="收起游戏"><ChevronLeft size={18} style={{ transform: 'rotate(90deg)' }} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <div className="flex gap-2">
          {COUPLES_TOD_LEVELS.map(item => (
            <button key={item.id} onClick={() => chooseLevel(item.id)} className="flex-1 rounded-2xl px-2 py-1.5 text-center" style={{ border: `1px solid ${level === item.id ? primary : 'rgba(160,120,145,.13)'}`, background: level === item.id ? `${primary}20` : 'rgba(255,255,255,.10)', color: dark ? '#f5cedb' : '#765568' }}>
              <span className="mr-1 text-sm">{item.icon}</span><span className="text-[11px] font-semibold">{item.label}</span>
            </button>
          ))}
        </div>

        {dark && (
          <label className="mt-2 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,.07)', color: '#e4b8c8' }}>
            <input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} style={{ marginTop: 2, accentColor: primary }} />
            <span className="text-[10px] leading-relaxed"><ShieldCheck size={12} style={{ display: 'inline', marginRight: 4 }} />双方均已成年、自愿参与；任何题都可以跳过。</span>
          </label>
        )}

        <div className="mt-3 min-h-[150px] rounded-[24px] px-4 py-3 text-center grid place-items-center" style={{ background: dark ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.70)', border: `1px solid ${dark ? 'rgba(255,190,215,.15)' : 'rgba(255,255,255,.9)'}` }}>
          {current ? (
            <div className="w-full">
              <div className="text-[10px] font-semibold" style={{ color: primary }}>{current.target === 'ai' ? (aiName || 'CC') : '你'} 摸到 · {current.type === 'truth' ? '真心话' : '大冒险'}</div>
              <div className="mx-auto mt-2 max-w-[310px] text-[14px] leading-relaxed font-medium" style={{ color: dark ? '#ffe9f0' : '#5e4050' }}>{current.text}</div>
              <button onClick={() => resetTable(false)} className="mt-3 rounded-full px-4 py-2 text-xs text-white" style={{ border: 0, background: `linear-gradient(135deg,${primary},${primaryDark})` }}>下一轮</button>
            </div>
          ) : (
            <div className="w-full">
              <div className="flex justify-center gap-7 pt-2">
                <Deck type="truth" dark={dark} active={pickedDeck === 'truth'} disabled={rollResult?.loser !== 'user' || waitingForAi || aiPicking} onClick={() => revealCard('truth', 'user')} />
                <Deck type="dare" dark={dark} active={pickedDeck === 'dare'} disabled={rollResult?.loser !== 'user' || waitingForAi || aiPicking} onClick={() => revealCard('dare', 'user')} />
              </div>
              <div className="mt-3 text-xs font-semibold" style={{ color: dark ? '#eab4c7' : primary }}>{status}</div>
              {!waitingForAi && !aiPicking && (!rollResult || (rollResult.ai != null && rollResult.ai === rollResult.user)) && (
                <button
                  type="button"
                  onClick={onRequestUserRoll}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-xs font-semibold text-white active:scale-95"
                  style={{ border: 0, background: `linear-gradient(135deg,${primary},${primaryDark})`, boxShadow: `0 7px 18px ${primary}45` }}
                >
                  <Dices size={16} />{rollResult ? '再掷一次' : '掷骰子'}
                </button>
              )}
            </div>
          )}
        </div>
        {error && <div className="mt-2 text-center text-[11px]" style={{ color: '#e27c91' }}>{error}</div>}
      </div>
    </section>
  )
})

export default CouplesTruthOrDare
