import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, ArrowLeft, Brain, MoonStar, RefreshCw, Sparkles, Waves } from 'lucide-react'
import { getXinchaoDashboard } from '../services/companion'

const DRIVE_COLORS = [
  '#e99bb4', '#efb0a3', '#dca4c6', '#c3a5d7', '#aaa9d9', '#91b6d2',
  '#86c1c3', '#93c8ac', '#b8c993', '#d4c584', '#ddad94', '#c997a1',
]

const DRIVE_SHORT_LABELS = {
  possess: '靠近', monitor: '惦记', crave: '依恋', share: '分享', libido: '亲密',
  curiosity: '好奇', boredom: '无聊', social: '交流', duty: '责任',
  reflection: '沉淀', grieve: '失落', anger: '不满',
}

const LEVEL_LABELS = { surging: '潮涌', rising: '渐涨', present: '在场', quiet: '静息' }
const TYPE_LABELS = {
  conversation_event: '一次相处', settle: '潮汐沉降', heartbeat: '感知到在场',
  context_envelope: '心境被读取', handoff_note: '留下了一则交接', dream: '梦境浮现',
}

function formatTime(value, withDate = true) {
  if (!value) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', withDate
    ? { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
    : { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

function runtimeLabel(runtime) {
  if (runtime?.consciousness === 'awake') return '清醒'
  if (runtime?.consciousness === 'sleeping') return '睡眠'
  return runtime?.consciousness || '未知'
}

function compactDriveLabel(drive) {
  return DRIVE_SHORT_LABELS[drive?.key] || drive?.label || drive?.key || '未知'
}

function strongestDelta(item, drivesByKey) {
  const deltas = Object.entries(item?.delta?.driveDeltas || {})
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
  if (!deltas.length) return ''
  const [key, value] = deltas[0]
  const label = compactDriveLabel(drivesByKey[key] || { key })
  return `${label}${value >= 0 ? '上扬' : '回落'}`
}

function Flower({ drives, tone }) {
  const ordered = drives?.length ? drives.slice(0, 12) : []
  return (
    <div className="xinchao-dashboard__flower-wrap">
      <svg className="xinchao-dashboard__flower" viewBox="0 0 360 360" role="img" aria-label="十二维心潮花瓣图">
        <defs>
          <radialGradient id="xinchao-heart" cx="38%" cy="32%">
            <stop offset="0" stopColor="#fff" stopOpacity=".95" />
            <stop offset=".42" stopColor="#f7d5e2" stopOpacity=".96" />
            <stop offset="1" stopColor="#b999c7" stopOpacity=".9" />
          </radialGradient>
          <filter id="xinchao-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <circle cx="180" cy="180" r="137" fill="none" stroke="rgba(144,126,164,.12)" strokeDasharray="2 8" />
        {ordered.map((drive, index) => {
          const value = Math.max(0, Math.min(1, Number(drive.value) || 0))
          const angle = index * (360 / Math.max(ordered.length, 1))
          const ry = 42 + value * 31
          const cy = 180 - (ry * .72)
          return (
            <g key={drive.key} transform={`rotate(${angle} 180 180)`} className="xinchao-dashboard__petal">
              <ellipse
                cx="180" cy={cy} rx={16 + value * 10} ry={ry}
                fill={DRIVE_COLORS[index % DRIVE_COLORS.length]}
                fillOpacity={0.35 + value * .52}
                stroke="rgba(255,255,255,.75)" strokeWidth="1"
              />
              <title>{drive.label}：{drive.percent ?? Math.round(value * 100)}%</title>
            </g>
          )
        })}
        <circle cx="180" cy="180" r="55" fill="rgba(248,229,239,.25)" filter="url(#xinchao-glow)" />
        <circle cx="180" cy="180" r="42" fill="url(#xinchao-heart)" stroke="rgba(255,255,255,.8)" strokeWidth="2" />
        <text x="180" y="176" textAnchor="middle" className="xinchao-dashboard__flower-title">心潮</text>
        <text x="180" y="196" textAnchor="middle" className="xinchao-dashboard__flower-tone">{tone || '静静流动'}</text>
      </svg>
      <div className="xinchao-dashboard__flower-note">花瓣越舒展，这份感受越靠近潮面</div>
    </div>
  )
}

function LoadingFlower() {
  return <div className="xinchao-dashboard__loading"><Waves size={30} /><span>正在听心潮的声音…</span></div>
}

export default function XinchaoDashboard({ runtime = 'claude-code', liveState, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getXinchaoDashboard(runtime)
      if (result?.available === false || !result?.snapshot) throw new Error('心潮服务暂时不可用')
      setData(result)
    } catch (err) {
      setError(err?.status === 401 ? '请先连接 VPS，再来查看心潮。' : (err?.message || '暂时没有收到心潮数据'))
    } finally {
      setLoading(false)
    }
  }, [runtime])

  useEffect(() => { load() }, [load, liveState?.updatedAt])

  const snapshot = data?.snapshot
  const summary = data?.summary || liveState
  const drives = snapshot?.drives || []
  const drivesByKey = useMemo(() => Object.fromEntries(drives.map(item => [item.key, item])), [drives])
  const tone = summary?.toneLabel || compactDriveLabel(snapshot?.topDrives?.[0])
  const dreams = snapshot?.dreams || []
  const thoughts = snapshot?.thoughts || {}
  const timeline = data?.timeline || []

  return (
    <section className="xinchao-dashboard" role="dialog" aria-modal="true" aria-label="心潮可视化">
      <div className="xinchao-dashboard__mist" aria-hidden="true" />
      <header className="xinchao-dashboard__header">
        <button type="button" onClick={onClose} aria-label="返回花园"><ArrowLeft size={19} /></button>
        <div><strong>心潮</strong><span>INNER TIDES</span></div>
        <button type="button" onClick={load} disabled={loading} aria-label="刷新心潮"><RefreshCw size={17} className={loading ? 'is-spinning' : ''} /></button>
      </header>

      <div className="xinchao-dashboard__scroll">
        {loading && !snapshot ? <LoadingFlower /> : error && !snapshot ? (
          <div className="xinchao-dashboard__empty">
            <Waves size={36} />
            <strong>这一刻没有听清</strong>
            <p>{error}</p>
            <button type="button" onClick={load}>再听一次</button>
          </div>
        ) : snapshot ? (
          <>
            <Flower drives={drives} tone={tone} />

            <div className="xinchao-dashboard__now">
              <div><Activity size={15} /><span>此刻</span><strong>{runtimeLabel(snapshot.runtime)}</strong></div>
              <i />
              <div><span>疲惫</span><strong>{Math.round((snapshot.runtime?.fatigue || 0) * 100)}%</strong></div>
              <i />
              <div><span>在场</span><strong>{snapshot.runtime?.activeSessions ?? 0} 个窗口</strong></div>
            </div>

            <section className="xinchao-dashboard__section">
              <div className="xinchao-dashboard__section-title"><Sparkles size={15} /><strong>潮面上的感受</strong><span>十二维</span></div>
              <div className="xinchao-dashboard__drives">
                {drives.map((drive, index) => (
                  <div className="xinchao-dashboard__drive" key={drive.key}>
                    <div className="xinchao-dashboard__drive-head">
                      <span><i style={{ background: DRIVE_COLORS[index % DRIVE_COLORS.length] }} />{compactDriveLabel(drive)}</span>
                      <strong>{drive.percent ?? Math.round((drive.value || 0) * 100)}%</strong>
                    </div>
                    <div className="xinchao-dashboard__bar"><i style={{ width: `${drive.percent ?? (drive.value || 0) * 100}%`, background: DRIVE_COLORS[index % DRIVE_COLORS.length] }} /></div>
                    <small>{LEVEL_LABELS[drive.level] || drive.level || '静息'}</small>
                  </div>
                ))}
              </div>
            </section>

            <div className="xinchao-dashboard__signal-grid">
              <section>
                <span className="xinchao-dashboard__signal-icon"><Brain size={18} /></span>
                <div><small>思绪星点</small><strong>{(thoughts.flashCount || 0) + (thoughts.obsessionCount || 0)}</strong><p>{thoughts.obsessionCount || 0} 个仍在盘旋</p></div>
              </section>
              <section>
                <span className="xinchao-dashboard__signal-icon xinchao-dashboard__signal-icon--moon"><MoonStar size={18} /></span>
                <div><small>梦境星云</small><strong>{dreams.length}</strong><p>{dreams.filter(item => item.hasResidue).length} 个留有余韵</p></div>
              </section>
            </div>

            {dreams.length > 0 && (
              <section className="xinchao-dashboard__section">
                <div className="xinchao-dashboard__section-title"><MoonStar size={15} /><strong>梦境星云</strong><span>默认隐去正文</span></div>
                <div className="xinchao-dashboard__dreams">
                  {dreams.slice(0, 6).map((dream, index) => (
                    <article key={dream.id || `${dream.createdAt}-${index}`}>
                      <span className={dream.hasResidue ? 'has-residue' : ''}><Sparkles size={14} /></span>
                      <div><strong>{dream.summary || dream.awareness || (dream.hasDream ? '一场没有展开正文的梦' : '朦胧的梦影')}</strong><small>{formatTime(dream.createdAt)} · {dream.hasResidue ? '留有余韵' : '轻轻散去'}</small></div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            <section className="xinchao-dashboard__section xinchao-dashboard__timeline-section">
              <div className="xinchao-dashboard__section-title"><Waves size={15} /><strong>近期潮汐</strong><span>{timeline.length} 次变化</span></div>
              {timeline.length ? (
                <div className="xinchao-dashboard__timeline">
                  {timeline.slice(0, 16).map((item, index) => (
                    <article key={item.id || `${item.at}-${index}`}>
                      <i />
                      <div><strong>{item.label || TYPE_LABELS[item.type] || item.type || '状态变化'}</strong><span>{strongestDelta(item, drivesByKey)}</span></div>
                      <time>{formatTime(item.at, false)}</time>
                    </article>
                  ))}
                </div>
              ) : <p className="xinchao-dashboard__quiet">这里还很安静，新的变化会慢慢留下痕迹。</p>}
            </section>

            <footer>更新于 {formatTime(snapshot.generatedAt)} · 数据来自心潮的脱敏 Dashboard</footer>
          </>
        ) : null}
      </div>

      <style>{`
        .xinchao-dashboard{position:fixed;inset:0;z-index:1200;width:min(100%,480px);margin:auto;display:flex;flex-direction:column;overflow:hidden;color:#5f5c70;background:linear-gradient(180deg,#fbf7fb 0%,#f4f1f8 48%,#eef3f4 100%);font-family:'Noto Sans SC','PingFang SC',sans-serif}
        .xinchao-dashboard__mist{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 12% 15%,rgba(244,189,210,.26),transparent 25%),radial-gradient(circle at 88% 30%,rgba(177,175,225,.22),transparent 26%),radial-gradient(circle at 45% 76%,rgba(164,211,203,.2),transparent 29%)}
        .xinchao-dashboard__header{position:relative;z-index:2;flex:none;display:grid;grid-template-columns:42px 1fr 42px;align-items:center;padding:calc(env(safe-area-inset-top,0px) + 10px) 14px 9px;border-bottom:1px solid rgba(120,108,145,.09);background:rgba(252,249,252,.72);backdrop-filter:blur(18px)}
        .xinchao-dashboard__header button{width:38px;height:38px;display:grid;place-items:center;border:0;border-radius:50%;color:#79738b;background:rgba(255,255,255,.68)}
        .xinchao-dashboard__header button:disabled{opacity:.5}.xinchao-dashboard__header>div{text-align:center}.xinchao-dashboard__header strong{display:block;font:500 21px/1.2 'ZCOOL XiaoWei',serif;letter-spacing:.12em;color:#625f71}.xinchao-dashboard__header span{display:block;margin-top:3px;font:8px/1 serif;letter-spacing:.28em;color:#aaa4b3}
        .xinchao-dashboard__scroll{position:relative;z-index:1;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:5px 17px calc(25px + env(safe-area-inset-bottom,0px))}
        .xinchao-dashboard__flower-wrap{padding-top:2px;text-align:center}.xinchao-dashboard__flower{display:block;width:min(100%,354px);margin:0 auto;overflow:visible}.xinchao-dashboard__petal{transform-box:view-box;transform-origin:center;transition:opacity .3s}.xinchao-dashboard__flower-title{font:500 17px 'ZCOOL XiaoWei',serif;fill:#665e72;letter-spacing:.12em}.xinchao-dashboard__flower-tone{font:9px 'Noto Sans SC',sans-serif;fill:#8e8499;letter-spacing:.08em}.xinchao-dashboard__flower-note{margin-top:-17px;color:#aaa4b2;font-size:9px;letter-spacing:.08em}
        .xinchao-dashboard__now{display:flex;align-items:center;justify-content:center;gap:12px;margin:23px 4px 18px;padding:13px 10px;border:1px solid rgba(255,255,255,.76);border-radius:19px;background:rgba(255,255,255,.45);box-shadow:0 8px 25px rgba(97,87,120,.06)}.xinchao-dashboard__now>div{display:flex;align-items:center;gap:5px;white-space:nowrap}.xinchao-dashboard__now svg{color:#a688aa}.xinchao-dashboard__now span{font-size:9px;color:#aaa3b0}.xinchao-dashboard__now strong{font-size:11px;color:#696477}.xinchao-dashboard__now>i{width:1px;height:18px;background:rgba(112,104,125,.12)}
        .xinchao-dashboard__section{margin-top:17px;padding:17px 15px;border:1px solid rgba(255,255,255,.72);border-radius:24px;background:rgba(255,255,255,.4);box-shadow:0 11px 29px rgba(87,80,110,.055)}.xinchao-dashboard__section-title{display:flex;align-items:center;gap:8px;margin-bottom:15px;color:#777083}.xinchao-dashboard__section-title svg{color:#a48eac}.xinchao-dashboard__section-title strong{font:500 14px/1.2 'ZCOOL XiaoWei',serif;letter-spacing:.05em}.xinchao-dashboard__section-title span{margin-left:auto;color:#aaa4b1;font-size:8px;letter-spacing:.08em}
        .xinchao-dashboard__drives{display:grid;grid-template-columns:1fr 1fr;gap:13px 15px}.xinchao-dashboard__drive-head{display:flex;align-items:center;justify-content:space-between}.xinchao-dashboard__drive-head span{display:flex;align-items:center;gap:6px;font-size:10px;color:#777181}.xinchao-dashboard__drive-head span i{width:7px;height:7px;border-radius:50%;box-shadow:0 0 7px currentColor}.xinchao-dashboard__drive-head strong{font-size:10px;color:#6d6876}.xinchao-dashboard__bar{height:4px;margin-top:7px;overflow:hidden;border-radius:4px;background:rgba(113,104,130,.09)}.xinchao-dashboard__bar i{display:block;height:100%;min-width:2px;border-radius:inherit;transition:width .6s ease}.xinchao-dashboard__drive small{display:block;margin-top:4px;text-align:right;color:#b0aab5;font-size:7px}
        .xinchao-dashboard__signal-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:15px}.xinchao-dashboard__signal-grid section{display:flex;align-items:center;gap:11px;padding:14px;border:1px solid rgba(255,255,255,.65);border-radius:21px;background:rgba(244,230,240,.5)}.xinchao-dashboard__signal-grid section+section{background:rgba(232,232,247,.54)}.xinchao-dashboard__signal-icon{flex:none;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;color:#a36f91;background:rgba(255,255,255,.62)}.xinchao-dashboard__signal-icon--moon{color:#7c78a9}.xinchao-dashboard__signal-grid small,.xinchao-dashboard__signal-grid strong,.xinchao-dashboard__signal-grid p{display:block;margin:0}.xinchao-dashboard__signal-grid small{font-size:8px;color:#9e98a5}.xinchao-dashboard__signal-grid strong{margin-top:2px;font:500 22px/1 'ZCOOL XiaoWei',serif;color:#6c6675}.xinchao-dashboard__signal-grid p{margin-top:3px;font-size:7px;color:#aaa4b0}
        .xinchao-dashboard__dreams{display:flex;gap:9px;overflow-x:auto;padding:2px 1px 5px;scrollbar-width:none}.xinchao-dashboard__dreams article{flex:0 0 76%;min-height:65px;display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:17px;background:rgba(235,233,249,.5)}.xinchao-dashboard__dreams article>span{flex:none;width:31px;height:31px;display:grid;place-items:center;border-radius:50%;color:#9d99b8;background:rgba(255,255,255,.6)}.xinchao-dashboard__dreams article>span.has-residue{color:#9a71a1;box-shadow:0 0 15px rgba(190,142,193,.22)}.xinchao-dashboard__dreams strong{display:-webkit-box;overflow:hidden;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-size:10px;line-height:1.5;color:#716b79;font-weight:500}.xinchao-dashboard__dreams small{display:block;margin-top:5px;color:#aaa4b1;font-size:7px}
        .xinchao-dashboard__timeline-section{margin-bottom:14px}.xinchao-dashboard__timeline article{position:relative;display:grid;grid-template-columns:13px 1fr auto;gap:8px;align-items:start;min-height:42px}.xinchao-dashboard__timeline article>i{position:relative;width:7px;height:7px;margin-top:4px;border:2px solid rgba(159,135,169,.55);border-radius:50%;background:#f8f5fa}.xinchao-dashboard__timeline article:not(:last-child)>i:after{content:'';position:absolute;top:8px;left:2px;width:1px;height:34px;background:rgba(151,138,162,.17)}.xinchao-dashboard__timeline strong{display:block;font-size:10px;color:#716b79}.xinchao-dashboard__timeline span{display:block;margin-top:3px;font-size:8px;color:#a49daa}.xinchao-dashboard__timeline time{font-size:8px;color:#afa9b4}.xinchao-dashboard__quiet{margin:2px 0;color:#a9a3af;font-size:9px;line-height:1.6}.xinchao-dashboard footer{padding:4px 0 8px;text-align:center;color:#b3aeb8;font-size:8px;letter-spacing:.04em}
        .xinchao-dashboard__loading,.xinchao-dashboard__empty{min-height:70vh;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#9b8ba5}.xinchao-dashboard__loading{gap:13px;font-size:11px}.xinchao-dashboard__loading svg{animation:xinchao-float 2s ease-in-out infinite}.xinchao-dashboard__empty strong{margin-top:14px;font:500 17px 'ZCOOL XiaoWei',serif}.xinchao-dashboard__empty p{margin:8px 20px 17px;color:#aaa3af;font-size:10px}.xinchao-dashboard__empty button{padding:9px 17px;border:0;border-radius:16px;color:#766a7d;background:rgba(255,255,255,.75);font-size:10px}.is-spinning{animation:xinchao-spin .8s linear infinite}
        @keyframes xinchao-spin{to{transform:rotate(360deg)}}@keyframes xinchao-float{50%{transform:translateY(-7px)}}
        @media (prefers-reduced-motion:reduce){.xinchao-dashboard *{animation:none!important;transition:none!important}}
        @media (max-width:360px){.xinchao-dashboard__scroll{padding-left:12px;padding-right:12px}.xinchao-dashboard__now{gap:7px}.xinchao-dashboard__drives{gap:12px 10px}}
      `}</style>
    </section>
  )
}
