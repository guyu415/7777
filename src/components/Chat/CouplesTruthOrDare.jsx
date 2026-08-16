import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Flame, Heart, RefreshCcw, ShieldCheck } from 'lucide-react'
import { buildCouplesTurnPrompt, COUPLES_TOD_LEVELS, drawCouplesCard } from './couplesTruthOrDare'
import { rollD6 } from '../../utils/dice'

const DICE_FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅']

function readGame(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || 'null')
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

export default function CouplesTruthOrDare({ theme, sessionId, aiName, messages = [], isLoading, onSendTurn, onRollRound, onClose }) {
  const storageKey = `couples-truth-dare:${sessionId}`
  const saved = useMemo(() => readGame(storageKey), [storageKey])
  const [level, setLevel] = useState(saved?.level || 'intimate')
  const [adultConfirmed, setAdultConfirmed] = useState(!!saved?.adultConfirmed)
  const [round, setRound] = useState(Number(saved?.round) || 1)
  const [current, setCurrent] = useState(saved?.current || null)
  const [rollResult, setRollResult] = useState(saved?.rollResult || null)
  const [lastCardId, setLastCardId] = useState(saved?.lastCardId || '')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const handledChoiceMessageRef = useRef(null)
  const primary = theme?.primary || '#ff6f9f'
  const primaryDark = theme?.primaryDark || '#c94f78'
  const selectedLevel = COUPLES_TOD_LEVELS.find(item => item.id === level)

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ level, adultConfirmed, round, current, rollResult, lastCardId }))
    } catch { /* session persistence is optional */ }
  }, [storageKey, level, adultConfirmed, round, current, rollResult, lastCardId])

  const chooseLevel = (next) => {
    setLevel(next)
    setCurrent(null)
    setRollResult(null)
    setError('')
  }

  const draw = async (type) => {
    if (sending || isLoading) return
    if (level === 'adult' && !adultConfirmed) {
      setError('进入无上限牌组前，需要确认双方均已成年并同意。')
      return
    }
    if (!rollResult?.loser) {
      setError('请先双方摇骰，输家才能选牌。')
      return
    }
    const card = drawCouplesCard({ level, type, previousId: lastCardId })
    if (!card) return
    const target = rollResult.loser
    const next = { ...card, type, target, round }
    setCurrent(next)
    setLastCardId(card.id)
    setError('')
    setSending(true)
    try {
      const prompt = buildCouplesTurnPrompt({ round, target, aiName, type, level, card })
      await onSendTurn?.(prompt)
    } catch (e) {
      setError(e?.message || '题目发送失败，请重试')
    } finally {
      setSending(false)
    }
  }

  const rollBoth = async () => {
    if (sending || isLoading) return
    if (level === 'adult' && !adultConfirmed) {
      setError('进入无上限牌组前，需要确认双方均已成年并同意。')
      return
    }
    let user = rollD6()
    let ai = rollD6()
    // A tied round has no loser. Re-roll locally until the pair is decisive,
    // while still showing only the final pair as the actual round.
    while (user === ai) { user = rollD6(); ai = rollD6() }
    const result = { user, ai, loser: user < ai ? 'user' : 'ai', startedAt: Date.now() }
    handledChoiceMessageRef.current = null
    setRollResult(result)
    setCurrent(null)
    setError('')
    setSending(true)
    try {
      await onRollRound?.(result, round)
    } catch (e) {
      setError(e?.message || '骰子发送失败，请重试')
    } finally {
      setSending(false)
    }
  }

  // When CC loses, it makes the choice in the real resident conversation.
  // The requested exact phrase keeps detection deterministic; the visible
  // buttons remain as a fallback if the model answers more creatively.
  useEffect(() => {
    if (rollResult?.loser !== 'ai' || current || sending || isLoading) return
    const reply = [...messages].reverse().find(message => (
      message.role === 'assistant'
      && Number(message.timestamp) >= Number(rollResult.startedAt || 0)
      && typeof message.content === 'string'
      && /我选(?:择)?(?:了)?(?:：|:|\s)*(真心话|大冒险)/.test(message.content)
    ))
    if (!reply || handledChoiceMessageRef.current === reply.id) return
    const match = reply.content.match(/我选(?:择)?(?:了)?(?:：|:|\s)*(真心话|大冒险)/)
    handledChoiceMessageRef.current = reply.id
    void draw(match?.[1] === '大冒险' ? 'dare' : 'truth')
    // `draw` deliberately reads the current round/deck/loser closure. It is
    // safe to re-run this effect; the handled message id prevents duplicates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, rollResult, current, sending, isLoading])

  const nextRound = () => {
    setCurrent(null)
    setRollResult(null)
    setRound(value => value + 1)
    setError('')
  }

  const restart = () => {
    setCurrent(null)
    setRollResult(null)
    setLastCardId('')
    setRound(1)
    setError('')
  }

  return (
    <section
      className="relative flex flex-col flex-shrink-0 overflow-hidden"
      style={{
        flexBasis: 'min(60%, 410px)', minHeight: 315, zIndex: 3,
        background: level === 'adult'
          ? 'radial-gradient(circle at 50% 25%,rgba(83,22,43,.98),rgba(36,17,31,.99) 72%)'
          : 'radial-gradient(circle at 50% 20%,rgba(255,252,253,.98),rgba(255,237,245,.97) 68%,rgba(241,235,255,.96))',
        borderBottom: `1px solid ${primary}28`, boxShadow: '0 10px 28px rgba(82,39,63,.14)',
      }}
      aria-label="情侣真心话大冒险"
    >
      <div className="flex items-center gap-2.5 px-3 py-2 flex-shrink-0" style={{ borderBottom: `1px solid ${level === 'adult' ? 'rgba(255,255,255,.10)' : 'rgba(150,95,125,.12)'}`, background: level === 'adult' ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.4)' }}>
        <div className="w-7 h-7 rounded-xl grid place-items-center" style={{ background: `${primary}22`, color: primary }}><Heart size={16} fill="currentColor" /></div>
        <div className="font-semibold text-sm" style={{ color: level === 'adult' ? '#ffe3ed' : '#654354' }}>情侣真心话大冒险</div>
        <div className="text-[10px]" style={{ color: level === 'adult' ? '#cf9daf' : '#a78495' }}>第 {round} 轮</div>
        <button onClick={restart} className="ml-auto w-8 h-8 rounded-full grid place-items-center" style={{ color: level === 'adult' ? '#f6b5ca' : primary, background: `${primary}16` }} aria-label="重新开始"><RefreshCcw size={15} /></button>
        <button onClick={onClose} className="w-8 h-8 rounded-full grid place-items-center" style={{ color: level === 'adult' ? '#f6b5ca' : primary, background: `${primary}16` }} aria-label="收起游戏"><ChevronLeft size={18} style={{ transform: 'rotate(90deg)' }} /></button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <div className="flex gap-2">
          {COUPLES_TOD_LEVELS.map(item => (
            <button key={item.id} onClick={() => chooseLevel(item.id)} className="flex-1 rounded-2xl px-2 py-2 text-center" style={{ border: `1px solid ${level === item.id ? primary : 'rgba(160,120,145,.13)'}`, background: level === item.id ? `${primary}20` : 'rgba(255,255,255,.10)', color: level === 'adult' ? '#f5cedb' : '#765568' }}>
              <div className="text-base">{item.icon}</div><div className="text-[11px] font-semibold">{item.label}</div>
            </button>
          ))}
        </div>

        {selectedLevel?.adult && (
          <label className="mt-2.5 flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(255,255,255,.07)', color: '#e4b8c8' }}>
            <input type="checkbox" checked={adultConfirmed} onChange={event => setAdultConfirmed(event.target.checked)} style={{ marginTop: 2, accentColor: primary }} />
            <span className="text-[10px] leading-relaxed"><ShieldCheck size={12} style={{ display: 'inline', marginRight: 4 }} />确认双方均已成年、自愿参与；任何题都可以拒绝、修改或跳过。</span>
          </label>
        )}

        <div className="mt-3 rounded-[24px] px-4 py-4 text-center" style={{ minHeight: 118, background: level === 'adult' ? 'rgba(255,255,255,.08)' : 'rgba(255,255,255,.70)', border: `1px solid ${level === 'adult' ? 'rgba(255,190,215,.15)' : 'rgba(255,255,255,.9)'}`, boxShadow: '0 8px 24px rgba(82,39,63,.09)' }}>
          {current ? (
            <>
              <div className="text-[10px] font-semibold" style={{ color: primary }}>{current.type === 'truth' ? '真心话' : '大冒险'} · 轮到 {current.target === 'ai' ? (aiName || 'CC') : '我'}</div>
              {rollResult && <div className="mt-1 text-[11px]" style={{ color: level === 'adult' ? '#d9adbc' : '#927688' }}>我 {DICE_FACES[rollResult.user - 1]} {rollResult.user} · {aiName || 'CC'} {DICE_FACES[rollResult.ai - 1]} {rollResult.ai}</div>}
              <div className="mt-2 text-[14px] leading-relaxed font-medium" style={{ color: level === 'adult' ? '#ffe9f0' : '#5e4050' }}>{current.text}</div>
              <div className="mt-3 flex justify-center gap-2">
                <button onClick={nextRound} className="rounded-full px-4 py-2 text-xs text-white" style={{ border: 0, background: `linear-gradient(135deg,${primary},${primaryDark})` }}>完成 · 换人</button>
                <button onClick={nextRound} className="rounded-full px-4 py-2 text-xs" style={{ border: `1px solid ${primary}33`, color: level === 'adult' ? '#e6b9c8' : '#8c687a', background: 'transparent' }}>跳过</button>
              </div>
            </>
          ) : rollResult ? (
            <>
              <div className="flex items-center justify-center gap-6">
                <div><div className="text-4xl" style={{ color: primary }}>{DICE_FACES[rollResult.user - 1]}</div><div className="mt-1 text-[10px]" style={{ color: level === 'adult' ? '#d7aaba' : '#8f7182' }}>我 · {rollResult.user}</div></div>
                <div><div className="text-4xl" style={{ color: primary }}>{DICE_FACES[rollResult.ai - 1]}</div><div className="mt-1 text-[10px] max-w-[100px] truncate" style={{ color: level === 'adult' ? '#d7aaba' : '#8f7182' }}>{aiName || 'CC'} · {rollResult.ai}</div></div>
              </div>
              <div className="mt-2 text-xs font-semibold" style={{ color: primary }}>{rollResult.loser === 'user' ? '我输了，我来选' : `${aiName || 'CC'} 输了，由他先在聊天里选`}</div>
              {rollResult.loser === 'ai' && <div className="mt-1 text-[10px]" style={{ color: level === 'adult' ? '#c99ead' : '#9b7d8e' }}>等他说“我选真心话/大冒险”后自动抽牌；按钮可手动兜底</div>}
              <div className="mt-3 flex justify-center gap-2">
                <button disabled={sending || isLoading} onClick={() => draw('truth')} className="rounded-full px-5 py-2.5 text-xs font-semibold disabled:opacity-45" style={{ border: 0, color: '#476984', background: '#dcedfa' }}>💬 选真心话</button>
                <button disabled={sending || isLoading} onClick={() => draw('dare')} className="rounded-full px-5 py-2.5 text-xs font-semibold disabled:opacity-45" style={{ border: 0, color: 'white', background: `linear-gradient(135deg,${primary},${primaryDark})` }}>🔥 选大冒险</button>
              </div>
            </>
          ) : (
            <>
              <div className="text-3xl">{level === 'adult' ? <Flame size={34} style={{ display: 'inline', color: '#ff739d' }} /> : '💞'}</div>
              <div className="mt-1 text-xs" style={{ color: level === 'adult' ? '#d5a7b8' : '#98798a' }}>{sending || isLoading ? '等 CC 回完这一轮…' : '双方先摇骰，点数小的人输'}</div>
              <button disabled={sending || isLoading} onClick={rollBoth} className="mt-3 rounded-full px-6 py-2.5 text-xs font-semibold text-white disabled:opacity-45" style={{ border: 0, background: `linear-gradient(135deg,${primary},${primaryDark})` }}>🎲 双方摇骰</button>
            </>
          )}
        </div>
        {error && <div className="mt-2 text-center text-[11px]" style={{ color: '#e27c91' }}>{error}</div>}
      </div>
    </section>
  )
}
