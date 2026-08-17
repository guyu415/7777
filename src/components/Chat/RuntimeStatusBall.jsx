import { useEffect, useRef, useState } from 'react'
import { getCompanionStatus, switchCompanionModel, getCodexModelStatus, switchCodexModel } from '../../services/companion'
import { useStore } from '../../store'

// Exact Claude Code model IDs only — no rolling aliases. Keep this list in
// sync with MODEL_IDS in channel-server.ts on the VPS. Codex has no
// equivalent hardcoded list — its options come from the real model/list RPC
// (see channel-server.ts's codexListModels), never copied from this one.
const CC_MODEL_OPTIONS = [
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
]
const ccModelOption = (id) => CC_MODEL_OPTIONS.find(option => option.id === id)
// Only ticks while the usage card is actually open. A permanent 10s poll for
// a card nobody is looking at was pure background work on the phone — and it
// bought nothing, because the numbers behind /status only change when a turn
// ends (or when the backend is asked to go re-measure them, which it now does
// on demand — see refreshStatusIfStale in channel-server.ts). Closed, the orb
// still refreshes on the events that can actually change it: a finished turn,
// coming back to the tab, and opening the card.
const OPEN_POLL_MS = 10000

// 曾经这里有一段"如果 resets_at 已经过了当前时间，就在前端强行把用量显示成
// 0%"的逻辑——那是纯猜测：真实用量永远只有后端（statusLine / Codex 自己的
// account/rateLimits/read）知道，猜出来的 0% 在真实用量其实还没清零、或者
// 后端只是暂时没刷新的时候会直接显示错误数字。真正的修复是让后端在每轮真实
// 对话结束后都确定性地刷新一次（见 VPS 上 hook-notify.sh 新增的 statusLine
// 强制重绘），前端这里只管老老实实展示后端给的真实数字，外加一个"更新于"
// 时间戳——让用户自己判断这份数据够不够新，而不是替他们瞎猜。
//
// 后来发现"每轮对话结束刷新一次"还不够：一整晚没说话，时间戳就会变成"93 分钟
// 前"。后端因此加了按需重绘（channel-server.ts 的 refreshStatusIfStale）——但
// 那只解决"状态文件没被重写"，解决不了更硬的一层：
//
// rate_limits 里的数字**只来自真实 API 响应头**，CC 自己从不主动去问服务端。
// 重绘只是把它手里那份缓存重新吐一遍。所以没有对话发生的时候，数字不会动，
// 连 resets_at 本身都不会滚到下一个窗口（2026-08-17 实测：周窗口 03:00 重置，
// 03:10 强制重绘后仍是 76% + 一个已经过去的 resets_at）。唯一真正的"重新测
// 量"就是真的说一句话，为了看用量而去烧用量显然不划算。
//
// 于是这里区分两个时间：capturedAt 是状态文件何时被写，measuredAt 是这组数字
// 何时真的变过（后端 statusline-capture.sh 负责只在数值真的动了时才更新它）。
// 展示用后者。另外，resets_at 已经过去的那一档是**确定**过期的——这不是猜，是
// 那份数据自己在描述一个已经关闭的窗口——所以照实说"还没重新测到"，而不是像
// 早先那版被删掉的逻辑那样猜一个 0%。
function formatMeasuredAt(ms) {
  if (!ms) return ''
  const diffSec = Math.round((Date.now() - ms) / 1000)
  if (diffSec < 60) return '数字刚测到'
  if (diffSec < 3600) return `数字测于 ${Math.round(diffSec / 60)} 分钟前`
  const d = new Date(ms)
  return `数字测于 ${d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`
}

// 一档窗口的 resets_at 落在过去 = 这份数字描述的是一个已经结束的窗口，必然
// 不是当前值。返回 true 时只表示"这个数不能当真了"，不表示新值是多少。
function windowExpired(window) {
  const resetsAt = Number(window?.resets_at)
  return Number.isFinite(resetsAt) && resetsAt > 0 && resetsAt * 1000 <= Date.now()
}

function formatCredits(value) {
  if (value == null || value === '') return '—'
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(number)
}

function formatResetTime(unixSeconds) {
  if (!unixSeconds) return ''
  const d = new Date(unixSeconds * 1000)
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// 过期的那一档不参与配色：拿一个重置前的 76% 继续把球染黄，等于用旧数字冒充
// 当前状态。两档都过期就退回"还不知道"的灰，这本身就是有信息量的。
function liveUsedPercentage(window) {
  if (!window || windowExpired(window)) return null
  const pct = Number(window.used_percentage)
  return Number.isFinite(pct) ? pct : null
}

function ccBallColor(status) {
  const fh = liveUsedPercentage(status?.rate_limits?.five_hour)
  const wk = liveUsedPercentage(status?.rate_limits?.seven_day)
  if (fh == null && wk == null) return '#a0b8d0' // 等待首次响应，或两档都已过期
  const remaining = Math.min(100 - (fh ?? 0), 100 - (wk ?? 0))
  if (remaining < 20) return '#e07070'
  if (remaining < 50) return '#d4a017'
  return '#34c759'
}

function codexBallColor(status) {
  const primary = status?.usage?.primary
  const pct = (primary && !windowExpired({ resets_at: primary.resetsAt })) ? primary.usedPercent : null
  if (pct == null) return '#a0b8d0'
  if (pct >= 80) return '#e07070'
  if (pct >= 50) return '#d4a017'
  return '#34c759'
}

// Shared model/usage widget for BOTH fixed VPS chat windows (Claude Code and
// Codex) — same position (inline next to the AI name), same popup card
// style, same switch-buttons layout. Only the DATA is runtime-specific and
// never cross-used: `runtime='claude-code'` polls the real statusLine-fed
// /status endpoint and Claude Code's own fixed model list; `runtime='codex'`
// polls the real /codex/model-status endpoint (backed by Codex's own
// model/list + account/rateLimits/read RPCs) — never copies the other
// runtime's model name or usage numbers, and simply omits any usage section
// that runtime has no real data for rather than faking one.
export default function RuntimeStatusBall({ theme, isLoading, runtime }) {
  const isCodex = runtime === 'codex'
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'
  const currentSessionId = useStore(s => s.currentSessionId)
  const updateSession = useStore(s => s.updateSession)
  const savedCcModelId = useStore(s => {
    if (runtime === 'codex') return null
    const modelId = s.sessions?.find(session => session.id === s.currentSessionId)?.model
    return ccModelOption(modelId) ? modelId : null
  })

  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(null) // model id currently switching to
  const [switchError, setSwitchError] = useState(null)
  const [popupTop, setPopupTop] = useState(0)
  const panelRef = useRef(null)
  const btnRef = useRef(null)

  const refresh = async () => {
    try {
      const s = isCodex ? await getCodexModelStatus() : await getCompanionStatus()
      // Claude Code lives on the VPS, but the model choice belongs to this
      // fixed chat window too. Re-apply the last confirmed choice if the VPS
      // starts/reconnects on another model, instead of briefly presenting its
      // default (previously Sonnet 5) as the user's selection every visit.
      if (!isCodex && savedCcModelId && s?.model?.id !== savedCcModelId && !isLoading) {
        const switched = await switchCompanionModel(savedCcModelId)
        setStatus({ ...s, model: switched.model })
        return
      }
      setStatus(s)
    } catch {
      // best-effort — leave last-known status showing rather than clearing it
    }
  }

  useEffect(() => {
    const saved = ccModelOption(savedCcModelId)
    setStatus(saved ? { model: { id: saved.id, display_name: saved.label } } : null)
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, savedCcModelId])

  useEffect(() => {
    if (!open) return
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, OPEN_POLL_MS)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, runtime, savedCcModelId])

  // iOS suspends interval timers while Safari/PWA is in the background.
  // Refresh immediately when the page becomes active again instead of
  // leaving the pre-reset usage visible until the next timer happens to run.
  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refreshWhenVisible)
    return () => {
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refreshWhenVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime, savedCcModelId])

  // Refresh right when a turn actually finishes (isLoading true → false),
  // not just on the next up-to-10s poll tick — this is what makes "完成一
  // 轮对话后用量刷新" actually feel immediate rather than eventually-consistent.
  const wasLoadingRef = useRef(false)
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading) refresh()
    wasLoadingRef.current = isLoading
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading])

  // The orb's own on-page position varies with name length/avatar/menu button
  // width, so the popup can't safely anchor to it directly and still
  // guarantee it never runs off either edge of the screen — anchoring it to
  // the viewport's right edge instead (position:fixed, right:12px) does,
  // regardless of where the orb itself happens to sit. top is captured once
  // per open (the header itself doesn't scroll independently).
  const toggleOpen = () => {
    if (!open) {
      const rect = btnRef.current?.getBoundingClientRect()
      if (rect) setPopupTop(rect.bottom + 6)
      refresh()
    }
    setOpen(v => !v)
  }

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  const doSwitch = async (modelId) => {
    if (isLoading || switching) return
    setSwitching(modelId)
    setSwitchError(null)
    try {
      if (isCodex) {
        const res = await switchCodexModel(modelId)
        setStatus(s => ({ ...(s || {}), model: { id: res.model, displayName: res.displayName } }))
      } else {
        const res = await switchCompanionModel(modelId)
        setStatus(s => ({ ...(s || {}), model: res.model }))
        const confirmedId = ccModelOption(res.model?.id)?.id
        if (confirmedId) updateSession(currentSessionId, { model: confirmedId })
      }
      await refresh()
    } catch (e) {
      setSwitchError(e.message || '切换失败')
    } finally {
      setSwitching(null)
    }
  }

  const modelOptions = isCodex
    ? (status?.models || []).map(m => ({ id: m.id, label: m.displayName }))
    : CC_MODEL_OPTIONS
  const currentModelId = isCodex ? status?.model?.id : status?.model?.id
  const currentModelLabel = isCodex ? (status?.model?.displayName || '—') : (status?.model?.display_name || '—')

  const fh = !isCodex ? status?.rate_limits?.five_hour : null
  const wk = !isCodex ? status?.rate_limits?.seven_day : null
  const cw = !isCodex ? status?.context_window : null
  const codexPrimary = isCodex ? status?.usage?.primary : null
  const codexCredits = isCodex ? status?.usage?.credits : null
  // 真实的"这份数据是什么时候测到的"——CC 优先用 measuredAt（数值真的动过的
  // 那一刻），旧后端没有这个字段时退回 capturedAt；Codex 来自
  // account/rateLimits/read 的 usageCapturedAt。只用来给用户一个判断新鲜度的
  // 参考，从不用来推导/伪造任何用量数字本身。
  const measuredAt = isCodex ? status?.usageCapturedAt : (status?.measuredAt ?? status?.capturedAt)
  const fhExpired = windowExpired(fh)
  const wkExpired = windowExpired(wk)
  // Present ONLY when the backend has a real, specific reason usage can't be
  // shown (e.g. Codex not logged in) — see /codex/model-status's own
  // comment. Distinct from "usage is simply null" (still legitimately
  // waiting for the first real response), which must never be relabeled as
  // an error.
  const codexUsageUnavailable = isCodex ? status?.usageUnavailable : null

  const usageColor = isCodex ? codexBallColor(status) : ccBallColor(status)
  const isUsageWarning = usageColor === '#d4a017' || usageColor === '#e07070'

  return (
    <div
      ref={panelRef}
      style={{
        // A normal (non-absolute) inline flex item now — sits in-line right
        // after the name, in real layout flow, so it's vertically centered
        // against the name text for free via the parent row's alignItems,
        // with no manual top-offset needed. Still a 34px hit target with a
        // smaller 21px visible glyph inside it.
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 34,
        height: 34,
        flexShrink: 0,
        zIndex: 12,
      }}
    >
      <style>{`
        @keyframes vps-usage-ring-breathe {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.08); opacity: 0.85; }
        }
      `}</style>
      <button
        ref={btnRef}
        onClick={toggleOpen}
        title={isCodex ? 'Codex 用量' : 'VPS 用量'}
        style={{
          // Keep a comfortable hit target while making the visible light
          // smaller and visually lighter than the clickable area.
          width: 34,
          height: 34,
          padding: 0,
          margin: 0,
          border: 0,
          borderRadius: '50%',
          background: 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Status is carried by this ring + tight glow, not by a drop-shadow
            on the image itself (which used to visually inflate the ball
            into something bigger than intended). ~19px halo around a 16px
            ball — clearly smaller than the surrounding name text. The glow
            is two small box-shadow layers (a crisp near ring, a fainter
            wider one) rather than one big blur, so it reads as a status dot
            at a glance without turning into a neon blob. */}
        <div style={{ position: 'relative', width: 19, height: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: `1px solid ${usageColor}A6`,
            boxShadow: `0 0 2px ${usageColor}80, 0 0 4px ${usageColor}30`,
            animation: isUsageWarning ? 'vps-usage-ring-breathe 6s ease-in-out infinite' : 'none',
          }} />
          <img
            src="/assets/crystal-usage-orb.png"
            alt=""
            aria-hidden="true"
            draggable={false}
            style={{
              display: 'block',
              width: 16,
              height: 16,
              objectFit: 'contain',
              flexShrink: 0,
              opacity: 0.96,
            }}
          />
        </div>
      </button>
      {open && (
        <div
          style={{
            position: 'fixed', top: popupTop, right: 12, zIndex: 30, width: 240,
            maxWidth: 'calc(100vw - 24px)',
            background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.18)', padding: 14,
          }}
        >
          <div className="text-xs font-semibold mb-2" style={{ color: '#2c5282' }}>
            当前模型：{currentModelLabel}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {modelOptions.length === 0 && (
              <p className="text-[10px]" style={{ color: '#a0b8d0' }}>{isCodex ? '模型列表获取中，或 Codex 尚未登录' : '模型列表获取中'}</p>
            )}
            {modelOptions.map(opt => {
              const active = currentModelId === opt.id
              const busy = switching === opt.id
              return (
                <button
                  key={opt.id}
                  onClick={() => doSwitch(opt.id)}
                  disabled={isLoading || !!switching || active}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium"
                  style={{
                    background: active ? `linear-gradient(135deg, ${primary}, ${primaryDark})` : 'rgba(255,255,255,0.6)',
                    color: active ? '#fff' : '#4a7aaa',
                    border: active ? 'none' : '1px solid rgba(120,160,220,0.35)',
                    opacity: (isLoading || switching) && !active ? 0.5 : 1,
                    cursor: (isLoading || switching || active) ? 'default' : 'pointer',
                  }}
                >
                  {busy ? '切换中…' : opt.label}
                </button>
              )
            })}
          </div>
          {isLoading && <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>对话进行中，暂不能切换模型</p>}
          {switchError && <p className="text-[10px] mb-2" style={{ color: '#e07070' }}>{switchError}</p>}

          {!isCodex && (
            <>
              <div className="text-[11px] mb-1" style={{ color: '#6a90b8' }}>上下文占用</div>
              {cw?.used_percentage != null ? (
                <div style={{ height: 4, background: 'rgba(200,220,255,0.3)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${cw.used_percentage}%`, background: 'linear-gradient(90deg, #9b70e0, #c084fc)' }} />
                </div>
              ) : (
                <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>等待首次响应</p>
              )}

              <div className="text-[11px] mb-1" style={{ color: '#6a90b8' }}>5 小时用量</div>
              {fh ? (fhExpired ? (
                <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>
                  {formatResetTime(fh.resets_at)} 已重置 · 上一轮是 {Math.round(fh.used_percentage)}%，说句话才会测到新的
                </p>
              ) : (
                <p className="text-[10px] mb-2" style={{ color: '#7a9cc0' }}>
                  已用 {Math.round(fh.used_percentage)}% · 重置于 {formatResetTime(fh.resets_at)}
                </p>
              )) : (
                <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>等待首次响应</p>
              )}

              <div className="text-[11px] mb-1" style={{ color: '#6a90b8' }}>每周用量</div>
              {wk ? (wkExpired ? (
                <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>
                  {formatResetTime(wk.resets_at)} 已重置 · 上一轮是 {Math.round(wk.used_percentage)}%，说句话才会测到新的
                </p>
              ) : (
                <p className="text-[10px] mb-2" style={{ color: '#7a9cc0' }}>
                  已用 {Math.round(wk.used_percentage)}% · 重置于 {formatResetTime(wk.resets_at)}
                </p>
              )) : (
                <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>等待首次响应</p>
              )}
            </>
          )}

          {/* Codex's real usage shape is genuinely different (one rolling
              window + optional credit balance, no five-hour/weekly split, no
              context-window percentage) — rendered as its own real fields
              rather than force-fit into Claude Code's labels above. Any
              field Codex doesn't actually return is simply omitted, never
              guessed. */}
          {isCodex && (
            codexPrimary ? (
              <>
                <div className="text-[11px] mb-1" style={{ color: '#6a90b8' }}>用量窗口</div>
                {windowExpired({ resets_at: codexPrimary.resetsAt }) ? (
                  <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>
                    {formatResetTime(codexPrimary.resetsAt)} 已重置 · 上一轮是 {Math.round(codexPrimary.usedPercent)}%，说句话才会测到新的
                  </p>
                ) : (
                  <p className="text-[10px] mb-2" style={{ color: '#7a9cc0' }}>
                    已用 {Math.round(codexPrimary.usedPercent)}%{codexPrimary.resetsAt ? ` · 重置于 ${formatResetTime(codexPrimary.resetsAt)}` : ''}
                  </p>
                )}
                {codexCredits && (
                  <p className="text-[10px] mb-2" style={{ color: '#7a9cc0' }}>
                    {codexCredits.unlimited ? '额度：不限量' : (codexCredits.hasCredits ? `额度余量：${formatCredits(codexCredits.balance)}` : '无额外额度')}
                  </p>
                )}
              </>
            ) : codexUsageUnavailable ? (
              <p className="text-[10px] mb-2" style={{ color: '#e07070' }}>用量获取失败：{codexUsageUnavailable}</p>
            ) : (
              <p className="text-[10px] mb-2" style={{ color: '#a0b8d0' }}>{!status ? '等待首次响应' : '暂无用量数据'}</p>
            )
          )}
          {measuredAt && (
            <p className="text-[9.5px]" style={{ color: '#a0b8d0' }}>{formatMeasuredAt(measuredAt)}</p>
          )}
        </div>
      )}
    </div>
  )
}
