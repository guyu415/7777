import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, ScrollText, Send, Trash2 } from 'lucide-react'
import { useStore } from '../../../store'
import { streamChat } from '../../../services/claude'
import { runMysteryTurn, getMysteryCcModels, getCodexModelStatus, cleanupMysteryGame } from '../../../services/companion'
import { resolveGroupMemberInfo, isVpsMemberId } from '../../../utils/groupMembers'
import { resolveApiMemberConfig } from '../../../utils/groupApiMember'
import { MYSTERY_SCRIPTS, getScript, getCharacter } from './scripts'
import {
  SEAT_AI, SEAT_NPC, SEAT_USER,
  createGame, currentChapter, nextActor, isChapterComplete, appendSpeech, appendVote,
  advanceChapter, tallyVotes, endings, visibleLog, buildCharacterSystemPrompt, buildTurnPrompt,
  parseVote, npcLine, npcVote,
} from './mysteryEngine'

// 剧本杀房间。
//
// 整局逻辑都在 mysteryEngine.js（纯函数），这里只做三件事：
//   1. 画出来；
//   2. 在轮到 AI 玩家时，用**群聊成员自己的那套 API 配置**发一次真实的
//      streamChat（和群聊里 api 成员发言走的是同一条路，见 groupApiMember.js）；
//   3. 把引擎返回的新状态写回 store（持久化，刷新可续玩）。
//
// 每次写状态都走 commit()：从 store 现读最新的一份再算，绝不用闭包里那份可能
// 过期的 game——AI 在思考的几秒里用户随时可能插话。

export default function MysteryGameRoom({ theme, chatId, chat, onClose }) {
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
  const game = useStore((s) => s.mysteryGames?.[chatId]) || null
  const clearMysteryGame = useStore((s) => s.clearMysteryGame)

  const [aiState, setAiState] = useState(null) // { charId, status:'thinking'|'error', preview?, message? }
  const [draft, setDraft] = useState('')
  const [voteTarget, setVoteTarget] = useState('')
  const [showCard, setShowCard] = useState(false)
  const logRef = useRef(null)
  const runningRef = useRef(new Set())
  const failedRef = useRef(new Set())

  const script = game ? getScript(game.scriptId) : null
  const chapter = game ? currentChapter(game) : null
  const actor = game && !game.finished ? nextActor(game) : null
  const myCharId = useMemo(
    () => (game ? Object.keys(game.seats).find((id) => game.seats[id].kind === SEAT_USER) || null : null),
    [game],
  )

  const commit = (fn) => {
    const store = useStore.getState()
    const cur = store.mysteryGames?.[chatId]
    if (!cur) return
    store.setMysteryGame(chatId, fn(cur))
  }

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [game?.log?.length, aiState?.preview])

  // ---------------------------------------------------------- 真实 AI 调用
  //
  // 两条真实路径，走到同一个提交点：
  //   - 'api' 类成员：和群聊里 api 成员发言完全同一条路（groupApiMember.js），
  //     用该会话自己的 apiKey/baseUrl 直接 streamChat，可以看到逐字预览。
  //   - claude-code / codex：不再是"不可选"，而是真的调用 VPS 上为这一局、
  //     这一个角色单独开的隔离线程/会话（见 companion.js 的
  //     runMysteryTurn 和后端 channel-server.ts 的"Mystery game"一节）——
  //     一次 HTTP 请求换一整段回复，没有逐字流式预览，但这是它们自己的真
  //     模型在说话，而且绝不触碰它们各自真正的单聊/群聊记忆。
  // 两条路径给的 systemPrompt/turnPrompt 完全一样（buildCharacterSystemPrompt
  // / buildTurnPrompt），只由 charId 决定，别人的秘密/真相在这两个函数里都
  // 拿不到——见 mysteryEngine.js 顶部的隔离说明。
  const runAiTurn = async (charId, seat) => {
    const key = `${chapter.id}:${charId}`
    if (runningRef.current.has(key)) return
    runningRef.current.add(key)
    setAiState({ charId, status: 'thinking', preview: '' })
    try {
      const cur = useStore.getState().mysteryGames?.[chatId]
      const systemPrompt = buildCharacterSystemPrompt(cur.scriptId, charId)
      const turnPrompt = buildTurnPrompt(cur, charId)
      let text
      if (isVpsMemberId(seat.memberId)) {
        text = await runMysteryTurn(chatId, charId, seat.memberId, seat.model || '', systemPrompt, turnPrompt)
      } else {
        const info = resolveGroupMemberInfo(seat.memberId, sessions)
        const cfg = resolveApiMemberConfig(info.session, {
          providers, selectedProviderId, apiKey: globalApiKey, apiBaseUrl: globalApiBaseUrl, model: globalModel,
        })
        if (!cfg.apiKey) {
          throw new Error(`${info.name} 没有可用的 API Key（本会话、当前供应商、全局默认都没设置）`)
        }
        let full = ''
        for await (const part of streamChat({
          apiKey: cfg.apiKey,
          apiBaseUrl: cfg.baseUrl,
          // 本局单独选的模型（见开局面板）优先于该会话平时用的模型——只对
          // 这一局这一个角色生效，从不写回会话本身的配置。
          model: seat.model || cfg.model,
          systemPrompt,
          messages: [{ role: 'user', type: 'text', content: turnPrompt }],
          workerUrl,
          useWorkerProxy,
          providerName: cfg.providerName,
          disableThinking: cfg.disableThinking,
        })) {
          if (part.text) {
            full += part.text
            setAiState({ charId, status: 'thinking', preview: full })
          }
        }
        text = full
      }
      text = (text || '').trim()
      if (!text) throw new Error('模型返回了空内容')
      commit((g) => (currentChapter(g)?.stage === 'vote'
        ? appendVote(g, charId, text, parseVote(g.scriptId, text))
        : appendSpeech(g, charId, text)))
      setAiState(null)
    } catch (e) {
      // 失败不算"这个角色选择沉默"——不推进轮次，交给用户重试或跳过。
      failedRef.current.add(key)
      setAiState({ charId, status: 'error', message: e?.message || '调用失败' })
    } finally {
      runningRef.current.delete(key)
    }
  }

  // 轮到谁就自动走谁：NPC 直接用剧本写好的台词（不消耗任何额度），
  // AI 玩家发一次真实调用，用户玩家则停下来等输入框。
  useEffect(() => {
    if (!game || game.finished || !actor || !chapter) return
    if (actor.seat.kind === SEAT_NPC) {
      commit((g) => (currentChapter(g)?.stage === 'vote'
        ? appendVote(g, actor.charId, npcLine(g, actor.charId), npcVote(g, actor.charId))
        : appendSpeech(g, actor.charId, npcLine(g, actor.charId))))
      return
    }
    if (actor.seat.kind === SEAT_AI) {
      const key = `${chapter.id}:${actor.charId}`
      if (runningRef.current.has(key) || failedRef.current.has(key)) return
      runAiTurn(actor.charId, actor.seat)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, actor?.charId, chapter?.id])

  // ---------------------------------------------------------- 用户操作
  const submitUserTurn = () => {
    const text = draft.trim()
    if (!text || !myCharId) return
    const isMyTurn = actor?.charId === myCharId
    if (chapter?.stage === 'vote' && isMyTurn) {
      if (!voteTarget) return
      commit((g) => appendVote(g, myCharId, `我指认：${getCharacter(script, voteTarget)?.name}\n${text}`, voteTarget))
      setVoteTarget('')
    } else {
      // 不是自己回合时也能插话，但不占轮次（markTurn:false）——
      // 真人本来就会在别人说话中间搭腔。
      commit((g) => appendSpeech(g, myCharId, text, { markTurn: isMyTurn }))
    }
    setDraft('')
  }

  const retryAi = () => {
    if (!aiState || !chapter) return
    failedRef.current.delete(`${chapter.id}:${aiState.charId}`)
    setAiState(null)
  }
  const skipActor = () => {
    if (!actor || !chapter) return
    failedRef.current.add(`${chapter.id}:${actor.charId}`)
    commit((g) => appendSpeech(g, actor.charId, `（${getCharacter(script, actor.charId)?.name}沉默着，没有说话。）`))
    setAiState(null)
  }
  const goNextChapter = () => {
    failedRef.current.clear()
    setAiState(null)
    commit((g) => advanceChapter(g))
  }
  // 结束本局：先清本地存档（用户立刻看到"没有进行中的游戏"），再尽力清理
  // VPS 上为 claude-code/codex 这一局单独开的隔离线程/会话——两步不互相依赖，
  // 后端清理即使失败也不影响本地存档已经清空这件事本身（不重复弹错，静默
  // 失败即可，反正同一个 gameId 不会再被用到了）。
  const endGame = () => {
    if (!game || !window.confirm('结束本局？这个群聊的剧本杀存档会被清空，无法恢复。')) return
    const vpsCharIds = Object.entries(game.seats)
      .filter(([, seat]) => seat.kind === SEAT_AI && isVpsMemberId(seat.memberId))
      .map(([charId]) => charId)
    clearMysteryGame(chatId)
    if (vpsCharIds.length) cleanupMysteryGame(chatId, vpsCharIds).catch(() => {})
  }

  // ---------------------------------------------------------- 渲染
  const shell = (body) => (
    <div className="fixed inset-0 flex justify-center" style={{ zIndex: 92, background: 'rgba(28,22,32,0.42)', backdropFilter: 'blur(8px)' }}>
      <div
        className="h-full w-full max-w-md flex flex-col overflow-hidden"
        style={{ background: 'linear-gradient(170deg, #2b2431 0%, #3a2f3c 45%, #46373f 100%)', boxShadow: '0 0 50px rgba(0,0,0,0.3)' }}
      >
        <header
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}
        >
          <button onClick={onClose} aria-label="返回群聊" className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#f0e6ea' }}>
            <ArrowLeft size={17} />
          </button>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: '#f5ecef' }}>🕯️ {script ? `《${script.title}》` : '剧本杀'}</span>
          <div className="flex items-center gap-1.5">
            {game && myCharId && (
              <button onClick={() => setShowCard(true)} aria-label="我的角色卡" className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.1)', color: '#f0e6ea' }}>
                <ScrollText size={15} />
              </button>
            )}
            {game && (
              <button onClick={endGame} aria-label="结束本局" className="flex items-center justify-center" style={{ width: 32, height: 32, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,0.08)', color: '#e0a5b0' }}>
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </header>
        {body}
      </div>
    </div>
  )

  if (!game) return shell(<SetupPanel theme={theme} chat={chat} chatId={chatId} sessions={sessions} />)

  const log = visibleLog(game, myCharId)
  const tally = game.truthRevealed ? tallyVotes(game) : null

  return shell(
    <>
      <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-[11px] flex-shrink-0" style={{ color: '#d8b6c0' }}>{chapter ? chapter.title : '已落幕'}</span>
        <span className="text-[10px] flex-1 text-right truncate" style={{ color: '#9d8a93' }}>
          {myCharId ? `我演 ${getCharacter(script, myCharId)?.name}` : '旁观视角'}
        </span>
      </div>

      <main ref={logRef} className="flex-1 overflow-y-auto px-3.5 py-3" style={{ minHeight: 0 }}>
        {log.map((e) => <LogEntry key={e.id} entry={e} script={script} game={game} sessions={sessions} primary={primary} myCharId={myCharId} />)}

        {aiState?.status === 'thinking' && (
          <div className="my-2 px-3 py-2 rounded-2xl text-[13px]" style={{ background: 'rgba(255,255,255,0.07)', color: '#e7dade', whiteSpace: 'pre-wrap' }}>
            <div className="text-[10px] mb-1" style={{ color: '#c79fae' }}>{getCharacter(script, aiState.charId)?.name} 正在斟酌…</div>
            {aiState.preview || '…'}
          </div>
        )}
        {aiState?.status === 'error' && (
          <div className="my-2 px-3 py-2 rounded-2xl text-[11.5px]" style={{ background: 'rgba(224,120,120,0.16)', color: '#f2c5c5' }}>
            {getCharacter(script, aiState.charId)?.name} 这一轮没能开口：{aiState.message}
            <div className="mt-1.5 flex gap-3">
              <button onClick={retryAi} style={{ background: 'none', border: 'none', color: '#fff', textDecoration: 'underline', fontSize: 11.5, padding: 0 }}>重试</button>
              <button onClick={skipActor} style={{ background: 'none', border: 'none', color: '#fff', textDecoration: 'underline', fontSize: 11.5, padding: 0 }}>跳过这一轮</button>
            </div>
          </div>
        )}

        {game.finished && (
          <div className="mt-3 mb-2">
            <div className="text-center text-[11px] mb-3" style={{ color: '#c79fae' }}>—— 尾声 ——</div>
            {endings(game).map((e) => (
              <div key={e.charId} className="mb-2.5 px-3 py-2.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div className="text-[11px] mb-1" style={{ color: '#e0b9c6' }}>{e.emoji} {e.name}</div>
                <div className="text-[12.5px]" style={{ color: '#ded2d6', lineHeight: 1.65 }}>{e.text}</div>
              </div>
            ))}
            {tally && (
              <div className="text-center text-[10.5px] mt-3" style={{ color: '#9d8a93' }}>
                本局指认：{tally.rows.length ? tally.rows.map((r) => `${r.name} ${r.count} 票`).join(' · ') : '无人被指认'}
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="flex-shrink-0 px-3.5" style={{ paddingBottom: 'max(10px, calc(env(safe-area-inset-bottom, 0px) + 6px))', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {game.finished ? (
          <div className="text-center text-[11.5px] py-2" style={{ color: '#c79fae' }}>本局已结束。想再来一次，点右上角结束本局后重新开本。</div>
        ) : isChapterComplete(game) ? (
          <button
            onClick={goNextChapter}
            className="w-full flex items-center justify-center gap-1.5"
            style={{ border: 'none', borderRadius: 18, padding: '12px', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontFamily: 'inherit', fontWeight: 700, fontSize: 14 }}
          >
            {game.chapterIndex >= script.chapters.length - 1 ? '落幕' : '进入下一章'} <ChevronRight size={16} />
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10.5px]" style={{ color: '#b79aa5' }}>
                {actor?.charId === myCharId ? '轮到你了' : `等 ${getCharacter(script, actor?.charId)?.name || '…'} 说话`}
              </span>
              {actor && actor.charId !== myCharId && (
                <button onClick={skipActor} style={{ background: 'none', border: 'none', color: '#a98d99', fontSize: 10.5, textDecoration: 'underline', padding: 0 }}>跳过 TA</button>
              )}
            </div>
            {chapter?.stage === 'vote' && actor?.charId === myCharId && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5">
                {script.characters.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setVoteTarget(c.id)}
                    className="flex-shrink-0 px-2.5 py-1 rounded-full text-[11px]"
                    style={{
                      background: voteTarget === c.id ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.1)',
                      color: voteTarget === c.id ? '#fff' : '#d9c6cd', border: 'none',
                    }}
                  >
                    指认{c.name}
                  </button>
                ))}
              </div>
            )}
            {myCharId ? (
              <div className="flex items-center gap-2">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitUserTurn() }}
                  placeholder={chapter?.stage === 'vote' && actor?.charId === myCharId ? '先选指认对象，再说理由…' : '以角色的身份说点什么…'}
                  style={{ flex: 1, minWidth: 0, background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 20, padding: '10px 14px', fontSize: 14, color: '#f2e9ec', outline: 'none', fontFamily: 'inherit' }}
                />
                <button
                  onClick={submitUserTurn}
                  disabled={!draft.trim()}
                  className="flex items-center justify-center flex-shrink-0"
                  style={{ width: 40, height: 40, borderRadius: '50%', border: 'none', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, color: '#fff', opacity: draft.trim() ? 1 : 0.45 }}
                >
                  <Send size={16} />
                </button>
              </div>
            ) : (
              <div className="text-center text-[11px] py-2" style={{ color: '#9d8a93' }}>你这局没有出演角色，坐着看就好。</div>
            )}
          </>
        )}
      </footer>

      {showCard && myCharId && (
        <CharacterCardModal script={script} game={game} charId={myCharId} theme={theme} onClose={() => setShowCard(false)} />
      )}
    </>,
  )
}

// ------------------------------------------------------------------ 子组件

function LogEntry({ entry, script, game, sessions, primary, myCharId }) {
  if (entry.kind === 'chapter') {
    const [title, ...rest] = entry.text.split('\n')
    return (
      <div className="my-4">
        <div className="text-center text-[12px] font-semibold mb-2" style={{ color: '#e6c3cf', letterSpacing: 1 }}>{title}</div>
        <div className="text-[12.5px] px-2" style={{ color: '#c9bcc2', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{rest.join('\n')}</div>
      </div>
    )
  }
  if (entry.kind === 'host') {
    return (
      <div className="my-2 px-3 py-2 rounded-xl text-[12px]" style={{ background: 'rgba(255,255,255,0.05)', color: '#bfb0b7', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
        {entry.text}
      </div>
    )
  }
  if (entry.kind === 'clue') {
    const mine = entry.visibility === 'private'
    return (
      <div className="my-2 px-3 py-2 rounded-xl text-[12px]" style={{ background: mine ? 'rgba(255,200,120,0.12)' : 'rgba(160,200,255,0.1)', color: mine ? '#f2d6a8' : '#c3d6ef', lineHeight: 1.7, whiteSpace: 'pre-wrap', border: mine ? '1px dashed rgba(255,200,120,0.35)' : 'none' }}>
        {mine && <span className="block text-[10px] mb-1" style={{ color: '#ffcf95' }}>只有你看得到</span>}
        {entry.text}
      </div>
    )
  }
  const c = getCharacter(script, entry.charId)
  const seat = game.seats?.[entry.charId]
  const actorName = seat?.kind === SEAT_AI && seat.memberId ? resolveGroupMemberInfo(seat.memberId, sessions).name : null
  const isMe = entry.charId === myCharId
  return (
    <div className={`flex my-2 ${isMe ? 'justify-end' : 'justify-start'}`}>
      <div style={{ maxWidth: '82%' }}>
        <div className={`text-[10px] mb-0.5 ${isMe ? 'text-right' : ''}`} style={{ color: '#b294a1' }}>
          {c?.emoji} {c?.name}
          {seat?.kind === SEAT_NPC && ' · NPC'}
          {actorName && ` · ${actorName} 饰`}
          {isMe && ' · 我'}
        </div>
        <div
          className="px-3 py-2 rounded-2xl text-[13.5px]"
          style={{
            background: isMe ? `linear-gradient(135deg, ${primary}, ${primary}bb)` : 'rgba(255,255,255,0.09)',
            color: isMe ? '#fff' : '#e8dde1',
            lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}
        >
          {entry.text}
        </div>
      </div>
    </div>
  )
}

function CharacterCardModal({ script, game, charId, theme, onClose }) {
  const c = getCharacter(script, charId)
  const clues = visibleLog(game, charId).filter((e) => e.visibility === 'private').map((e) => e.text)
  return (
    <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 96, background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full overflow-y-auto"
        style={{ maxWidth: 340, maxHeight: '80vh', background: 'linear-gradient(160deg, #3b303c, #4a3a42)', borderRadius: 22, padding: 18, border: '1px solid rgba(255,255,255,0.12)' }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#f4e9ed' }}>{c.emoji} {c.name}</div>
        <div style={{ fontSize: 11, color: '#c0a3af', marginTop: 2, marginBottom: 12 }}>{c.title}</div>
        <Section title="公开身份" body={c.publicBio} />
        <Section title="人物关系" body={c.relation} />
        <Section title="你的秘密" body={c.secret} accent />
        <Section title="你的任务" body={c.mission} accent />
        {clues.length > 0 && <Section title="只有你知道的线索" body={clues.map((t) => `· ${t}`).join('\n\n')} accent />}
        <button onClick={onClose} style={{ width: '100%', marginTop: 8, padding: 10, borderRadius: 16, border: 'none', background: `linear-gradient(135deg, ${theme?.primary || '#ff85b3'}, ${theme?.primaryDark || '#ff6b9d'})`, color: '#fff', fontSize: 13.5, fontFamily: 'inherit' }}>
          收起
        </button>
      </div>
    </div>
  )
}

function Section({ title, body, accent }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10.5, color: accent ? '#ffcf95' : '#a892a0', marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: '#e3d7dc', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{body}</div>
    </div>
  )
}

const DEFAULT_CC_MODEL = 'claude-sonnet-4-6'

// 开局面板：选本 → 选角 → （每个 AI 玩家）选这一局用哪个模型。
// 没被分到人的角色自动变 NPC，所以一个人也开得了本。
//
// AI 玩家候选现在包含三种：普通 api 会话成员、claude-code、codex——三者都
// 走同一条"这一局、这一个角色专用的隔离线程/会话"（见 companion.js 的
// runMysteryTurn 和后端 channel-server.ts），claude-code/codex 不再需要
// "不可选"这条限制。每种候选的"本局模型"来源不同：
//   - claude-code：固定几个真实存在的 Claude Code 模型 ID（GET
//     /mystery/cc-models，和 VPS 自己 /model 命令认的那份列表一致）。
//   - codex：Codex 自己的真实模型目录（GET /codex/model-status 的
//     models，同一份数据源头，Codex 页面自己切换模型用的也是它）。
//   - api 会话：该会话所属供应商在设置里配置的真实模型列表（providers 里
//     那份 models 数组），不是瞎编的。
function SetupPanel({ theme, chat, chatId, sessions }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const setMysteryGame = useStore((s) => s.setMysteryGame)
  const providers = useStore((s) => s.providers)
  const selectedProviderId = useStore((s) => s.selectedProviderId)
  const globalApiKey = useStore((s) => s.apiKey)
  const globalApiBaseUrl = useStore((s) => s.apiBaseUrl)
  const globalModel = useStore((s) => s.model)
  const [scriptId, setScriptId] = useState(MYSTERY_SCRIPTS[0].id)
  const [seats, setSeats] = useState({})
  const [error, setError] = useState('')
  const [ccModels, setCcModels] = useState([DEFAULT_CC_MODEL])
  const [codexModels, setCodexModels] = useState([])
  const script = getScript(scriptId)

  useEffect(() => {
    let cancelled = false
    getMysteryCcModels().then((models) => { if (!cancelled && models?.length) setCcModels(models) }).catch(() => {})
    getCodexModelStatus().then((data) => { if (!cancelled && data?.models?.length) setCodexModels(data.models) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const candidates = (chat?.members || []).filter((id) => !isVpsMemberId(id)).map((id) => ({ id, ...resolveGroupMemberInfo(id, sessions) }))
  const vpsCandidates = (chat?.members || []).filter(isVpsMemberId).map((id) => ({ id, ...resolveGroupMemberInfo(id, sessions) }))

  // 某个候选被选为 AI 玩家时，"本局默认模型"应该是什么——只是个初始值，
  // 用户可以在模型下拉里立刻改掉。
  const defaultModelFor = (memberId) => {
    if (memberId === 'claude-code') return ccModels[0] || DEFAULT_CC_MODEL
    if (memberId === 'codex') return codexModels[0]?.id || ''
    const info = resolveGroupMemberInfo(memberId, sessions)
    const cfg = resolveApiMemberConfig(info.session, { providers, selectedProviderId, apiKey: globalApiKey, apiBaseUrl: globalApiBaseUrl, model: globalModel })
    return cfg.model || ''
  }
  // 某个候选可选的模型列表——三种来源，见本函数上方注释。
  const modelOptionsFor = (memberId) => {
    if (memberId === 'claude-code') return ccModels.map((id) => ({ id, label: id }))
    if (memberId === 'codex') return codexModels.map((m) => ({ id: m.id, label: m.displayName || m.id }))
    const info = resolveGroupMemberInfo(memberId, sessions)
    const cfg = resolveApiMemberConfig(info.session, { providers, selectedProviderId, apiKey: globalApiKey, apiBaseUrl: globalApiBaseUrl, model: globalModel })
    const provider = providers?.find((p) => p.baseUrl === cfg.baseUrl)
    const list = provider?.models?.length ? provider.models : (cfg.model ? [cfg.model] : [])
    return list.map((id) => ({ id, label: id }))
  }

  const setSeat = (charId, value) => {
    setError('')
    setSeats((prev) => {
      const next = { ...prev }
      if (value === '') delete next[charId]
      else if (value === SEAT_USER) {
        for (const k of Object.keys(next)) if (next[k].kind === SEAT_USER) delete next[k]
        next[charId] = { kind: SEAT_USER }
      } else next[charId] = { kind: SEAT_AI, memberId: value, model: defaultModelFor(value) }
      return next
    })
  }
  const setSeatModel = (charId, model) => {
    setSeats((prev) => (prev[charId] ? { ...prev, [charId]: { ...prev[charId], model } } : prev))
  }

  const start = () => {
    try {
      setMysteryGame(chatId, createGame(scriptId, seats))
    } catch (e) {
      setError(e?.message || '开局失败')
    }
  }

  const aiCount = Object.values(seats).filter((s) => s.kind === SEAT_AI).length
  const npcCount = script.characters.length - Object.keys(seats).length
  const allCandidates = [...vpsCandidates, ...candidates]

  return (
    <main className="flex-1 overflow-y-auto px-4 py-4" style={{ minHeight: 0 }}>
      <div className="text-[11px] mb-3" style={{ color: '#b294a1' }}>选一个本，再给每个角色安排上人。没安排的角色会由主持人代为出演（NPC），所以一个人也能开。</div>

      {MYSTERY_SCRIPTS.map((s) => {
        const active = s.id === scriptId
        return (
          <button
            key={s.id}
            onClick={() => { setScriptId(s.id); setSeats({}) }}
            className="w-full text-left mb-2.5"
            style={{ borderRadius: 18, padding: 14, border: active ? `1.5px solid ${primary}` : '1px solid rgba(255,255,255,0.1)', background: active ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 20 }}>{s.icon}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f4e9ed' }}>《{s.title}》</span>
              {s.hasCulprit && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(224,120,120,0.2)', color: '#f0b9b9' }}>有凶手</span>}
            </div>
            <div className="text-[11.5px] mt-1.5" style={{ color: '#d3bfc7' }}>{s.tagline}</div>
            <div className="text-[10px] mt-1" style={{ color: '#9d8a93' }}>{s.genre} · {s.seats} 角色 · {s.duration}</div>
          </button>
        )
      })}

      <div className="text-[11px] mt-4 mb-2" style={{ color: '#e6c3cf' }}>选角</div>
      {script.characters.map((c) => {
        const seat = seats[c.id]
        const value = !seat ? '' : seat.kind === SEAT_USER ? SEAT_USER : seat.memberId
        const modelOptions = seat?.kind === SEAT_AI ? modelOptionsFor(seat.memberId) : []
        return (
          <div key={c.id} className="mb-2 px-3 py-2.5 rounded-2xl" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#f0e4e9' }}>{c.emoji} {c.name}</div>
            <div className="text-[10.5px] mt-0.5 mb-2" style={{ color: '#a892a0' }}>{c.title}</div>
            <select
              data-testid={`seat-${c.id}`}
              value={value}
              onChange={(e) => setSeat(c.id, e.target.value)}
              style={{ width: '100%', background: 'rgba(0,0,0,0.28)', color: '#f0e4e9', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }}
            >
              <option value="">交给主持人（NPC）</option>
              <option value={SEAT_USER}>我来演</option>
              {allCandidates.map((m) => <option key={m.id} value={m.id}>{m.name}（AI 玩家）</option>)}
            </select>
            {seat?.kind === SEAT_AI && (
              <select
                data-testid={`model-${c.id}`}
                value={seat.model || ''}
                onChange={(e) => setSeatModel(c.id, e.target.value)}
                disabled={!modelOptions.length}
                style={{ width: '100%', marginTop: 6, background: 'rgba(0,0,0,0.22)', color: '#d9c6cd', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '7px 10px', fontSize: 11.5, fontFamily: 'inherit', outline: 'none' }}
              >
                {modelOptions.length === 0 && <option value="">（暂时读不到这个候选的模型列表）</option>}
                {modelOptions.map((m) => <option key={m.id} value={m.id}>本局模型：{m.label}</option>)}
              </select>
            )}
          </div>
        )
      })}

      {candidates.length === 0 && vpsCandidates.length === 0 && (
        <div className="text-[10.5px] mb-2" style={{ color: '#e0a5b0' }}>这个群里还没有可当 AI 玩家的成员。你可以先自己演一个角色，其余交给主持人。</div>
      )}
      {error && <div className="text-[11px] mb-2" style={{ color: '#f0a5a5' }}>{error}</div>}

      <div className="text-[10.5px] mb-2" style={{ color: '#9d8a93' }}>当前：{aiCount} 个 AI 玩家 · {npcCount} 个 NPC</div>
      <button
        onClick={start}
        className="w-full"
        style={{ border: 'none', borderRadius: 18, padding: 13, color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontFamily: 'inherit', fontWeight: 700, fontSize: 14.5, marginBottom: 20 }}
      >
        开始这一局
      </button>
    </main>
  )
}
