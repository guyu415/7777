import { useEffect, useMemo, useState } from 'react'
import { BookHeart, HeartHandshake, MessageCircleHeart, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import DiarySection from './DiarySection'
import { getAllLetters } from '../services/letters'
import { getXinchaoStatus, onXinchaoUpdate } from '../services/companion'

function dayNumber(timestamp) {
  if (!timestamp) return 1
  return Math.max(1, Math.floor((Date.now() - timestamp) / 86400000) + 1)
}

function formatDate(timestamp) {
  const date = new Date(timestamp || Date.now())
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

export default function UniverseHome({ theme, onOpenChat, onOpenCareHub }) {
  const {
    sessions, currentSessionId, setCurrentSessionId, setMessages,
    userAvatar: globalUserAvatar, aiAvatar: globalAiAvatar, aiName: globalAiName,
    diaryTarget, setDiaryTarget,
  } = useStore()
  const [diaryOpen, setDiaryOpen] = useState(false)
  const [xinchao, setXinchao] = useState(null)

  const ccSession = useMemo(() => (
    sessions?.find(session => session.providerName === 'claude-code-vps')
    || sessions?.find(session => session.id === currentSessionId)
    || sessions?.[0]
  ), [sessions, currentSessionId])

  useEffect(() => {
    if (diaryTarget) setDiaryOpen(true)
  }, [diaryTarget])

  useEffect(() => {
    let cancelled = false
    getXinchaoStatus('claude-code').then((state) => {
      if (!cancelled && state?.available !== false) setXinchao(state)
    }).catch(() => {})
    const unsub = onXinchaoUpdate((state, runtime) => {
      if (runtime === 'claude-code') setXinchao(state)
    })
    return () => { cancelled = true; unsub() }
  }, [])

  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#756ea8'
  const aiName = ccSession?.aiName || ccSession?.name || globalAiName || 'CC'
  const userAvatar = ccSession?.userAvatar || globalUserAvatar
  const aiAvatar = ccSession?.aiAvatar || globalAiAvatar
  const startAt = ccSession?.createdAt || Date.now()
  const togetherDays = dayNumber(startAt)
  const legacySignature = ['小满一直在这里等你～', '小满一直在这里等你~'].includes(ccSession?.signature)
  const signature = (!legacySignature && ccSession?.signature) || '还没有写下签名。'
  const mood = [xinchao?.toneLabel, xinchao?.topDrive?.shortLabel].filter(Boolean).join(' · ')

  const openCcChat = () => {
    if (ccSession?.id && ccSession.id !== currentSessionId) {
      setCurrentSessionId(ccSession.id)
      setMessages([])
    }
    onOpenChat?.()
  }

  const closeDiary = () => {
    setDiaryOpen(false)
    setDiaryTarget(null)
  }

  return (
    <main className="universe-home">
      <div className="universe-home__wash" aria-hidden="true" />
      <div className="universe-home__sparkles" aria-hidden="true">✦　·　✧　　　　　✦</div>

      <header className="universe-home__header">
        <div className="universe-home__bunny" aria-hidden="true"><img src="/assets/bunny-head-v1.png" alt="" /></div>
        <div className="universe-home__header-copy">
          <h1>铃兰花园 <span>♡</span></h1>
          <p>{signature}</p>
        </div>
      </header>

      <div className="universe-home__scroll">
        <section className="universe-home__portrait-card">
          <div className="universe-home__orbit" aria-hidden="true" />
          <div className="universe-home__pair">
            <div className="universe-home__avatar universe-home__avatar--user">
              {userAvatar ? <img src={userAvatar} alt="我的头像" /> : <span>你</span>}
            </div>
            <div className="universe-home__heart"><span>♡</span></div>
            <div className="universe-home__avatar universe-home__avatar--ai">
              {aiAvatar ? <img src={aiAvatar} alt={`${aiName}的头像`} /> : <span>CC</span>}
            </div>
          </div>
          <div className="universe-home__names">你 <i>&amp;</i> {aiName} <span>♡</span></div>
          <div className="universe-home__subname">✦ LILY OF THE VALLEY ✦</div>
          <p className="universe-home__vow">「更迭百千字文，无言复此一吻。」</p>
        </section>

        <section className="universe-home__days">
          <div className="universe-home__days-number">{togetherDays}</div>
          <div>
            <strong>一起的第 {togetherDays} 天</strong>
            <span>since {formatDate(startAt)} ·</span>
          </div>
          <div className="universe-home__days-heart">♡</div>
        </section>

        <section className="universe-home__quote">
          <div className="universe-home__quote-label"><Sparkles size={12} /> 它的心情 · 心潮</div>
          <p>{mood ? `「${mood}」` : '心潮暂时没有传来新的波纹。'}</p>
          {xinchao && <small>{xinchao.consciousnessLabel || '—'} · 疲劳 {Math.round((xinchao.fatigue || 0) * 100)}%</small>}
        </section>

        <section className="universe-home__shortcuts">
          <button onClick={openCcChat}>
            <span className="universe-home__shortcut-icon"><MessageCircleHeart size={23} /></span>
            <span><strong>一起聊天</strong><small>回到 {aiName} 身边</small></span>
          </button>
          <button onClick={() => setDiaryOpen(true)}>
            <span className="universe-home__shortcut-icon universe-home__shortcut-icon--violet"><BookHeart size={22} /></span>
            <span><strong>日记信箱</strong><small>{getAllLetters().length} 封珍藏</small></span>
          </button>
          <button onClick={onOpenCareHub} className="universe-home__shortcut-wide">
            <span className="universe-home__shortcut-icon universe-home__shortcut-icon--blue"><HeartHandshake size={22} /></span>
            <span><strong>生活关怀群</strong><small>新闻 · 记账 · 黄历 · 学习监督</small></span>
            <i>›</i>
          </button>
        </section>
      </div>

      {diaryOpen && (
        <div className="universe-home__diary" role="dialog" aria-modal="true" aria-label="日记信箱">
          <button className="universe-home__diary-backdrop" onClick={closeDiary} aria-label="关闭日记" />
          <div className="universe-home__diary-sheet">
            <div className="universe-home__diary-head">
              <div><strong>日记信箱</strong><span>{getAllLetters().length} 封珍藏</span></div>
              <button onClick={closeDiary} aria-label="关闭"><X size={18} /></button>
            </div>
            <div className="universe-home__diary-body"><DiarySection theme={theme} /></div>
          </div>
        </div>
      )}

      <style>{`
        .universe-home {
          position: relative;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          isolation: isolate;
          color: #59627a;
          background:
            linear-gradient(rgba(255,251,253,.15),rgba(255,248,252,.18)),
            url('/backgrounds/lily-garden-home-v1.webp') center top / cover no-repeat;
        }
        .universe-home__wash { position:absolute; inset:0; z-index:-1; background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,245,250,.12)); }
        .universe-home__sparkles { position:absolute; z-index:0; top:25%; left:4%; right:4%; color:${primary}72; font-size:14px; letter-spacing:2.7vw; pointer-events:none; }
        .universe-home__header { position:relative; z-index:3; flex:none; display:flex; align-items:center; gap:13px; padding:calc(var(--safe-top) + 10px) 18px 11px; background:rgba(255,255,255,.34); border-bottom:1px solid rgba(255,255,255,.68); backdrop-filter:blur(16px); -webkit-backdrop-filter:blur(16px); }
        .universe-home__bunny { flex:none; width:48px; height:48px; display:grid; place-items:center; }
        .universe-home__bunny img { width:58px; height:58px; object-fit:contain; filter:drop-shadow(0 5px 8px rgba(150,99,126,.14)); }
        .universe-home__header-copy { min-width:0; flex:1; }
        .universe-home__header h1 { margin:0; font:500 25px/1.1 'ZCOOL XiaoWei',serif; color:#535466; letter-spacing:.04em; }
        .universe-home__header h1 span { color:${primary}; }
        .universe-home__header p { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:7px 0 0; color:#9ca3b8; font-size:11px; }
        .universe-home__scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:18px 20px 36px; box-sizing:border-box; }
        .universe-home__portrait-card { position:relative; min-height:330px; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:hidden; border-radius:34px; background:linear-gradient(150deg,rgba(255,255,255,.66),rgba(255,239,247,.46)); border:1px solid rgba(255,255,255,.9); box-shadow:0 18px 50px rgba(137,105,132,.12),inset 0 1px 0 white; backdrop-filter:blur(5px); -webkit-backdrop-filter:blur(5px); }
        .universe-home__portrait-card::before,.universe-home__portrait-card::after { content:''; position:absolute; width:190px; height:100px; top:86px; opacity:.32; background:repeating-linear-gradient(90deg,transparent 0 8px,${primary} 9px 10px,transparent 11px 16px); }
        .universe-home__portrait-card::before { right:55%; transform:skewY(-16deg); }
        .universe-home__portrait-card::after { left:55%; transform:skewY(16deg); }
        .universe-home__orbit { position:absolute; width:112px; height:48px; top:27px; border:2px solid rgba(137,153,197,.48); border-bottom:0; border-radius:80px 80px 0 0; }
        .universe-home__pair { position:relative; z-index:2; display:flex; align-items:center; margin-top:20px; }
        .universe-home__avatar { width:105px; height:105px; padding:6px; border-radius:50%; background:white; border:2px dotted rgba(123,140,183,.7); box-shadow:0 9px 25px rgba(88,92,132,.16); box-sizing:border-box; }
        .universe-home__avatar img { width:100%; height:100%; object-fit:cover; border-radius:50%; }
        .universe-home__avatar > span { width:100%; height:100%; display:grid; place-items:center; border-radius:50%; background:linear-gradient(145deg,#fff0f6,#e9e8ff); color:${primaryDark}; font-weight:700; }
        .universe-home__heart { position:relative; z-index:3; width:54px; height:54px; margin:0 -7px; display:grid; place-items:center; border-radius:50%; color:${primary}; background:rgba(255,255,255,.91); border:1px solid rgba(135,146,184,.45); box-shadow:0 6px 18px rgba(84,91,128,.13); font-size:25px; }
        .universe-home__names { position:relative; z-index:2; margin-top:28px; color:#525264; font:500 25px/1.2 'ZCOOL XiaoWei',serif; letter-spacing:.025em; }
        .universe-home__names i { color:#8d98bb; font-style:italic; } .universe-home__names span{color:${primary};}
        .universe-home__subname { margin-top:9px; color:#8792b2; font:italic 12px/1.2 serif; letter-spacing:.09em; }
        .universe-home__vow { margin:15px 0 0; color:#8b8796; font:13px/1.5 'ZCOOL XiaoWei',serif; }
        .universe-home__days,.universe-home__quote { position:relative; margin-top:12px; border-radius:27px; border:1px solid rgba(255,255,255,.92); background:linear-gradient(125deg,rgba(255,255,255,.8),rgba(255,226,237,.68)); box-shadow:0 10px 28px rgba(132,102,124,.1),inset 0 1px 0 white; }
        .universe-home__days { min-height:105px; display:flex; align-items:center; padding:12px 20px; gap:18px; box-sizing:border-box; }
        .universe-home__days-number { color:#7786ad; font:italic 58px/1 'Ma Shan Zheng',cursive; letter-spacing:.02em; }
        .universe-home__days strong { display:block; color:#666778; font:500 15px/1.4 'ZCOOL XiaoWei',serif; }
        .universe-home__days span { display:block; margin-top:7px; color:#a2a6b9; font:italic 11px/1.2 serif; letter-spacing:.06em; }
        .universe-home__days-heart { margin-left:auto; color:${primary}82; font-size:34px; }
        .universe-home__quote { padding:17px 20px 18px; background:linear-gradient(135deg,rgba(247,249,255,.83),rgba(255,255,255,.68)); border-color:rgba(151,163,198,.34); }
        .universe-home__quote-label { display:flex; align-items:center; gap:7px; color:#97a1bd; font-size:10px; letter-spacing:.12em; }
        .universe-home__quote p { margin:10px 0 0; color:#676878; font:14px/1.65 'ZCOOL XiaoWei',serif; }
        .universe-home__quote small { display:block; margin-top:7px; color:#9ba1b4; font-size:9px; letter-spacing:.06em; }
        .universe-home__shortcuts { display:grid; grid-template-columns:1fr 1fr; gap:11px; margin-top:12px; }
        .universe-home__shortcuts button { min-width:0; min-height:91px; display:flex; align-items:center; gap:12px; padding:14px; text-align:left; border-radius:24px; border:1px solid rgba(154,164,194,.28); background:rgba(255,255,255,.68); box-shadow:0 8px 24px rgba(93,95,126,.08); color:#666879; }
        .universe-home__shortcuts strong,.universe-home__shortcuts small { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .universe-home__shortcuts strong { font:500 14px/1.3 'ZCOOL XiaoWei',serif; }
        .universe-home__shortcuts small { margin-top:5px; color:#a3a8b8; font-size:9px; }
        .universe-home__shortcut-icon { flex:none; width:42px; height:42px; display:grid; place-items:center; border-radius:15px; color:#6b86ad; background:linear-gradient(145deg,#edf7ff,#dceafb); box-shadow:inset 0 1px 0 white,0 6px 13px rgba(87,111,146,.14); }
        .universe-home__shortcut-icon--violet { color:#8671ba; background:linear-gradient(145deg,#f4efff,#e4ddfa); }
        .universe-home__shortcut-icon--blue { color:#658a9f; background:linear-gradient(145deg,#ecfbff,#dceef2); }
        .universe-home__shortcuts .universe-home__shortcut-wide { grid-column:1/-1; min-height:76px; }
        .universe-home__shortcut-wide i { margin-left:auto; color:#a0a5b6; font:24px/1 sans-serif; }
        .universe-home__diary { position:fixed; inset:0; z-index:90; display:flex; align-items:flex-end; }
        .universe-home__diary-backdrop { position:absolute; inset:0; border:0; background:rgba(45,39,60,.22); backdrop-filter:blur(3px); }
        .universe-home__diary-sheet { position:relative; width:100%; height:min(78dvh,720px); display:flex; flex-direction:column; overflow:hidden; border-radius:30px 30px 0 0; background:rgba(253,250,255,.98); box-shadow:0 -18px 55px rgba(57,44,72,.22); }
        .universe-home__diary-head { display:flex; align-items:center; justify-content:space-between; padding:17px 20px 12px; border-bottom:1px solid rgba(150,150,180,.14); }
        .universe-home__diary-head strong,.universe-home__diary-head span { display:block; } .universe-home__diary-head strong{color:#656476;font-size:15px}.universe-home__diary-head span{margin-top:3px;color:#aaa7b7;font-size:10px}.universe-home__diary-head button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;background:#f1edf5;color:#8d8998}
        .universe-home__diary-body { flex:1; min-height:0; overflow:hidden; padding:10px 12px calc(12px + env(safe-area-inset-bottom)); }
        @media (max-height:740px){.universe-home__portrait-card{min-height:285px}.universe-home__avatar{width:88px;height:88px}.universe-home__names{margin-top:20px}.universe-home__scroll{padding-top:12px}}
      `}</style>
    </main>
  )
}
