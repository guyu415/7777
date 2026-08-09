import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, FileJson, Pause, Play, ScrollText, Send, Trash2, Upload } from 'lucide-react'
import { useStore } from '../../../store'
import { streamChat } from '../../../services/claude'
import { runMysteryTurn, getMysteryCcModels, getCodexModelStatus, cleanupMysteryGame } from '../../../services/companion'
import { resolveGroupMemberInfo, isVpsMemberId } from '../../../utils/groupMembers'
import { resolveApiMemberConfig } from '../../../utils/groupApiMember'
import { MYSTERY_SCRIPTS, getScript, getCharacter, importMysteryScript, removeCustomMysteryScript } from './scripts'
import {
  SEAT_AI, SEAT_NPC, SEAT_USER,
  createGame, currentChapter, nextActor, isChapterComplete, appendSpeech, appendVote,
  advanceChapter, tallyVotes, endings, visibleLog, buildCharacterSystemPrompt, buildTurnPrompt,
  parseVote, npcLine, npcVote,
  FREE_SPEECH_LIMIT, enterFreeDiscussion, isInFreeDiscussion, isFreeDiscussionPaused, setFreeDiscussionPaused,
  nextFreeActor, appendFreeSpeech, appendUserFreeMessage, skipFreeSpeechTurn, buildFreeSpeechPrompt,
} from './mysteryEngine'

// 顺序发言全部说完后，自由发言两条消息之间留的反应时间——不是越短越好：
// 太短会变成 AI 瞬间刷屏，太长会让讨论显得死气沉沉。见本文件"自由讨论"一节。
const FREE_SPEECH_DELAY_MS = 8000
// CC 正常实测首轮通常在 6–13 秒内返回，但也实测到过 33 秒的合法回合——
// 30 秒的卡住判定会把这种回合误杀（销毁会话重建，一次真实回复被白白丢掉，
// 还触发过清理与轮询之间的竞态）。"卡死"的真实根因（Enter 被输入框粘贴
// 防抖吞掉、消息一直没提交）已在后端 channel-server.ts 里根治：发送前留
// 250ms 消化时间 + 轮询里发现输入框还有字就补 Enter。所以这里的超时只是
// 最后的兜底，放宽到 60 秒，宁可少误杀，不指望它当第一道防线。
const CC_STALL_TIMEOUT_MS = 60000
const CC_RETRY_TIMEOUT_MS = 90000

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// 新存档直接使用 createGame 生成的 runId；正在玩的旧存档没有 runId 时，用
// startedAt 补出一个稳定且只属于这一局的 ID，避免升级后被迫清档重开。
const resolveRunId = (state, chatId) => state?.runId || `legacy-${chatId}-${state?.startedAt || 'unknown'}`

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

  const [aiState, setAiState] = useState(null) // { charId, status:'thinking'|'error', preview?, message?, free? }
  const [draft, setDraft] = useState('')
  const [voteTarget, setVoteTarget] = useState('')
  const [showCard, setShowCard] = useState(false)
  const logRef = useRef(null)
  const runningRef = useRef(new Set())
  const failedRef = useRef(new Set())
  // 自由讨论专用的调度状态——和上面按顺序发言的 runningRef/failedRef 分开，
  // 因为自由发言允许同一个角色在同一章里被多次调用，不能用"一章一次"的
  // dedupe key。freeRunningRef 保证同一时刻最多只有一个自由发言调用在飞；
  // freeTimerRef 是两条自由发言之间那 8 秒反应时间的定时器，用户一开始打字
  // 或点了暂停就会被清掉。
  const freeRunningRef = useRef(false)
  const freeTimerRef = useRef(null)
  // 当前这一次真实模型调用的"跳过就真的作废"标记——跳过按钮既会真的中断
  // 网络请求（AbortController），也会把这个 call 对象标成 abandoned；即使
  // 请求已经发出去、VPS 那边还在处理、abort 抢跑不及时，只要最终结算时看到
  // abandoned 就绝不提交结果，也不会重复消耗自由发言额度——不会有"跳过之后
  // 过一会儿又冒出一条回复"这种幽灵回复。
  const activeCallRef = useRef(null)

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
  // 按顺序发言和自由发言共用这同一条调用逻辑，只是 prompt 构造函数
  // （buildTurnPrompt / buildFreeSpeechPrompt）和调用完之后怎么提交
  // （appendSpeech+推进轮次 / appendFreeSpeech+消耗自由发言额度）不一样。
  const runCcTurnWithRecovery = async (runId, charId, seat, systemPrompt, turnPrompt, signal, onPreview) => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const attemptAbort = new AbortController()
      const forwardAbort = () => attemptAbort.abort()
      if (signal?.aborted) attemptAbort.abort()
      else signal?.addEventListener('abort', forwardAbort, { once: true })

      let stalled = false
      let empty = false
      const timeout = setTimeout(() => {
        stalled = true
        attemptAbort.abort()
      }, attempt === 0 ? CC_STALL_TIMEOUT_MS : CC_RETRY_TIMEOUT_MS)

      try {
        const text = await runMysteryTurn(
          runId,
          charId,
          seat.memberId,
          seat.model || '',
          systemPrompt,
          turnPrompt,
          attemptAbort.signal,
        )
        empty = !String(text || '').trim()
        if (!empty) return text
        throw new Error('CC 返回了空内容')
      } catch (error) {
        if (signal?.aborted) throw error

        const status = Number(error?.status || 0)
        const message = String(error?.message || '')
        const recoverable = stalled || empty || status === 409 || status >= 500
          || /busy|timeout|timed out|处理中|上一轮|空内容/i.test(message)
        if (!recoverable || attempt > 0) {
          if (stalled) throw new Error('CC 自动重连后仍没有回应，请重试')
          throw error
        }

        onPreview?.('CC 卡住了，正在自动重连…')
        // abort 只停止浏览器继续等；真正卡住的 Claude Code 进程仍可能留在原
        // tmux pane 中。cleanup 会杀掉这一名角色的隔离会话，下一次调用再按
        // systemPrompt + 完整公开记录重建，不会影响 CC 单聊或其他游戏角色。
        let cleanupError = null
        for (let cleanupAttempt = 0; cleanupAttempt < 3; cleanupAttempt += 1) {
          try {
            await cleanupMysteryGame(runId, [charId])
            cleanupError = null
            break
          } catch (cleanupFailure) {
            cleanupError = cleanupFailure
            await wait(350 * (cleanupAttempt + 1))
          }
        }
        if (cleanupError) throw cleanupError
        await wait(350)
      } finally {
        clearTimeout(timeout)
        signal?.removeEventListener('abort', forwardAbort)
      }
    }
    throw new Error('CC 没有回应')
  }

  const callCharacterModel = async (runId, charId, seat, systemPrompt, turnPrompt, signal, onPreview) => {
    if (seat.memberId === 'claude-code') {
      return runCcTurnWithRecovery(runId, charId, seat, systemPrompt, turnPrompt, signal, onPreview)
    }
    if (isVpsMemberId(seat.memberId)) {
      return await runMysteryTurn(runId, charId, seat.memberId, seat.model || '', systemPrompt, turnPrompt, signal)
    }
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
      signal,
    })) {
      if (part.text) {
        full += part.text
        onPreview?.(full)
      }
    }
    return full
  }

  const runAiTurn = async (charId, seat) => {
    const key = `${chapter.id}:${charId}`
    if (runningRef.current.has(key)) return
    runningRef.current.add(key)
    // call 是"这一次具体调用"的身份——不是用 key，因为 key 在跳过之后马上
    // 就会被清掉/复用；只有持有这个具体 call 对象引用的人，才有资格判断
    // "我是不是已经被跳过了"。跳过时 activeCallRef 会换成别的 call（或
    // null），这里判断的是"当我完成时，我还是不是 activeCallRef 指向的
    // 那一个"——只要不是了，就说明用户已经点过跳过，安静地什么都不做。
    const call = { abort: new AbortController() }
    activeCallRef.current = call
    setAiState({ charId, status: 'thinking', preview: '' })
    try {
      const cur = useStore.getState().mysteryGames?.[chatId]
      const systemPrompt = buildCharacterSystemPrompt(cur.scriptId, charId)
      const turnPrompt = buildTurnPrompt(cur, charId)
      const text = ((await callCharacterModel(resolveRunId(cur, chatId), charId, seat, systemPrompt, turnPrompt, call.abort.signal, (preview) => setAiState({ charId, status: 'thinking', preview }))) || '').trim()
      if (activeCallRef.current !== call) return // 已经被跳过，这条迟到的回复不提交
      if (!text) throw new Error('模型返回了空内容')
      commit((g) => (currentChapter(g)?.stage === 'vote'
        ? appendVote(g, charId, text, parseVote(g.scriptId, text))
        : appendSpeech(g, charId, text)))
      setAiState(null)
    } catch (e) {
      if (activeCallRef.current !== call) return // 已经被跳过——不需要再显示错误状态
      // 失败不算"这个角色选择沉默"——不推进轮次，交给用户重试或跳过。
      failedRef.current.add(key)
      setAiState({ charId, status: 'error', message: e?.message || '调用失败' })
    } finally {
      runningRef.current.delete(key)
      if (activeCallRef.current === call) activeCallRef.current = null
    }
  }

  // 自由讨论里的一次自动发言——同一个角色这一章可能被调用好几次，所以不用
  // runningRef/failedRef 那套"一章一次"的 dedupe，改用 freeRunningRef 这个
  // 单一的"当前是否有自由发言在飞"标志，天然串行（下一条要等这一条真正
  // 提交完才会被 8 秒定时器排上）。失败不弹错误 UI 挡住自动流程——安静地
  // 消耗掉这一次额度，跳到下一位，避免同一个坏掉的成员反复卡住整个自由讨论。
  const runFreeTurn = async (charId, seat) => {
    freeRunningRef.current = true
    const call = { abort: new AbortController() }
    activeCallRef.current = call
    setAiState({ charId, status: 'thinking', preview: '', free: true })
    try {
      const cur = useStore.getState().mysteryGames?.[chatId]
      const systemPrompt = buildCharacterSystemPrompt(cur.scriptId, charId)
      const turnPrompt = buildFreeSpeechPrompt(cur, charId)
      const text = ((await callCharacterModel(resolveRunId(cur, chatId), charId, seat, systemPrompt, turnPrompt, call.abort.signal, (preview) => setAiState({ charId, status: 'thinking', preview, free: true }))) || '').trim()
      if (activeCallRef.current !== call) return // 已经被跳过：不提交、不重复消耗额度
      commit((g) => (text ? appendFreeSpeech(g, charId, text) : skipFreeSpeechTurn(g, charId)))
    } catch {
      if (activeCallRef.current !== call) return
      commit((g) => skipFreeSpeechTurn(g, charId))
    } finally {
      if (activeCallRef.current === call) { activeCallRef.current = null; setAiState(null) }
      freeRunningRef.current = false
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

  // 按顺序发言全部说完、且这一章是剧情章（stage:'story'）时，不再自动进入
  // 自由讨论——用户经常还没看完前面的顺序发言，一开始自动刷自由讨论会把
  // 还没读完的内容顶上去。改成先停下来问一句，用户点了"开始自由讨论"才真的
  // 调用 enterFreeDiscussion；也可以直接跳过、进入下一章。投票/揭晓章完全
  // 不受影响，还是直接走"进入下一章"。
  const startFreeDiscussion = () => {
    commit((g) => enterFreeDiscussion(g))
  }

  // 自由讨论的自动驱动：每次日志变化（有人刚说完）、暂停状态变化、或刚进入
  // 自由讨论时，都重新算一次"接下来该谁说"，留 8 秒反应时间再真的去调用。
  // 用户开始打字（见输入框 onChange）或点了暂停，都会让这里的条件不再满足，
  // 定时器在 effect 清理时被取消——绝不会在用户打字的时候还在后台刷消息。
  useEffect(() => {
    clearTimeout(freeTimerRef.current)
    if (!game || game.finished) return
    if (!isInFreeDiscussion(game) || isFreeDiscussionPaused(game)) return
    if (freeRunningRef.current) return
    const nextCharId = nextFreeActor(game)
    if (!nextCharId) return // 大家额度都用完了，自然结束，不强求说满
    freeTimerRef.current = setTimeout(() => {
      const cur = useStore.getState().mysteryGames?.[chatId]
      if (!cur || !isInFreeDiscussion(cur) || isFreeDiscussionPaused(cur) || freeRunningRef.current) return
      runFreeTurn(nextCharId, cur.seats[nextCharId])
    }, FREE_SPEECH_DELAY_MS)
    return () => clearTimeout(freeTimerRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.log?.length, game?.freeDiscussion?.chapterId, game?.freeDiscussion?.paused])

  // ---------------------------------------------------------- 用户操作
  const submitUserTurn = () => {
    const text = draft.trim()
    if (!text || !myCharId) return
    const isMyTurn = actor?.charId === myCharId
    const cur = useStore.getState().mysteryGames?.[chatId]
    if (chapter?.stage === 'vote' && isMyTurn) {
      if (!voteTarget) return
      commit((g) => appendVote(g, myCharId, `我指认：${getCharacter(script, voteTarget)?.name}\n${text}`, voteTarget))
      setVoteTarget('')
    } else if (cur && isInFreeDiscussion(cur)) {
      // 自由讨论期间发的话：加进上下文，同时解除因为"用户在打字"而暂停的
      // 状态——发送即代表这一段插话已经结束，AI 应该带着这句话继续聊，并
      // 重新留出一段完整的反应时间（见上面那个自动驱动的 effect）。
      commit((g) => setFreeDiscussionPaused(appendUserFreeMessage(g, myCharId, text), false))
    } else {
      // 不是自己回合时也能插话，但不占轮次（markTurn:false）——
      // 真人本来就会在别人说话中间搭腔。
      commit((g) => appendSpeech(g, myCharId, text, { markTurn: isMyTurn }))
    }
    setDraft('')
  }

  // 自由讨论期间，用户一开始打字就立刻暂停后续 AI 发言和倒计时——不能在
  // 用户还在打字的时候继续刷 AI 消息。清空输入框不会自动恢复，只有真正发送
  // 或手动点"继续讨论"才会恢复，避免打到一半手滑清空又被打断的观感。
  const handleDraftChange = (value) => {
    setDraft(value)
    if (!value.trim()) return
    const cur = useStore.getState().mysteryGames?.[chatId]
    if (cur && isInFreeDiscussion(cur) && !isFreeDiscussionPaused(cur)) {
      commit((g) => setFreeDiscussionPaused(g, true))
    }
  }
  const toggleFreeDiscussionPause = () => {
    commit((g) => setFreeDiscussionPaused(g, !isFreeDiscussionPaused(g)))
  }

  const retryAi = () => {
    if (!aiState || !chapter) return
    failedRef.current.delete(`${chapter.id}:${aiState.charId}`)
    setAiState(null)
  }
  // 跳过必须真的作废当前请求——不只是让 UI 往下走。真正 abort 掉网络请求
  // （AbortController），并且把 activeCallRef 清空/换掉，这样即使 VPS 那边
  // 已经在处理、abort 没能立刻掐断，等它最终结算时也会发现自己已经不是
  // activeCallRef 指向的那个 call 了，安静地什么都不做——不会在跳过之后
  // 过一会儿又冒出一条回复，也不会占着 runningRef/freeRunningRef 的锁不放
  // （abort 让那个 await 尽快真正 reject/resolve，finally 里会立刻释放锁），
  // 不阻塞这个角色的下一次发言。
  const skipActor = () => {
    if (!actor || !chapter) return
    const skippedCharId = actor.charId
    const skippedSeat = actor.seat
    activeCallRef.current?.abort.abort()
    activeCallRef.current = null
    failedRef.current.add(`${chapter.id}:${skippedCharId}`)
    commit((g) => appendSpeech(g, skippedCharId, `（${getCharacter(script, skippedCharId)?.name}沉默着，没有说话。）`))
    setAiState(null)
    // 用户会点跳过，通常正是因为这一个 CC 隔离会话已经卡死。旧逻辑只 abort
    // 浏览器请求，却把坏掉的 tmux 会话留给下一轮继续复用，于是表现成“刚修好
    // 又突然不说话”。跳过 CC 时同时销毁这一个临时角色会话；不碰 CC 本体单聊、
    // 其他角色或其他模型。
    if (skippedSeat?.memberId === 'claude-code') {
      cleanupMysteryGame(resolveRunId(game, chatId), [skippedCharId]).catch(() => {})
    }
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
    const runId = resolveRunId(game, chatId)
    const vpsCharIds = Object.entries(game.seats)
      .filter(([, seat]) => seat.kind === SEAT_AI && isVpsMemberId(seat.memberId))
      .map(([charId]) => charId)
    clearMysteryGame(chatId)
    if (vpsCharIds.length) cleanupMysteryGame(runId, vpsCharIds).catch(() => {})
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
            <div className="text-[10px] mb-1" style={{ color: '#c79fae' }}>{getCharacter(script, aiState.charId)?.name} {aiState.free ? '正在接话…' : '正在斟酌…'}</div>
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
          <>
            {chapter?.stage === 'story' && !isInFreeDiscussion(game) && (
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <span className="text-[10.5px]" style={{ color: '#b79aa5' }}>顺序发言说完了——看完了吗？</span>
                <button
                  onClick={startFreeDiscussion}
                  className="flex-shrink-0"
                  style={{ background: 'none', border: `1px solid ${primary}55`, borderRadius: 14, color: primary, fontSize: 10.5, padding: '3px 10px' }}
                >
                  开始自由讨论
                </button>
              </div>
            )}
            {isInFreeDiscussion(game) && (
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10.5px]" style={{ color: '#b79aa5' }}>
                  {isFreeDiscussionPaused(game) ? '自由讨论已暂停' : '自由讨论中…AI 会陆续接话'}
                </span>
                <button
                  onClick={toggleFreeDiscussionPause}
                  className="flex items-center gap-1"
                  style={{ background: 'none', border: 'none', color: '#a98d99', fontSize: 10.5, textDecoration: 'underline', padding: 0 }}
                >
                  {isFreeDiscussionPaused(game) ? <><Play size={11} /> 继续讨论</> : <><Pause size={11} /> 暂停讨论</>}
                </button>
              </div>
            )}
            {isInFreeDiscussion(game) && myCharId && (
              <div className="flex items-center gap-2 mb-2">
                <input
                  value={draft}
                  onChange={(e) => handleDraftChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') submitUserTurn() }}
                  placeholder="随时插一句话（会打断 AI 自动接话）…"
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
            )}
            <button
              onClick={goNextChapter}
              className="w-full flex items-center justify-center gap-1.5"
              style={{ border: 'none', borderRadius: 18, padding: '12px', color: '#fff', background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, fontFamily: 'inherit', fontWeight: 700, fontSize: 14 }}
            >
              {game.chapterIndex >= script.chapters.length - 1 ? '落幕' : '进入下一章'} <ChevronRight size={16} />
            </button>
          </>
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
  const [scripts, setScripts] = useState(() => [...MYSTERY_SCRIPTS])
  const importFileRef = useRef(null)
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

  const importScriptFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setError('')
    if (file.size > 700 * 1024) { setError('剧本文件不能超过 700KB'); return }
    try {
      const imported = importMysteryScript(await file.text())
      setScripts([...MYSTERY_SCRIPTS])
      setScriptId(imported.id)
      setSeats({})
    } catch (e) {
      setError(e?.message || '导入失败，请检查 JSON 格式')
    }
  }

  const downloadScriptTemplate = () => {
    const source = MYSTERY_SCRIPTS[0]
    const blob = new Blob([JSON.stringify(source, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = '剧本杀导入模板.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
  }

  const removeImportedScript = (event, id) => {
    event.stopPropagation()
    if (!window.confirm('删除这个自定义剧本？其他群里正在玩的同名存档将无法继续。')) return
    removeCustomMysteryScript(id)
    const next = [...MYSTERY_SCRIPTS]
    setScripts(next)
    if (scriptId === id) { setScriptId(next[0].id); setSeats({}) }
  }

  const aiCount = Object.values(seats).filter((s) => s.kind === SEAT_AI).length
  const npcCount = script.characters.length - Object.keys(seats).length
  const allCandidates = [...vpsCandidates, ...candidates]

  return (
    <main className="flex-1 overflow-y-auto px-4 py-4" style={{ minHeight: 0 }}>
      <div className="text-[11px] mb-3" style={{ color: '#b294a1' }}>选一个本，再给每个角色安排上人。没安排的角色会由主持人代为出演（NPC），所以一个人也能开。</div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <button onClick={() => importFileRef.current?.click()} className="flex items-center justify-center gap-1.5" style={{ borderRadius: 16, padding: 10, border: '1px dashed rgba(238,185,205,.45)', background: 'rgba(255,255,255,.05)', color: '#edc7d5', fontSize: 11.5, fontWeight: 600 }}><Upload size={13} />导入 JSON</button>
        <button onClick={downloadScriptTemplate} className="flex items-center justify-center gap-1.5" style={{ borderRadius: 16, padding: 10, border: '1px solid rgba(255,255,255,.1)', background: 'rgba(255,255,255,.04)', color: '#cdb6c1', fontSize: 11.5 }}><FileJson size={13} />下载模板</button>
      </div>
      <input ref={importFileRef} type="file" accept="application/json,.json" hidden onChange={importScriptFile} />

      {scripts.map((s) => {
        const active = s.id === scriptId
        return (
          <div
            key={s.id}
            role="button"
            tabIndex={0}
            onClick={() => { setScriptId(s.id); setSeats({}) }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { setScriptId(s.id); setSeats({}) } }}
            className="w-full text-left mb-2.5"
            style={{ borderRadius: 18, padding: 14, border: active ? `1.5px solid ${primary}` : '1px solid rgba(255,255,255,0.1)', background: active ? 'rgba(255,255,255,0.11)' : 'rgba(255,255,255,0.05)' }}
          >
            <div className="flex items-center gap-2">
              <span style={{ fontSize: 20 }}>{s.icon}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#f4e9ed' }}>《{s.title}》</span>
              {s.hasCulprit && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(224,120,120,0.2)', color: '#f0b9b9' }}>有凶手</span>}
              {s.custom && <span className="text-[9.5px] px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: 'rgba(170,150,220,.18)', color: '#d8c8f1' }}><FileJson size={9} />自定义</span>}
              {s.custom && <button type="button" onClick={(event) => removeImportedScript(event, s.id)} className="ml-auto w-6 h-6 grid place-items-center rounded-full" style={{ color: '#d4a6b4', background: 'rgba(255,255,255,.06)', border: 0 }} aria-label={`删除《${s.title}》`}><Trash2 size={11} /></button>}
            </div>
            <div className="text-[11.5px] mt-1.5" style={{ color: '#d3bfc7' }}>{s.tagline}</div>
            <div className="text-[10px] mt-1" style={{ color: '#9d8a93' }}>{s.genre} · {s.seats} 角色 · {s.duration}</div>
          </div>
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
