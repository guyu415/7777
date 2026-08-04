import { useEffect, useRef, useState } from 'react'
import { MessageCircle, RotateCcw, Trash2, Volume2, VolumeX } from 'lucide-react'
import { useStore } from '../../../../store'
import { cleanupMysteryGame } from '../../../../services/companion'
import { isVpsMemberId } from '../../../../utils/groupMembers'
import PokerShell from './PokerShell'
import PokerCard from './PokerCard'
import PokerSetupPanel from './PokerSetupPanel'
import PokerSummaryPanel from './PokerSummaryPanel'
import PokerTableChat from './PokerTableChat'
import { usePokerAudio } from './pokerAudio'
import { pokerChatCharId, requestPokerChatReplies } from './pokerTableChat'
import { zhajinhuaSummary } from './gameSummary'
import { callSeatForPokerDecision, cleanupStuckSeat, buildPokerSystemPrompt } from './pokerAiCall'
import {
  createZhajinhuaGame, restartZhajinhua, lookAtCards, enumerateZhajinhuaActions, applyZhajinhuaAction,
  autoChooseZhajinhuaAction, buildZhajinhuaPrompt, parseChoiceIndex,
} from './zhajinhuaEngine'

const GAME_LABEL = '炸金花'
const charIdFor = (seatIndex) => `seat${seatIndex}`
const vpsCharIdsOf = (game) => game.players
  .map((p, i) => ({ p, i }))
  .filter(({ p }) => p.kind === 'ai' && isVpsMemberId(p.memberId))
  .flatMap(({ i }) => [charIdFor(i), pokerChatCharId(i)])

function actionLabel(a) {
  if (a.type === 'fold') return '弃牌'
  if (a.type === 'call') return `跟注 ${a.amount}`
  if (a.type === 'raise') return `加注到 ${a.amount}`
  if (a.type === 'compare') return `比牌`
  return ''
}

// 炸金花房间。规则/牌型/下注状态机全部在 zhajinhuaEngine.js（纯函数）。
export default function ZhajinhuaRoom({ theme, chatId, chat, onBack, onPostSummary, onDiscussSummary, onShareSummary }) {
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

  const game = useStore((s) => s.zhajinhuaGames?.[chatId]) || null
  const setGame = useStore((s) => s.setZhajinhuaGame)
  const clearGame = useStore((s) => s.clearZhajinhuaGame)

  const [aiState, setAiState] = useState(null)
  const [error, setError] = useState('')
  const [showTableChat, setShowTableChat] = useState(false)
  const [tableChatBusy, setTableChatBusy] = useState(false)
  const runningRef = useRef(new Set())
  const summaryRef = useRef(new Set())
  const lastHistoryRef = useRef(0)
  const { muted, toggleMuted, play, unlock } = usePokerAudio()

  const commit = (fn) => {
    const store = useStore.getState()
    const cur = store.zhajinhuaGames?.[chatId]
    if (!cur) return
    store.setZhajinhuaGame(chatId, fn(cur))
  }

  // ------------------------------------------------------------ AI 回合
  const runAiTurn = async (seatIndex, seat) => {
    const cur = useStore.getState().zhajinhuaGames?.[chatId]
    if (!cur) return
    const key = `turn:${seatIndex}:${cur.actionsCount}`
    if (runningRef.current.has(key)) return
    runningRef.current.add(key)
    setAiState({ seatIndex, status: 'thinking' })
    // AI 座位随时"已看牌"——见 zhajinhuaEngine.js 顶部注释：看牌在这个引擎
    // 里只是展示/记录用的标记，不影响 AI 自己本来就知道的真实手牌。
    const withLook = cur.players[seatIndex].hasLooked ? cur : lookAtCards(cur, seatIndex)
    if (withLook !== cur) commit(() => withLook)
    const systemPrompt = buildPokerSystemPrompt('', GAME_LABEL, seat.name || seat.memberId)
    const turnPrompt = buildZhajinhuaPrompt(withLook, seatIndex)
    const actions = enumerateZhajinhuaActions(withLook, seatIndex)
    let action
    let auto = false
    try {
      const text = await callSeatForPokerDecision({ runId: withLook.runId, charId: charIdFor(seatIndex), seat, sessions, globals, systemPrompt, turnPrompt })
      const idx = parseChoiceIndex(text, actions.length - 1)
      if (idx == null) throw new Error('返回格式无法解析')
      action = actions[idx]
    } catch {
      action = autoChooseZhajinhuaAction(withLook, seatIndex)
      auto = true
      cleanupStuckSeat(withLook.runId, charIdFor(seatIndex), seat)
    } finally {
      runningRef.current.delete(key)
    }
    setAiState(null)
    commit((g) => {
      if (g.phase !== 'betting' || g.turn !== seatIndex) return g
      try {
        return applyZhajinhuaAction(g, seatIndex, action, { auto })
      } catch {
        const fallback = autoChooseZhajinhuaAction(g, seatIndex)
        return applyZhajinhuaAction(g, seatIndex, fallback, { auto: true })
      }
    })
  }

  useEffect(() => {
    if (!game || game.finished) return
    const seat = game.players[game.turn]
    if (seat.kind === 'ai') runAiTurn(game.turn, seat)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.turn, game?.actionsCount, game?.finished])

  useEffect(() => {
    if (!game) return
    if (game.history.length > lastHistoryRef.current) {
      const entry = game.history[game.history.length - 1]
      if (entry?.type === 'fold') play('pass')
      else if (entry?.type === 'call' || entry?.type === 'raise') play('chip')
      else if (entry?.type === 'compare') play('play')
    }
    lastHistoryRef.current = game.history.length
  }, [game?.history?.length, play])

  useEffect(() => {
    if (!game?.finished || game.summaryPosted || summaryRef.current.has(game.id)) return
    summaryRef.current.add(game.id)
    const summary = zhajinhuaSummary(game)
    play(game.winner === 0 ? 'win' : 'lose')
    Promise.resolve(onPostSummary?.(summary))
      .then(() => commit((g) => g.id === game.id ? { ...g, summaryPosted: true } : g))
      .catch(() => summaryRef.current.delete(game.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.finished, game?.summaryPosted, game?.id])

  // ------------------------------------------------------------ 用户操作
  const userLook = () => {
    unlock()
    setError('')
    try {
      commit((g) => lookAtCards(g, 0))
    } catch (e) {
      setError(e.message)
    }
  }
  const userAct = (action) => {
    unlock()
    setError('')
    try {
      commit((g) => applyZhajinhuaAction(g, 0, action))
    } catch (e) {
      setError(e.message || '操作失败')
    }
  }

  const sendTableChat = async (value) => {
    const snapshot = useStore.getState().zhajinhuaGames?.[chatId]
    if (!snapshot || tableChatBusy) return
    const stamp = Date.now()
    commit((g) => ({ ...g, tableChat: [...(g.tableChat || []), { id: `tablechat-${stamp}-user`, player: 0, text: value }].slice(-60) }))
    setTableChatBusy(true)
    try {
      const replies = await requestPokerChatReplies({ game: snapshot, gameLabel: GAME_LABEL, userText: value, sessions, globals })
      if (replies.length) commit((g) => g.id === snapshot.id ? { ...g, tableChat: [...(g.tableChat || []), ...replies.map((reply, i) => ({ id: `tablechat-${stamp}-${reply.player}-${i}`, ...reply }))].slice(-60) } : g)
    } finally {
      setTableChatBusy(false)
    }
  }

  const restart = () => {
    if (!game) return
    const oldRunId = game.runId
    const oldCharIds = vpsCharIdsOf(game)
    setError('')
    setGame(chatId, restartZhajinhua(game))
    if (oldCharIds.length) cleanupMysteryGame(oldRunId, oldCharIds).catch(() => {})
  }
  const endGame = () => {
    if (!game || !window.confirm('结束这局炸金花？进度会被清空，无法恢复。')) return
    const oldRunId = game.runId
    const oldCharIds = vpsCharIdsOf(game)
    clearGame(chatId)
    if (oldCharIds.length) cleanupMysteryGame(oldRunId, oldCharIds).catch(() => {})
  }

  // ------------------------------------------------------------ 渲染
  if (!game) {
    return (
      <PokerShell theme={theme} title="炸金花" icon="🎴" onBack={onBack}>
        <PokerSetupPanel
          theme={theme} chat={chat} sessions={sessions} globals={globals}
          ruleNote="三人局：你和两位群成员。52张牌不含大小王，每人三张，纯虚拟筹码，每局可重置。选正好 2 位群成员当 AI 对手，可以分别指定这一局用的模型。"
          onStart={(players) => setGame(chatId, createZhajinhuaGame(players))}
        />
      </PokerShell>
    )
  }

  const me = game.players[0]
  const isMyTurn = game.phase === 'betting' && game.turn === 0
  const myActions = isMyTurn ? enumerateZhajinhuaActions(game, 0) : []
  const lastEntry = game.history[game.history.length - 1]
  const settleEntry = game.phase === 'finished' ? game.history.find((h) => h.type === 'settle') : null
  const summary = game.finished ? zhajinhuaSummary(game) : null

  return (
    <PokerShell
      theme={theme} title="炸金花" icon="🎴" onBack={onBack}
      actions={(
        <><button onClick={() => setShowTableChat(true)} aria-label="打开牌桌闲聊" className="flex items-center justify-center" style={{ width: 32, height: 32, position: 'relative', borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.58)', color: '#8c6172' }}><MessageCircle size={14} />{!!game.tableChat?.length && <span style={{ position: 'absolute', right: -1, top: -2, minWidth: 13, height: 13, borderRadius: 7, background: primary, color: '#fff', fontSize: 7, display: 'grid', placeItems: 'center' }}>{Math.min(99, game.tableChat.length)}</span>}</button><button onClick={toggleMuted} aria-label={muted ? '开启游戏音乐' : '关闭游戏音乐'} className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.58)', color: '#8c6172' }}>{muted ? <VolumeX size={14} /> : <Volume2 size={14} />}</button><button onClick={endGame} aria-label="结束本局" className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,0.06)', color: '#c9647a' }}>
          <Trash2 size={14} />
        </button></>
      )}
    >
      <main className="flex-1 overflow-y-auto px-3 py-3 flex flex-col" style={{ minHeight: 0 }}>
        <div className="flex gap-2 mb-3">
          {[1, 2].map((i) => {
            const p = game.players[i]
            const thinking = aiState?.seatIndex === i
            const revealed = settleEntry?.reveal?.[i] || lastEntry?.reveal?.[i]
            return (
              <div key={i} className="flex-1 text-center rounded-2xl py-2 px-1" style={{ background: 'rgba(255,255,255,0.65)', border: game.turn === i && !game.finished ? `1.5px solid ${primary}` : '1px solid rgba(0,0,0,0.06)', opacity: p.folded ? 0.5 : 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: '#5a3548' }}>{p.name || p.memberId}</div>
                <div className="text-[10px] mt-0.5" style={{ color: '#a2798a' }}>
                  筹码 {p.chips}{p.folded ? ' · 已弃牌' : ''}
                </div>
                {revealed && (
                  <div className="flex gap-0.5 justify-center mt-1">
                    {revealed.map((c) => <PokerCard key={c.id} card={c} size="sm" />)}
                  </div>
                )}
                {thinking && <div className="text-[10px] mt-0.5" style={{ color: primaryDark }}>思考中…</div>}
              </div>
            )
          })}
        </div>

        <div className="flex-1 flex flex-col items-center justify-center rounded-3xl mb-3 px-3 py-4" style={{ minHeight: 150, background: 'radial-gradient(circle at 50% 42%, rgba(255,255,255,.9), rgba(244,222,228,.58))', border: '1px solid rgba(255,255,255,.7)' }}>
          {game.phase === 'betting' && (
            <div className="text-center w-full">
              <div style={{ fontSize: 13, fontWeight: 700, color: '#5a3548' }}>彩池 {game.pot} · 当前注额 {game.currentBet}</div>
              {lastEntry && (
                <div className="text-[10.5px] mt-1.5" style={{ color: '#a2798a' }}>
                  {describeLast(lastEntry, game)}
                </div>
              )}
              {!isMyTurn && <div className="text-[11.5px] mt-1.5" style={{ color: '#a2798a' }}>等待 {game.players[game.turn]?.name || '对方'} 行动…</div>}
            </div>
          )}
          {game.phase === 'finished' && (
            <div className="text-center flex flex-col items-center" style={{ width: '100%' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#5a3548' }}>
                🏆 {game.winner === 0 ? '你赢了这一局' : `${game.players[game.winner]?.name || '对方'} 赢了这一局`}
              </div>
              <div className="text-[11px] mt-1" style={{ color: '#a2798a' }}>{game.winReason === 'fold' ? '其他人都弃牌了' : '强制摊牌'}</div>
              <button onClick={restart} className="mt-3 inline-flex items-center gap-1.5" style={{ border: 'none', borderRadius: 16, padding: '9px 18px', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontSize: 13, fontWeight: 600 }}>
                <RotateCcw size={13} /> 再来一局
              </button>
              <PokerSummaryPanel summary={summary} sessions={sessions} onShare={onShareSummary} onDiscuss={onDiscussSummary} accent={primary} />
            </div>
          )}
        </div>

        {error && <div className="text-[11px] mb-1 text-center" style={{ color: '#c9647a' }}>{error}</div>}
      </main>

      {game.phase !== 'finished' && (
        <footer className="flex-shrink-0 px-3" style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
          <div className="flex items-center justify-center gap-2 pt-2 pb-2">
            {me.cards.map((c) => (
              <PokerCard key={c.id} card={c} faceDown={!me.hasLooked} size="lg" />
            ))}
            {!me.hasLooked && !me.folded && (
              <button onClick={userLook} className="ml-2 flex-shrink-0" style={{ border: `1px solid ${primary}55`, borderRadius: 14, padding: '8px 14px', color: primary, background: 'rgba(255,255,255,0.7)', fontSize: 12.5, fontWeight: 600 }}>
                看牌
              </button>
            )}
          </div>
          {isMyTurn && !me.folded && (
            <div className="flex gap-1.5 mb-1 flex-wrap">
              {myActions.map((a, i) => (
                <button
                  key={i}
                  onClick={() => userAct(a)}
                  className="flex-1"
                  style={{
                    minWidth: '30%', border: a.type === 'fold' ? `1px solid ${primary}55` : 'none', borderRadius: 14, padding: '10px 4px',
                    color: a.type === 'fold' ? primary : '#fff',
                    background: a.type === 'fold' ? 'rgba(255,255,255,0.7)' : `linear-gradient(135deg, ${primary}, ${primaryDark})`,
                    fontSize: 12, fontWeight: 600,
                  }}
                >
                  {actionLabel(a)}{a.type === 'compare' ? `：${game.players[a.target]?.name || ''}` : ''}
                </button>
              ))}
            </div>
          )}
        </footer>
      )}
      <PokerTableChat open={showTableChat} onClose={() => setShowTableChat(false)} messages={game.tableChat || []} players={game.players} onSend={sendTableChat} busy={tableChatBusy} accent={primary} />
    </PokerShell>
  )
}

function describeLast(entry, game) {
  if (entry.type === 'ante') return `每人底注 ${entry.amount}`
  if (entry.type === 'look') return `${game.players[entry.player]?.name || '对方'} 看了牌`
  if (entry.type === 'call') return `${game.players[entry.player]?.name || '对方'} 跟注了 ${entry.amount}${entry.auto ? '（自动托管）' : ''}`
  if (entry.type === 'raise') return `${game.players[entry.player]?.name || '对方'} 加注到了 ${entry.amount}${entry.auto ? '（自动托管）' : ''}`
  if (entry.type === 'fold') return `${game.players[entry.player]?.name || '对方'} 弃牌了${entry.auto ? '（自动托管）' : ''}`
  if (entry.type === 'compare') {
    const winnerIdx = entry.result === 'challenger' ? entry.player : entry.target
    return `${game.players[entry.player]?.name || '对方'} 向 ${game.players[entry.target]?.name || '对方'} 比牌，${game.players[winnerIdx]?.name || ''} 赢了${entry.auto ? '（自动托管）' : ''}`
  }
  return ''
}
