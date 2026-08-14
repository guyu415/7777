import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Clock3, Gem, Grid3X3, HeartHandshake, Home, Link2, LoaderCircle, MessageCircleHeart, RefreshCw, Sparkles, X } from 'lucide-react'
import { getXinchaoDashboard, sendXinchaoInteraction } from '../services/companion'

const DRIVE_NAMES = {
  possess: '占有', monitor: '惦记', crave: '渴求', share: '分享', libido: '亲密', curiosity: '好奇',
  boredom: '无聊', social: '陪伴', duty: '责任', reflection: '反思', grieve: '难过', anger: '生气',
}

const INTERACTIONS = [
  ['companionship', '陪你待一会儿'], ['affection', '给你一个拥抱'], ['intimacy', '主动靠近你'],
  ['sharing', '想听你分享'], ['discovery', '一起发现点什么'], ['task_progress', '陪你推进一件事'],
  ['reflection', '安静听你说'], ['reconciliation', '回应一次和解'], ['loss', '陪你承受难过'], ['conflict', '让你看见这次冲突'],
]

const EVENT_NAMES = {
  conversation_heartbeat: '一次对话让潮水重新流动', conversation_event: '留下了一次互动',
  drive_feedback: '心潮收到了新的反馈', dream_recorded: '一个梦被留了下来',
  handoff_note: '收到一张交接便签', settle: '潮水完成了一次沉降',
}

const TABS = [
  ['now', '此刻', Sparkles], ['house', '小屋', Home], ['inner', '内在', Gem], ['echo', '回声', Activity],
  ['time', '时光', Clock3], ['treasure', '百宝箱', Grid3X3], ['connect', '连接', Link2],
]

function relativeTime(value) {
  const time = Date.parse(value || '')
  if (!Number.isFinite(time)) return '刚刚'
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(time))
}

function PetalWheel({ drives = [] }) {
  return (
    <div className="tide-wheel" aria-label="十二股心潮">
      <div className="tide-wheel__center" />
      {drives.map((drive, index) => {
        const angle = index * 30
        const radians = (angle - 90) * Math.PI / 180
        const radius = 126
        const length = 48 + Math.round((drive.value || 0) * 56)
        return (
          <div className="tide-wheel__item" key={drive.key}>
            <div
              className={`tide-wheel__petal tide-wheel__petal--${drive.level || 'present'}`}
              style={{ height: `${length}px`, transform: `translateX(-50%) rotate(${angle}deg) translateY(-12px)` }}
              title={`${drive.label} ${drive.percent}%`}
            />
            <span style={{ left: `${150 + Math.cos(radians) * radius}px`, top: `${150 + Math.sin(radians) * radius}px` }}>
              {DRIVE_NAMES[drive.key] || drive.key}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function NowPanel({ snapshot, onRespond }) {
  const top = snapshot.topDrives?.[0] || snapshot.drives?.[0]
  const identity = snapshot.identity || {}
  const agent = identity.agentName || '他'
  return (
    <section className="tide-card tide-card--now">
      <h2>此刻，潮水正在缓慢<br />靠近</h2>
      <PetalWheel drives={snapshot.drives || []} />
      <div className="tide-card__rule" />
      <p>轻点一片花瓣，看看它正在说什么</p>
      <div className="tide-card__response">
        <strong>12 股潮水，共用一个身体</strong>
        <button type="button" onClick={onRespond}>回应{agent === '心潮' ? '他' : agent}</button>
      </div>
      {top && <small className="tide-card__current">此刻最强烈的是：{top.label} · {top.percent}%</small>}
    </section>
  )
}

function InnerPanel({ snapshot }) {
  return (
    <section className="tide-card tide-card--panel">
      <h2>他的内在，正在这样流动</h2>
      <div className="tide-drive-list">
        {(snapshot.drives || []).map((drive) => (
          <div key={drive.key} className="tide-drive-row">
            <span>{DRIVE_NAMES[drive.key] || drive.key}</span>
            <div><i style={{ width: `${drive.percent}%` }} /></div>
            <b>{drive.percent}</b>
          </div>
        ))}
      </div>
    </section>
  )
}

function EchoPanel({ timeline }) {
  return (
    <section className="tide-card tide-card--panel">
      <h2>最近留下的回声</h2>
      <div className="tide-timeline">
        {timeline.length === 0 && <p className="tide-empty">这里还没有新的回声。</p>}
        {timeline.slice(0, 20).map((item) => (
          <article key={item.id || `${item.at}-${item.type}`}>
            <i />
            <div><strong>{item.label || EVENT_NAMES[item.type] || '心潮发生了一次变化'}</strong><span>{relativeTime(item.at)}</span></div>
          </article>
        ))}
      </div>
    </section>
  )
}

function ConnectionPanel({ snapshot }) {
  const { runtime = {}, capabilities = {} } = snapshot
  return (
    <section className="tide-card tide-card--panel tide-connect">
      <h2>连接</h2>
      <div className="tide-connect__mark"><Link2 size={30} /></div>
      <strong>{capabilities.wakeBridgeProtocol ? '主动连接桥已接入' : '可视化已接入'}</strong>
      <p>心潮数据来自你自己的服务。独立口令只保存在服务器，不会交给浏览器。</p>
      <dl>
        <div><dt>意识</dt><dd>{runtime.consciousness === 'awake' ? '清醒' : '休息中'}</dd></div>
        <div><dt>疲劳</dt><dd>{Math.round((runtime.fatigue || 0) * 100)}%</dd></div>
        <div><dt>运行模式</dt><dd>{runtime.mode === 'active' ? '主动' : runtime.mode || '—'}</dd></div>
        <div><dt>主动连接</dt><dd>{capabilities.wakeBridgeProtocol ? '在线' : '待启用'}</dd></div>
      </dl>
    </section>
  )
}

function HousePanel({ snapshot }) {
  const top = snapshot.topDrives?.[0]
  return (
    <section className="tide-card tide-card--panel tide-connect">
      <h2>心潮小屋</h2>
      <div className="tide-connect__mark"><Home size={30} /></div>
      <strong>{snapshot.identity?.agentName || '他的心潮'}正在这里</strong>
      <p>{top ? `现在最靠近水面的是“${top.label}”。` : '潮水正在安静地流动。'}</p>
      <dl>
        <div><dt>十二股心潮</dt><dd>{snapshot.drives?.length || 0} 股</dd></div>
        <div><dt>闪念</dt><dd>{snapshot.thoughts?.flashCount || 0}</dd></div>
        <div><dt>执念</dt><dd>{snapshot.thoughts?.obsessionCount || 0}</dd></div>
        <div><dt>最近更新</dt><dd>{relativeTime(snapshot.generatedAt)}</dd></div>
      </dl>
    </section>
  )
}

function TreasurePanel({ snapshot }) {
  const labels = {
    contextEnvelope: '心潮上下文', remoteMcp: '远程 MCP', externalMemoryRead: '读取外部记忆',
    externalMemoryWrite: '写入外部记忆', wakeBridgeProtocol: '主动连接桥', privateDreamText: '私密梦境文字',
  }
  return (
    <section className="tide-card tide-card--panel">
      <h2>百宝箱</h2>
      <div className="tide-capabilities">
        {Object.entries(labels).map(([key, label]) => <div key={key}><Grid3X3 size={18} /><span>{label}</span><b>{snapshot.capabilities?.[key] ? '已开启' : '未开启'}</b></div>)}
      </div>
    </section>
  )
}

export default function XinchaoDashboard({ onClose }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('now')
  const [responding, setResponding] = useState(false)
  const [sending, setSending] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await getXinchaoDashboard('claude-code')
      if (result?.available === false) throw new Error('心潮服务暂时没有回应')
      setData(result)
    } catch (err) {
      setError(err?.message || '心潮服务暂时没有回应')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  const snapshot = data?.snapshot
  const timeline = useMemo(() => data?.timeline || [], [data])

  const respond = async (type) => {
    const eventId = `eunoia-${crypto.randomUUID()}`
    setSending(type)
    try {
      const result = await sendXinchaoInteraction(type, eventId)
      setResponding(false)
      setNotice(result?.bridge?.queued ? '这份回应已进入心潮，也已通过连接桥送给他。' : '这份回应已经落进心潮。')
      await load()
      setTimeout(() => setNotice(''), 4200)
    } catch (err) {
      setNotice(err?.message || '回应没有送达，请稍后再试。')
    } finally {
      setSending('')
    }
  }

  return (
    <main className="tide-page">
      <div className="tide-page__mist" aria-hidden="true" />
      <header className="tide-head">
        <div><span>INNER TIDE</span><h1>{tab === 'now' ? '此刻' : TABS.find(([id]) => id === tab)?.[1]}</h1></div>
        <button type="button" onClick={onClose} aria-label="关闭心潮"><X size={21} /></button>
      </header>

      <div className="tide-page__body">
        {loading && !snapshot && <div className="tide-state"><LoaderCircle className="tide-spin" /><span>正在靠近心潮…</span></div>}
        {error && !snapshot && <div className="tide-state"><p>{error}</p><button onClick={load}><RefreshCw size={15} />重试</button></div>}
        {snapshot && tab === 'now' && <NowPanel snapshot={snapshot} onRespond={() => setResponding(true)} />}
        {snapshot && tab === 'house' && <HousePanel snapshot={snapshot} />}
        {snapshot && tab === 'inner' && <InnerPanel snapshot={snapshot} />}
        {snapshot && tab === 'echo' && <EchoPanel timeline={timeline} />}
        {snapshot && tab === 'time' && <EchoPanel timeline={timeline} />}
        {snapshot && tab === 'treasure' && <TreasurePanel snapshot={snapshot} />}
        {snapshot && tab === 'connect' && <ConnectionPanel snapshot={snapshot} />}
      </div>

      <nav className="tide-nav" aria-label="心潮导航">
        {TABS.map(([id, label, Icon]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><Icon size={19} /><span>{label}</span></button>)}
      </nav>

      {notice && <div className="tide-notice">{notice}</div>}
      {responding && (
        <div className="tide-sheet" role="dialog" aria-modal="true" aria-label="回应心潮">
          <button className="tide-sheet__backdrop" onClick={() => !sending && setResponding(false)} aria-label="关闭" />
          <section>
            <div className="tide-sheet__title"><div><HeartHandshake size={20} /><strong>你想怎样回应他？</strong></div><button onClick={() => setResponding(false)} disabled={!!sending}><X size={18} /></button></div>
            <div className="tide-sheet__choices">
              {INTERACTIONS.map(([type, label]) => <button key={type} onClick={() => respond(type)} disabled={!!sending}>{sending === type ? <LoaderCircle className="tide-spin" size={16} /> : <MessageCircleHeart size={16} />}{label}</button>)}
            </div>
          </section>
        </div>
      )}

      <style>{`
        .tide-page{position:relative;height:100%;display:flex;flex-direction:column;overflow:hidden;color:#555160;background:linear-gradient(150deg,#f8f2f6 0%,#eef5f9 46%,#e9e7f6 100%);isolation:isolate}.tide-page__mist{position:absolute;inset:0;z-index:-1;background:radial-gradient(circle at 78% 7%,rgba(226,178,214,.45),transparent 23%),radial-gradient(circle at 15% 70%,rgba(255,255,255,.8),transparent 31%),linear-gradient(120deg,transparent 35%,rgba(255,255,255,.4) 35.2%,transparent 35.5%)}
        .tide-head{flex:none;display:flex;align-items:flex-start;justify-content:space-between;padding:calc(var(--safe-top) + 25px) 21px 12px}.tide-head span{font:600 12px/1 monospace;letter-spacing:.22em;color:#888390}.tide-head h1{margin:17px 0 0;font:600 29px/1 'ZCOOL XiaoWei',serif;color:#24232a}.tide-head>button{width:57px;height:57px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.75);border-radius:50%;color:white;background:linear-gradient(145deg,#e6a7c9,#a58bd8);box-shadow:0 9px 22px rgba(124,102,154,.18)}
        .tide-page__body{flex:1;min-height:0;overflow:auto;padding:4px 18px 118px}.tide-card{box-sizing:border-box;border:1px solid rgba(255,255,255,.78);background:rgba(255,255,255,.67);box-shadow:0 16px 42px rgba(104,91,125,.08);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}.tide-card--now{min-height:625px;padding:8px 30px 24px}.tide-card h2{margin:0;color:#1f1e25;font:600 27px/1.42 'ZCOOL XiaoWei',serif}.tide-card--now>p{margin:22px 0 12px;color:#aaa3ae;font-size:13px}.tide-card__rule{height:1px;margin-top:3px;background:rgba(152,143,163,.13)}
        .tide-wheel{position:relative;width:300px;height:300px;margin:16px auto 12px;transform:scale(.94)}.tide-wheel__center{position:absolute;z-index:4;left:50%;top:50%;width:30px;height:30px;transform:translate(-50%,-50%);border:3px solid rgba(255,255,255,.9);border-radius:50%;background:#f7edf3;box-shadow:0 0 0 1px rgba(213,158,184,.12)}.tide-wheel__petal{position:absolute;z-index:2;bottom:50%;left:50%;width:36px;transform-origin:50% 100%;border-radius:50% 50% 42% 42%/70% 70% 30% 30%;background:linear-gradient(180deg,#e7a7bf,#d999b5);opacity:.88;box-shadow:inset 0 0 10px rgba(255,255,255,.2)}.tide-wheel__petal--quiet{background:linear-gradient(180deg,#c7c0d7,#a9a2c2);opacity:.72}.tide-wheel__petal--present{background:linear-gradient(180deg,#e4b5c8,#d6a2bb)}.tide-wheel__item span{position:absolute;z-index:5;min-width:42px;transform:translate(-50%,-50%);color:#625e69;font-size:11px;text-align:center;white-space:nowrap}
        .tide-card__response{display:flex;align-items:center;justify-content:space-between;gap:10px}.tide-card__response strong{color:#28262d;font:600 16px/1.4 'ZCOOL XiaoWei',serif}.tide-card__response button{flex:none;padding:13px 20px;border:0;border-radius:25px;color:white;background:linear-gradient(135deg,#d8a5cf,#9e89d3);box-shadow:0 8px 20px rgba(134,106,169,.2)}.tide-card__current{display:block;margin-top:17px;color:#aaa2af;font-size:10px}.tide-card--panel{min-height:610px;padding:25px 22px;border-radius:2px}.tide-card--panel h2{font-size:24px}
        .tide-drive-list{display:grid;gap:16px;margin-top:29px}.tide-drive-row{display:grid;grid-template-columns:55px 1fr 25px;align-items:center;gap:10px;color:#6b6672;font-size:12px}.tide-drive-row>div{height:8px;overflow:hidden;border-radius:8px;background:#eeeaf0}.tide-drive-row i{display:block;height:100%;border-radius:8px;background:linear-gradient(90deg,#d9afc5,#ac9bd0)}.tide-drive-row b{color:#908899;font-size:11px;font-weight:500;text-align:right}.tide-timeline{position:relative;margin-top:27px}.tide-timeline article{position:relative;display:flex;gap:14px;padding:0 0 25px 3px}.tide-timeline article:after{content:'';position:absolute;left:7px;top:14px;bottom:0;width:1px;background:#e4dce6}.tide-timeline article>i{z-index:1;width:10px;height:10px;margin-top:3px;border:3px solid #faf8fb;border-radius:50%;background:#c797b9}.tide-timeline strong,.tide-timeline span{display:block}.tide-timeline strong{color:#625d69;font-size:13px;font-weight:500}.tide-timeline span{margin-top:5px;color:#aaa3ae;font-size:10px}.tide-empty{color:#aaa3ae;font-size:13px}
        .tide-connect{text-align:center}.tide-connect__mark{width:72px;height:72px;display:grid;place-items:center;margin:55px auto 18px;border-radius:50%;color:#9b86c6;background:#eee6f3}.tide-connect>strong{display:block;color:#514c59;font:600 18px/1.4 'ZCOOL XiaoWei',serif}.tide-connect>p{max-width:280px;margin:12px auto 28px;color:#9b94a0;font-size:12px;line-height:1.7}.tide-connect dl{margin:0;text-align:left}.tide-connect dl>div{display:flex;justify-content:space-between;padding:14px 5px;border-top:1px solid #eee9ef}.tide-connect dt{color:#98909b;font-size:12px}.tide-connect dd{margin:0;color:#5f5965;font-size:12px}
        .tide-nav{position:absolute;z-index:10;left:15px;right:15px;bottom:calc(22px + env(safe-area-inset-bottom));height:94px;display:flex;align-items:center;justify-content:space-around;padding:0 8px;border:1px solid rgba(255,255,255,.86);border-radius:44px;background:rgba(255,255,255,.86);box-shadow:0 13px 34px rgba(92,77,112,.14);backdrop-filter:blur(16px)}.tide-nav button{width:45px;height:70px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;padding:0;border:0;border-radius:24px;color:#8e8794;background:transparent;font-size:10px;white-space:nowrap}.tide-nav button.active{color:#665b75;background:rgba(249,246,251,.94);box-shadow:0 5px 15px rgba(101,83,125,.1)}
        .tide-capabilities{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:32px}.tide-capabilities>div{min-height:100px;display:flex;flex-direction:column;justify-content:center;gap:8px;padding:14px;border:1px solid #eee7ef;border-radius:20px;color:#8e7e98;background:rgba(255,255,255,.7)}.tide-capabilities span{color:#625a67;font-size:12px}.tide-capabilities b{color:#a69ca9;font-size:10px;font-weight:500}
        .tide-state{min-height:450px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:#8f8793}.tide-state button{display:flex;align-items:center;gap:6px;padding:10px 16px;border:0;border-radius:18px;color:#756882;background:white}.tide-spin{animation:tide-spin 1s linear infinite}@keyframes tide-spin{to{transform:rotate(360deg)}}.tide-notice{position:absolute;z-index:30;left:32px;right:32px;bottom:130px;padding:13px 16px;border-radius:18px;color:white;background:rgba(75,66,85,.9);box-shadow:0 8px 22px rgba(52,41,64,.2);font-size:12px;line-height:1.5;text-align:center}
        .tide-sheet{position:absolute;inset:0;z-index:40;display:flex;align-items:flex-end}.tide-sheet__backdrop{position:absolute;inset:0;border:0;background:rgba(56,45,64,.27);backdrop-filter:blur(3px)}.tide-sheet>section{position:relative;width:100%;padding:20px 20px calc(24px + env(safe-area-inset-bottom));border-radius:28px 28px 0 0;background:#fbf8fc;box-shadow:0 -15px 40px rgba(66,49,75,.2)}.tide-sheet__title{display:flex;align-items:center;justify-content:space-between}.tide-sheet__title>div{display:flex;align-items:center;gap:9px;color:#655b6d}.tide-sheet__title button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;color:#8c8490;background:#eee9f0}.tide-sheet__choices{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:18px}.tide-sheet__choices button{display:flex;align-items:center;gap:8px;min-height:44px;padding:10px 12px;border:1px solid #eee6ef;border-radius:16px;color:#6f6575;background:white;font-size:12px;text-align:left}.tide-sheet__choices button:disabled{opacity:.55}
        @media(max-height:740px){.tide-card--now{min-height:565px}.tide-wheel{margin-top:0;margin-bottom:-7px;transform:scale(.82)}.tide-card h2{font-size:24px}.tide-head{padding-top:calc(var(--safe-top) + 13px)}}
      `}</style>
    </main>
  )
}
