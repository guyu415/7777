import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Trash2, Volume2, VolumeX } from 'lucide-react'
import { useStore } from '../../../../store'
import { cleanupMysteryGame } from '../../../../services/companion'
import { isVpsMemberId } from '../../../../utils/groupMembers'
import PokerShell from './PokerShell'
import PokerCard from './PokerCard'
import PokerSetupPanel from './PokerSetupPanel'
import PokerHand from './PokerHand'
import PokerPlayHistory from './PokerPlayHistory'
import PokerSummaryPanel from './PokerSummaryPanel'
import { usePokerAudio } from './pokerAudio'
import { doudizhuSummary } from './gameSummary'
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

function DoudizhuSeat({ player, index, active, thinking, roleLabel, primary, primaryDark, style }) {
  return (
    <div style={{ position: 'absolute', zIndex: 4, width: index === 0 ? 94 : 76, minWidth: 0, padding: '6px 5px', borderRadius: 13, textAlign: 'center', background: active ? 'rgba(255,255,255,.94)' : 'rgba(255,255,255,.68)', border: active ? `2px solid ${primary}` : '1px solid rgba(0,0,0,.06)', boxShadow: active ? `0 0 0 4px ${primary}16` : 'none', ...style }}>
      <div style={{ color: '#583948', fontSize: 10.5, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{index + 1} · {index === 0 ? '我' : (player.name || player.memberId)}</div>
      <div style={{ color: '#9d7786', fontSize: 8.5, marginTop: 1 }}>{player.role ? `${roleLabel(player.role)} · ` : ''}{player.hand?.length || 0}张</div>
      {thinking && <div style={{ color: primaryDark, fontSize: 8 }}>思考中…</div>}
    </div>
  )
}

// 斗地主房间。整局规则都在 doudizhuEngine.js（纯函数），这里只做三件事：
// 画出来；轮到 AI 玩家时用群成员自己的模型真实调用一次（10 秒思考超时，
// 超时/报错/解析不出合法选项立刻自动托管，绝不卡住整局）；把引擎返回的
// 新状态写回 store（持久化，误退群聊/刷新都能续玩）。
export default function DoudizhuRoom({ theme, chatId, chat, onBack, onPostSummary, onShareSummary }) {
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
  const summaryRef = useRef(new Set())
  const lastHistoryRef = useRef(0)
  const { muted, toggleMuted, play, unlock } = usePokerAudio()

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

  useEffect(() => {
    if (!game) return
    if (game.history.length > lastHistoryRef.current) {
      const entry = game.history[game.history.length - 1]
      if (entry?.type === 'play') play(entry.handType === 'bomb' || entry.handType === 'rocket' ? 'bomb' : 'play')
      else if (entry?.type === 'pass') play('pass')
      else if (entry?.type === 'landlord') play('bid')
    }
    lastHistoryRef.current = game.history.length
  }, [game?.history?.length, play])

  useEffect(() => {
    if (!game?.finished || game.summaryPosted || summaryRef.current.has(game.id)) return
    summaryRef.current.add(game.id)
    const summary = doudizhuSummary(game)
    play(game.winnerRole === game.players[0]?.role ? 'win' : 'lose')
    Promise.resolve(onPostSummary?.(summary))
      .then(() => commit((g) => g.id === game.id ? { ...g, summaryPosted: true } : g))
      .catch(() => summaryRef.current.delete(game.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.finished, game?.summaryPosted, game?.id])

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
    unlock()
    play('select')
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
  const summary = game.finished ? doudizhuSummary(game) : null

  return (
    <PokerShell
      theme={theme} title="斗地主" icon="🀄" onBack={onBack}
      actions={(
        <><button onClick={toggleMuted} aria-label={muted ? '开启游戏音乐' : '关闭游戏音乐'} className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.58)', color: '#8c6172' }}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button><button onClick={endGame} aria-label="结束本局" className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.06)', color: '#c9647a' }}>
          <Trash2 size={14} />
        </button></>
      )}
    >
      <main className="flex-1 overflow-y-auto px-3 pt-3 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex-1 relative flex flex-col items-center justify-center rounded-3xl mb-2 overflow-hidden" style={{ minHeight: 260, padding: game.finished ? '22px 14px' : '48px 84px 58px', background: 'radial-gradient(circle at 48% 43%, rgba(255,255,255,.88), rgba(244,222,228,.58))', border: '1px solid rgba(255,255,255,.72)' }}>
          <PokerPlayHistory history={game.history} players={game.players} accent={primary} />
          {!game.finished && (
            <>
              <div aria-hidden="true" style={{ position: 'absolute', inset: '38px 48px 45px', border: `1px dashed ${primary}30`, borderRadius: '50%' }} />
              <div style={{ position: 'absolute', left: '50%', top: 9, transform: 'translateX(-50%)', color: '#9b7484', fontSize: 9, letterSpacing: 1, whiteSpace: 'nowrap' }}>① → ② → ③ · 顺时针</div>
              {[0, 1, 2].map((i) => {
                const active = (game.phase === 'bidding' ? game.biddingTurn : game.turn) === i
                const positions = [
                  { left: '50%', bottom: 7, transform: 'translateX(-50%)' },
                  { left: 7, top: '48%', transform: 'translateY(-50%)' },
                  { right: 7, top: '48%', transform: 'translateY(-50%)' },
                ]
                return <DoudizhuSeat key={i} player={game.players[i]} index={i} active={active} thinking={aiState?.seatIndex === i} roleLabel={roleLabel} primary={primary} primaryDark={primaryDark} style={positions[i]} />
              })}
              <span style={{ position: 'absolute', left: 52, bottom: 54, color: `${primary}99`, fontSize: 13 }}>↖</span>
              <span style={{ position: 'absolute', right: 52, top: '26%', color: `${primary}99`, fontSize: 13 }}>↘</span>
            </>
          )}
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
            <div className="text-center flex flex-col items-center" style={{ width: '100%' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#5a3548' }}>
                {game.winnerRole === 'landlord' ? '🏆 地主获胜！' : '🏆 农民获胜！'}
              </div>
              <button onClick={restart} className="mt-3 inline-flex items-center gap-1.5" style={{ border: 'none', borderRadius: 16, padding: '9px 18px', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontSize: 13, fontWeight: 600 }}>
                <RotateCcw size={13} /> 再来一局
              </button>
              <PokerSummaryPanel summary={summary} sessions={sessions} onShare={onShareSummary} accent={primary} />
            </div>
          )}
        </div>

        {playError && <div className="text-[11px] mb-1 text-center" style={{ color: '#c9647a' }}>{playError}</div>}
      </main>

      {game.phase !== 'finished' && (
        <footer className="flex-shrink-0 px-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
          <PokerHand cards={me.hand || []} selected={selected} disabled={!isMyPlayTurn} onCardClick={(card) => toggleCard(card.id)} />
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
