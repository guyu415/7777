import { useEffect, useRef, useState } from 'react'
import { RotateCcw, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { useStore } from '../../../../store'
import { cleanupMysteryGame } from '../../../../services/companion'
import { isVpsMemberId } from '../../../../utils/groupMembers'
import PokerShell from './PokerShell'
import PokerCard from './PokerCard'
import PokerHand from './PokerHand'
import PokerPlayHistory from './PokerPlayHistory'
import PokerSetupPanel from './PokerSetupPanel'
import PokerSummaryPanel from './PokerSummaryPanel'
import { usePokerAudio } from './pokerAudio'
import { sichuanUpgradeSummary } from './gameSummary'
import { callSeatForPokerDecision, cleanupStuckSeat, buildPokerSystemPrompt } from './pokerAiCall'
import {
  autoChooseBury, autoChooseCall, autoChoosePlay, buildBuryPrompt, buildCallPrompt, buildPlayPrompt,
  buryCards, callTrump, createSichuanUpgradeGame, currentCallOption, enumerateLegalCards,
  parseChoiceIndex, playUpgradeCard, restartSichuanUpgrade,
} from './sichuanUpgradeEngine'
import { rankLabel } from './cards'

const GAME_LABEL = '四川版升级'
const charIdFor = (seatIndex) => `seat${seatIndex}`
const vpsCharIdsOf = (game) => game.players
  .map((p, i) => ({ p, i }))
  .filter(({ p }) => p.kind === 'ai' && isVpsMemberId(p.memberId))
  .map(({ i }) => charIdFor(i))

export default function SichuanUpgradeRoom({ theme, chatId, chat, onBack, onPostSummary, onShareSummary }) {
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

  const game = useStore((s) => s.sichuanUpgradeGames?.[chatId]) || null
  const setGame = useStore((s) => s.setSichuanUpgradeGame)
  const clearGame = useStore((s) => s.clearSichuanUpgradeGame)
  const [selected, setSelected] = useState(() => new Set())
  const [error, setError] = useState('')
  const [aiState, setAiState] = useState(null)
  const [showBuried, setShowBuried] = useState(false)
  const runningRef = useRef(new Set())
  const summaryRef = useRef(new Set())
  const lastHistoryRef = useRef(0)
  const { muted, toggleMuted, play, unlock } = usePokerAudio()

  const commit = (fn) => {
    const store = useStore.getState()
    const current = store.sichuanUpgradeGames?.[chatId]
    if (current) store.setSichuanUpgradeGame(chatId, fn(current))
  }

  const callAi = async (seatIndex, seat) => {
    const cur = useStore.getState().sichuanUpgradeGames?.[chatId]
    if (!cur || cur.turn !== seatIndex || cur.finished) return
    const key = `${cur.phase}:${seatIndex}:${cur.history.length}`
    if (runningRef.current.has(key)) return
    runningRef.current.add(key)
    setAiState({ seatIndex, status: 'thinking' })
    const systemPrompt = buildPokerSystemPrompt('', GAME_LABEL)
    let result
    let auto = false
    try {
      if (cur.phase === 'calling') {
        const text = await callSeatForPokerDecision({ runId: cur.runId, charId: charIdFor(seatIndex), seat, sessions, globals, systemPrompt, turnPrompt: buildCallPrompt(cur, seatIndex) })
        const choice = parseChoiceIndex(text, 1)
        if (choice == null) throw new Error('叫主格式错误')
        result = { kind: 'call', accept: choice === 1 }
      } else if (cur.phase === 'burying') {
        const built = buildBuryPrompt(cur, seatIndex)
        const text = await callSeatForPokerDecision({ runId: cur.runId, charId: charIdFor(seatIndex), seat, sessions, globals, systemPrompt, turnPrompt: built.prompt })
        const choice = parseChoiceIndex(text, built.options.length - 1)
        if (choice == null) throw new Error('换底格式错误')
        result = { kind: 'bury', cards: built.options[choice] }
      } else {
        const built = buildPlayPrompt(cur, seatIndex)
        const text = await callSeatForPokerDecision({ runId: cur.runId, charId: charIdFor(seatIndex), seat, sessions, globals, systemPrompt, turnPrompt: built.prompt })
        const choice = parseChoiceIndex(text, built.options.length - 1)
        if (choice == null) throw new Error('出牌格式错误')
        result = { kind: 'play', card: built.options[choice] }
      }
    } catch {
      auto = true
      cleanupStuckSeat(cur.runId, charIdFor(seatIndex), seat)
      if (cur.phase === 'calling') result = { kind: 'call', accept: autoChooseCall(cur, seatIndex) }
      else if (cur.phase === 'burying') result = { kind: 'bury', cards: autoChooseBury(cur, seatIndex) }
      else result = { kind: 'play', card: autoChoosePlay(cur, seatIndex) }
    } finally {
      runningRef.current.delete(key)
      setAiState(null)
    }
    commit((latest) => {
      if (latest.turn !== seatIndex || latest.phase !== cur.phase) return latest
      if (result.kind === 'call') return callTrump(latest, seatIndex, result.accept, { auto })
      if (result.kind === 'bury') return buryCards(latest, seatIndex, result.cards, { auto })
      return playUpgradeCard(latest, seatIndex, result.card, { auto })
    })
  }

  useEffect(() => {
    if (!game || game.finished) return
    const seat = game.players[game.turn]
    if (seat?.kind === 'ai') callAi(game.turn, seat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.phase, game?.turn, game?.history?.length, game?.finished])

  useEffect(() => {
    if (!game) return
    if (game.history.length > lastHistoryRef.current) {
      const entry = game.history[game.history.length - 1]
      if (entry?.type === 'play') play('play')
      else if (entry?.type === 'call') play('bid')
      else if (entry?.type === 'bury') play('deal')
    }
    lastHistoryRef.current = game.history.length
  }, [game?.history?.length, play])

  useEffect(() => {
    if (!game?.finished || game.summaryPosted || summaryRef.current.has(game.id)) return
    summaryRef.current.add(game.id)
    const summary = sichuanUpgradeSummary(game)
    Promise.resolve(onPostSummary?.(summary))
      .then(() => commit((g) => g.id === game.id ? { ...g, summaryPosted: true } : g))
      .catch(() => summaryRef.current.delete(game.id))
  }, [game?.finished, game?.summaryPosted, game?.id])

  const toggleCard = (card) => {
    unlock(); play('select'); setError('')
    setSelected((prev) => {
      const next = new Set(prev)
      if (game.phase === 'playing') return new Set(next.has(card.id) ? [] : [card.id])
      if (next.has(card.id)) next.delete(card.id)
      else if (next.size < 6) next.add(card.id)
      return next
    })
  }

  const userCall = (accept) => {
    try { unlock(); commit((g) => callTrump(g, 0, accept)); setError('') } catch (e) { setError(e.message) }
  }
  const userBury = () => {
    try { commit((g) => buryCards(g, 0, [...selected])); setSelected(new Set()); setError('') } catch (e) { setError(e.message) }
  }
  const userPlay = () => {
    try { commit((g) => playUpgradeCard(g, 0, [...selected][0])); setSelected(new Set()); setError('') } catch (e) { setError(e.message) }
  }

  const restart = () => {
    const oldRunId = game.runId
    const ids = vpsCharIdsOf(game)
    setSelected(new Set())
    setGame(chatId, restartSichuanUpgrade(game))
    if (ids.length) cleanupMysteryGame(oldRunId, ids).catch(() => {})
  }
  const endGame = () => {
    if (!window.confirm('结束这局四川版升级？进度会被清空。')) return
    const ids = vpsCharIdsOf(game)
    clearGame(chatId)
    if (ids.length) cleanupMysteryGame(game.runId, ids).catch(() => {})
  }

  if (!game) return (
    <PokerShell theme={theme} title="四川版升级" icon="🂡" onBack={onBack}>
      <PokerSetupPanel
        theme={theme} chat={chat} sessions={sessions} globals={globals} requiredCount={3} teamMode
        ruleNote="四人单副牌，对家一队。选择3位群成员，再指定其中一位坐在你对面当队友；第一轮从A开始。"
        onStart={(players) => setGame(chatId, createSichuanUpgradeGame(players))}
      />
    </PokerShell>
  )

  const me = game.players[0]
  const callOption = game.phase === 'calling' ? currentCallOption(game) : null
  const isMyTurn = game.turn === 0
  const legalIds = new Set(game.phase === 'playing' && isMyTurn ? enumerateLegalCards(game, 0).map((c) => c.id) : [])
  const summary = game.finished ? sichuanUpgradeSummary(game) : null
  const audioButton = (
    <button onClick={toggleMuted} aria-label={muted ? '开启游戏音乐' : '关闭游戏音乐'} style={{ width: 32, height: 32, borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.58)', color: '#8c6172', display: 'grid', placeItems: 'center' }}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button>
  )

  return (
    <PokerShell theme={theme} title="四川版升级" icon="🂡" onBack={onBack} actions={<>{audioButton}<button onClick={endGame} aria-label="结束本局" style={{ width: 32, height: 32, borderRadius: '50%', border: 0, background: 'rgba(255,255,255,.58)', color: '#c9647a', display: 'grid', placeItems: 'center' }}><Trash2 size={14} /></button></>}>
      <main className="flex-1 flex flex-col px-2.5 pt-2" style={{ minHeight: 0, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
          {[1, 2, 3].map((i) => {
            const p = game.players[i]
            const active = game.turn === i && !game.finished
            return <div key={i} style={{ minWidth: 0, padding: '7px 4px', borderRadius: 13, textAlign: 'center', background: p.team === game.dealerTeam ? 'rgba(255,255,255,.68)' : `${primary}10`, border: active ? `1.5px solid ${primary}` : '1px solid rgba(0,0,0,.055)' }}>
              <div style={{ color: '#583948', fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
              <div style={{ color: '#9d7786', fontSize: 9.5 }}>{p.team === game.dealerTeam ? '庄家队' : '抓分方'} · {p.hand.length}张{game.dealer === i ? ' · 庄' : ''}</div>
              {aiState?.seatIndex === i && <div style={{ color: primaryDark, fontSize: 9 }}>思考中…</div>}
            </div>
          })}
        </div>

        <section style={{ position: 'relative', flex: 1, minHeight: 0, marginTop: 7, borderRadius: 22, overflow: 'hidden', background: 'radial-gradient(circle at 48% 44%, rgba(255,255,255,.86), rgba(244,222,228,.58))', border: '1px solid rgba(255,255,255,.7)' }}>
          <div style={{ position: 'absolute', left: 10, top: 9, color: '#795362', fontSize: 10.5, lineHeight: 1.55 }}>
            <div><b>打 {rankLabel(game.levelRank)}</b> · {game.trumpSuit ? `${game.trumpSuit}主` : '等待叫主'}</div>
            <div>庄家：{game.players[game.dealer].name}</div>
            <div>闲家得分：<b style={{ color: primaryDark }}>{game.defenderScore}</b></div>
          </div>
          <PokerPlayHistory history={game.history} players={game.players} accent={primary} />
          {game.buriedCards.length > 0 && (
            <button onClick={() => setShowBuried(true)} style={{ position: 'absolute', left: 8, bottom: 8, zIndex: 3, width: 78, border: `1px solid ${primary}25`, borderRadius: 13, background: 'rgba(255,255,255,.7)', padding: '5px 5px 4px', color: '#8d6675' }}>
              <div style={{ fontSize: 8.5, marginBottom: 2 }}>公开新底牌</div>
              <div style={{ position: 'relative', height: 27 }}>
                {game.buriedCards.map((card, i) => <PokerCard key={card.id} card={card} size="micro" style={{ position: 'absolute', left: i * 9, top: 0, zIndex: i }} />)}
              </div>
            </button>
          )}

          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '72px 86px 18px 12px', textAlign: 'center' }}>
            {game.phase === 'calling' && <><div style={{ color: '#674554', fontSize: 13, fontWeight: 700 }}>摸牌叫主</div><div style={{ color: '#9a7483', fontSize: 10.5, marginTop: 5 }}>{game.players[game.turn].name} 摸到 {callOption?.suit}{rankLabel(game.levelRank)}，正在决定是否叫主</div></>}
            {game.phase === 'burying' && <><div style={{ color: '#674554', fontSize: 13, fontWeight: 700 }}>庄家换底牌</div><div style={{ display: 'flex', gap: 2, marginTop: 7 }}>{game.revealedBottom.map((c) => <PokerCard key={c.id} card={c} size="sm" />)}</div><div style={{ color: '#9a7483', fontSize: 9.5, marginTop: 4 }}>原底牌已公开</div></>}
            {game.phase === 'playing' && <>{game.trick.length ? <><div style={{ color: '#9a7483', fontSize: 9.5, marginBottom: 6 }}>第 {game.trickNo + 1} 墩</div><div style={{ display: 'flex', gap: 5, alignItems: 'flex-end' }}>{game.trick.map((x) => <div key={x.player}><PokerCard card={x.card} size="sm" /><div style={{ fontSize: 8, color: '#987181', marginTop: 2 }}>{game.players[x.player].name}</div></div>)}</div></> : <div style={{ color: '#9a7483', fontSize: 11 }}>{game.players[game.turn].name} 领出</div>}</>}
            {game.phase === 'finished' && <><div style={{ color: '#5e3d4c', fontSize: 16, fontWeight: 800 }}>🏆 {game.result.description}</div><div style={{ color: '#987181', fontSize: 11, marginTop: 4 }}>闲家共吃到 {game.defenderScore} 分</div><button onClick={restart} style={{ marginTop: 10, border: 0, borderRadius: 14, padding: '8px 15px', background: `linear-gradient(135deg,${primary},${primaryDark})`, color: '#fff', fontSize: 12, fontWeight: 700 }}><RotateCcw size={12} style={{ display: 'inline', marginRight: 5 }} />继续下一轮</button><PokerSummaryPanel summary={summary} sessions={sessions} onShare={onShareSummary} accent={primary} /></>}
          </div>
        </section>
        {error && <div style={{ color: '#c9647a', textAlign: 'center', fontSize: 10.5, paddingTop: 3 }}>{error}</div>}
      </main>

      {!game.finished && (
        <footer style={{ flexShrink: 0, padding: '0 10px max(10px, env(safe-area-inset-bottom, 0px))' }}>
          <PokerHand cards={me.hand} selected={selected} disabled={!isMyTurn || (game.phase !== 'burying' && game.phase !== 'playing')} onCardClick={toggleCard} />
          {game.phase === 'calling' && isMyTurn && <div style={{ display: 'flex', gap: 8 }}><button onClick={() => userCall(false)} style={secondaryButton(primary)}>不叫</button><button onClick={() => userCall(true)} style={primaryButton(primary, primaryDark)}>叫 {callOption?.suit} 主</button></div>}
          {game.phase === 'burying' && isMyTurn && <button onClick={userBury} disabled={selected.size !== 6} style={{ ...primaryButton(primary, primaryDark), width: '100%', opacity: selected.size === 6 ? 1 : .45 }}>换下这6张（已选{selected.size}张）</button>}
          {game.phase === 'playing' && isMyTurn && <button onClick={userPlay} disabled={selected.size !== 1 || !legalIds.has([...selected][0])} style={{ ...primaryButton(primary, primaryDark), width: '100%', opacity: selected.size === 1 && legalIds.has([...selected][0]) ? 1 : .45 }}>出牌</button>}
        </footer>
      )}
      {showBuried && (
        <div onClick={() => setShowBuried(false)} style={{ position: 'fixed', inset: 0, zIndex: 130, background: 'rgba(31,18,25,.32)', display: 'flex', alignItems: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', borderRadius: '24px 24px 0 0', background: '#fffaf9', padding: '15px 16px max(18px, env(safe-area-inset-bottom, 0px))' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div><strong style={{ color: '#573847', fontSize: 14 }}>庄家换下的新底牌</strong><div style={{ color: '#a07a89', fontSize: 10, marginTop: 2 }}>本桌所有人都可以查看</div></div>
              <button onClick={() => setShowBuried(false)} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'rgba(0,0,0,.05)', color: '#775463' }}><X size={15} /></button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 5 }}>{game.buriedCards.map((card) => <PokerCard key={card.id} card={card} size="lg" />)}</div>
          </div>
        </div>
      )}
    </PokerShell>
  )
}

const primaryButton = (a, b) => ({ flex: 1, border: 0, borderRadius: 14, padding: '10px 8px', background: `linear-gradient(135deg,${a},${b})`, color: '#fff', fontSize: 12.5, fontWeight: 700 })
const secondaryButton = (a) => ({ flex: 1, border: `1px solid ${a}55`, borderRadius: 14, padding: '10px 8px', background: 'rgba(255,255,255,.75)', color: a, fontSize: 12.5, fontWeight: 700 })
