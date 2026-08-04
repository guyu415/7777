import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { useStore } from '../../../../store'
import { cleanupMysteryGame } from '../../../../services/companion'
import { isVpsMemberId } from '../../../../utils/groupMembers'
import PokerShell from './PokerShell'
import PokerCard from './PokerCard'
import PokerSetupPanel from './PokerSetupPanel'
import { callSeatForPokerDecision, cleanupStuckSeat, buildPokerSystemPrompt } from './pokerAiCall'
import {
  createDoudizhuGame, restartDoudizhu, bid, applyPlay, enumerateBidOptions, enumerateLegalActions,
  autoChooseAction, autoChooseBid, buildBidPrompt, buildPlayPrompt, parseChoiceIndex, HAND_TYPE_LABEL,
} from './doudizhuEngine'

const GAME_LABEL = '斗地主'
const charIdFor = (seatIndex) => `seat${seatIndex}`
const vpsCharIdsOf = (game) => game.players
  .map((p, i) => ({ p, i }))
  .filter(({ p }) => p.kind === 'ai' && isVpsMemberId(p.memberId))
  .map(({ i }) => charIdFor(i))

// 斗地主房间。整局规则都在 doudizhuEngine.js（纯函数），这里只做三件事：
// 画出来；轮到 AI 玩家时用群成员自己的模型真实调用一次（10 秒思考超时，
// 超时/报错/解析不出合法选项立刻自动托管，绝不卡住整局）；把引擎返回的
// 新状态写回 store（持久化，误退群聊/刷新都能续玩）。
export default function DoudizhuRoom({ theme, chatId, chat, onBack }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const sessions = useStore((s) => s.sessions)
  const providers = useStore((s) => s.providers)
  const selectedProviderId = useStore((s) => s.selectedProviderId)
  const globalApiKey = useStore((s) => s.apiKey)
  const globalApiBaseUrl = useStore((s) => s.apiBaseUrl)
  const globalModel = useStore((s) => s.model)
  const workerUrl = useStore((s) => s.workerUrl)
  const useWorkerProxy = useStore((s) => s.useWorkerProxy)
  const globals = { providers, selectedProviderId, apiKey: globalApiKey, apiBaseUrl: globalApiBaseUrl, model: globalModel, workerUrl, useWorkerProxy }

  const game = useStore((s) => s.doudizhuGames?.[chatId]) || null
  const setGame = useStore((s) => s.setDoudizhuGame)
  const clearGame = useStore((s) => s.clearDoudizhuGame)

  const [selected, setSelected] = useState(() => new Set())
  const [playError, setPlayError] = useState('')
  const [aiState, setAiState] = useState(null) // { seatIndex, status:'thinking' }
  const runningRef = useRef(new Set())

  const commit = (fn) => {
    const store = useStore.getState()
    const cur = store.doudizhuGames?.[chatId]
    if (!cur) return
    store.setDoudizhuGame(chatId, fn(cur))
  }

  // ------------------------------------------------------------ AI 回合
  const runAiBid = async (seatIndex, seat) => {
    const cur = useStore.getState().doudizhuGames?.[chatId]
    if (!cur) return
    const key = `bid:${seatIndex}:${cur.bids.length}`
    if (runningRef.current.has(key)) return
    runningRef.current.add(key)
    setAiState({ seatIndex, status: 'thinking' })
    const systemPrompt = buildPokerSystemPrompt('', GAME_LABEL)
    const turnPrompt = buildBidPrompt(cur, seatIndex)
    const options = enumerateBidOptions(cur)
    let value
    let auto = false
    try {
      const text = await callSeatForPokerDecision({ runId: cur.runId, charId: charIdFor(seatIndex), seat, sessions, globals, systemPrompt, turnPrompt })
      const idx = parseChoiceIndex(text, options.length - 1)
      if (idx == null) throw new Error('返回格式无法解析')
      value = options[idx]
    } catch {
      value = autoChooseBid()
      auto = true
      cleanupStuckSeat(cur.runId, charIdFor(seatIndex), seat)
    } finally {
      runningRef.current.delete(key)
    }
    setAiState(null)
    commit((g) => (g.phase === 'bidding' && g.biddingTurn === seatIndex ? bid(g, seatIndex, value, { auto }) : g))
  }

  const runAiPlay = async (seatIndex, seat) => {
    const cur = useStore.getState().doudizhuGames?.[chatId]
    if (!cur) return
    const key = `play:${seatIndex}:${cur.history.length}`
    if (runningRef.current.has(key)) return
    runningRef.current.add(key)
    setAiState({ seatIndex, status: 'thinking' })
    const systemPrompt = buildPokerSystemPrompt('', GAME_LABEL)
    const turnPrompt = buildPlayPrompt(cur, seatIndex)
    const { canPass, actions } = enumerateLegalActions(cur, seatIndex)
    const maxIndex = actions.length - 1 + (canPass ? 1 : 0)
    let cards
    let auto = false
    try {
      const text = await callSeatForPokerDecision({ runId: cur.runId, charId: charIdFor(seatIndex), seat, sessions, globals, systemPrompt, turnPrompt })
      const idx = parseChoiceIndex(text, maxIndex)
      if (idx == null) throw new Error('返回格式无法解析')
      cards = canPass && idx === 0 ? [] : actions[idx - (canPass ? 1 : 0)].cards
    } catch {
      cards = autoChooseAction(cur, seatIndex).cards
      auto = true
      cleanupStuckSeat(cur.runId, charIdFor(seatIndex), seat)
    } finally {
      runningRef.current.delete(key)
    }
    setAiState(null)
    commit((g) => {
      if (g.phase !== 'playing' || g.turn !== seatIndex) return g
      try {
        return applyPlay(g, seatIndex, cards, { auto })
      } catch {
        // 保险丝：万一托管选出的牌因为状态已经变化而不再合法（正常流程下
        // 不会发生，enumerateLegalActions/autoChooseAction 都基于最新 state
        // 现算），退化成基于最新 state 重新算一次托管，绝不能让整局卡住。
        const fallback = autoChooseAction(g, seatIndex)
        return applyPlay(g, seatIndex, fallback.cards, { auto: true })
      }
    })
  }

  useEffect(() => {
    if (!game || game.finished) return
    if (game.phase === 'bidding') {
      const seat = game.players[game.biddingTurn]
      if (seat.kind === 'ai') runAiBid(game.biddingTurn, seat)
    } else if (game.phase === 'playing') {
      const seat = game.players[game.turn]
      if (seat.kind === 'ai') runAiPlay(game.turn, seat)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, game?.biddingTurn, game?.turn, game?.bids?.length, game?.history?.length, game?.finished])

  // ------------------------------------------------------------ 用户操作
  const userBid = (value) => {
    setPlayError('')
    try {
      commit((g) => bid(g, 0, value))
    } catch (e) {
      setPlayError(e.message)
    }
  }
  const toggleCard = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  const userPlay = () => {
    setPlayError('')
    try {
      commit((g) => applyPlay(g, 0, [...selected]))
      setSelected(new Set())
    } catch (e) {
      setPlayError(e.message || '这手牌不合法')
    }
  }
  const userPass = () => {
    setPlayError('')
    try {
      commit((g) => applyPlay(g, 0, []))
      setSelected(new Set())
    } catch (e) {
      setPlayError(e.message)
    }
  }

  const restart = () => {
    if (!game) return
    const oldRunId = game.runId
    const oldCharIds = vpsCharIdsOf(game)
    setSelected(new Set())
    setPlayError('')
    setGame(chatId, restartDoudizhu(game))
    if (oldCharIds.length) cleanupMysteryGame(oldRunId, oldCharIds).catch(() => {})
  }
  const endGame = () => {
    if (!game || !window.confirm('结束这局斗地主？进度会被清空，无法恢复。')) return
    const oldRunId = game.runId
    const oldCharIds = vpsCharIdsOf(game)
    clearGame(chatId)
    if (oldCharIds.length) cleanupMysteryGame(oldRunId, oldCharIds).catch(() => {})
  }

  // ------------------------------------------------------------ 渲染
  if (!game) {
    return (
      <PokerShell theme={theme} title="斗地主" icon="🀄" onBack={onBack}>
        <PokerSetupPanel
          theme={theme} chat={chat} sessions={sessions} globals={globals}
          ruleNote="三人局：你和两位群成员。标准54张牌，17张手牌+3张底牌，选正好 2 位群成员当 AI 对手，可以分别指定这一局用的模型。"
          onStart={(players) => setGame(chatId, createDoudizhuGame(players))}
        />
      </PokerShell>
    )
  }

  const me = game.players[0]
  const roleLabel = (role) => (role === 'landlord' ? '地主' : role === 'farmer' ? '农民' : '')
  const isMyBidTurn = game.phase === 'bidding' && game.biddingTurn === 0
  const isMyPlayTurn = game.phase === 'playing' && game.turn === 0
  const bidOptions = isMyBidTurn ? enumerateBidOptions(game) : []
  const { canPass } = game.phase === 'playing' ? enumerateLegalActions(game, 0) : { canPass: false }
  const selectedCards = me.hand ? me.hand.filter((c) => selected.has(c.id)) : []
  const lastHistoryAuto = game.history[game.history.length - 1]?.auto

  return (
    <PokerShell
      theme={theme} title="斗地主" icon="🀄" onBack={onBack}
      actions={(
        <button onClick={endGame} aria-label="结束本局" className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.06)', color: '#c9647a' }}>
          <Trash2 size={14} />
        </button>
      )}
    >
      <main className="flex-1 overflow-y-auto px-3 py-3 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex gap-2 mb-3">
          {[1, 2].map((i) => {
            const p = game.players[i]
            const isTurn = (game.phase === 'bidding' && game.biddingTurn === i) || (game.phase === 'playing' && game.turn === i)
            const thinking = aiState?.seatIndex === i
            return (
              <div key={i} className="flex-1 text-center rounded-2xl py-2" style={{ background: 'rgba(255,255,255,0.65)', border: isTurn ? `1.5px solid ${primary}` : '1px solid rgba(0,0,0,0.06)' }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#5a3548' }}>{p.name || p.memberId}</div>
                <div className="text-[10px] mt-0.5" style={{ color: '#a2798a' }}>
                  {p.role ? roleLabel(p.role) : ''}{p.role ? ' · ' : ''}{p.hand ? `${p.hand.length}张` : ''}
                </div>
                {thinking && <div className="text-[10px] mt-0.5" style={{ color: primaryDark }}>思考中…</div>}
              </div>
            )
          })}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center rounded-2xl mb-3 px-3 py-4" style={{ minHeight: 130, background: 'rgba(255,255,255,0.45)' }}>
          {game.phase === 'bidding' && (
            <div className="text-center text-[12.5px] w-full" style={{ color: '#5a3548' }}>
              {game.bids.length === 0 && <div style={{ color: '#a2798a' }}>叫分开始</div>}
              {game.bids.map((b, i) => (
                <div key={i}>{game.players[b.player]?.name || '我'}：{b.value === 0 ? '不叫' : `${b.value}分`}{b.auto ? '（自动托管）' : ''}</div>
              ))}
              {!isMyBidTurn && <div className="mt-1.5" style={{ color: '#a2798a' }}>等待 {game.players[game.biddingTurn]?.name || '对方'} 叫分…</div>}
            </div>
          )}
          {game.phase === 'playing' && (
            <div className="text-center w-full">
              {game.lastPlay ? (
                <>
                  <div className="text-[10.5px] mb-1.5" style={{ color: '#a2798a' }}>
                    {game.players[game.lastPlay.player]?.name || '我'} 出的（{HAND_TYPE_LABEL[game.lastPlay.handType.type]}）
                    {lastHistoryAuto ? '（自动托管）' : ''}
                  </div>
                  <div className="flex gap-1 justify-center flex-wrap">
                    {game.lastPlay.cards.map((c) => <PokerCard key={c.id} card={c} size="sm" />)}
                  </div>
                </>
              ) : (
                <div className="text-[12px]" style={{ color: '#a2798a' }}>{game.players[game.turn]?.name || '我'} 需要主动出牌</div>
              )}
            </div>
          )}
          {game.phase === 'finished' && (
            <div className="text-center">
              <div style={{ fontSize: 16, fontWeight: 700, color: '#5a3548' }}>
                {game.winnerRole === 'landlord' ? '🏆 地主获胜！' : '🏆 农民获胜！'}
              </div>
              <button onClick={restart} className="mt-3 inline-flex items-center gap-1.5" style={{ border: 'none', borderRadius: 16, padding: '9px 18px', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontSize: 13, fontWeight: 600 }}>
                <RotateCcw size={13} /> 再来一局
              </button>
            </div>
          )}
        </div>

        {playError && <div className="text-[11px] mb-1 text-center" style={{ color: '#c9647a' }}>{playError}</div>}
      </main>

      {game.phase !== 'finished' && (
        <footer className="flex-shrink-0 px-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
          <div className="flex gap-1 overflow-x-auto pt-2 pb-2" style={{ WebkitOverflowScrolling: 'touch' }}>
            {(me.hand || []).map((c) => (
              <PokerCard key={c.id} card={c} selected={selected.has(c.id)} onClick={isMyPlayTurn ? () => toggleCard(c.id) : undefined} />
            ))}
          </div>
          {isMyBidTurn && (
            <div className="flex gap-2 mb-1">
              {bidOptions.map((v) => (
                <button key={v} onClick={() => userBid(v)} className="flex-1" style={{ border: 'none', borderRadius: 14, padding: '10px 0', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontSize: 13, fontWeight: 600 }}>
                  {v === 0 ? '不叫' : `${v}分`}
                </button>
              ))}
            </div>
          )}
          {isMyPlayTurn && (
            <div className="flex gap-2 mb-1">
              <button onClick={userPass} disabled={!canPass} className="flex-1" style={{ border: `1px solid ${primary}55`, borderRadius: 14, padding: '10px 0', color: primary, background: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: 600, opacity: canPass ? 1 : 0.4 }}>
                过牌
              </button>
              <button onClick={userPlay} disabled={selectedCards.length === 0} className="flex-1" style={{ border: 'none', borderRadius: 14, padding: '10px 0', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontSize: 13, fontWeight: 600, opacity: selectedCards.length ? 1 : 0.5 }}>
                出牌
              </button>
            </div>
          )}
        </footer>
      )}
    </PokerShell>
  )
}
