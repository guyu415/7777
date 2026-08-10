import { useEffect, useMemo, useState } from 'react'
import { BookHeart, Heart, HeartHandshake, MessageCircleHeart, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import DiarySection from './DiarySection'
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

      <header className="universe-home__header">
        <div className="universe-home__header-copy">
          <h1>铃兰花园</h1>
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
            <div className="universe-home__heart"><Heart size={22} strokeWidth={1.5} /></div>
            <div className="universe-home__avatar universe-home__avatar--ai">
              {aiAvatar ? <img src={aiAvatar} alt={`${aiName}的头像`} /> : <span>CC</span>}
            </div>
          </div>
          <div className="universe-home__names">你 <i>&amp;</i> {aiName} <Heart size={14} strokeWidth={1.5} /></div>
          <div className="universe-home__subname">LILY OF THE VALLEY</div>
          <p className="universe-home__vow">「更迭百千字文，无言复此一吻。」</p>
        </section>

        <section className="universe-home__days">
          <div className="universe-home__days-number">{togetherDays}</div>
          <div>
            <strong>一起的第 {togetherDays} 天</strong>
            <span>since {formatDate(startAt)} ·</span>
          </div>
          <div className="universe-home__days-heart"><Heart size={28} strokeWidth={1.25} /></div>
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
            <span><strong>日记信箱</strong><small>写给你的信</small></span>
          </button>
          <button type="button" onClick={() => onOpenCareHub?.()} className="universe-home__shortcut-wide">
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
              <div><strong>日记信箱</strong></div>
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
          color: #59656f;
          background:transparent;
        }
        .universe-home__wash { position:absolute; inset:0; z-index:-1; background:radial-gradient(circle at 22% 28%,rgba(255,231,240,.18),transparent 38%),linear-gradient(180deg,transparent 56%,rgba(239,246,244,.12)); }
        .universe-home__header { position:relative; z-index:3; flex:none; display:flex; align-items:flex-start; padding:calc(var(--safe-top) + 15px) 22px 4px; background:transparent; }
        .universe-home__header-copy { min-width:0; flex:1; }
        .universe-home__header h1 { display:inline-block; margin:0; padding:0 3px 5px; font:500 28px/1.1 'ZCOOL XiaoWei',serif; color:#4f5964; letter-spacing:.05em; transform:rotate(-1.2deg); background:linear-gradient(transparent 72%,rgba(238,174,199,.32) 72%); }
        .universe-home__header p { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:80%; margin:8px 0 0 3px; color:#8b969f; font-size:11px; }
        .universe-home__scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:10px 18px 72px; box-sizing:border-box; }
        .universe-home__portrait-card { position:relative; min-height:318px; display:flex; flex-direction:column; align-items:center; justify-content:center; overflow:visible; background:radial-gradient(ellipse at center,rgba(255,251,253,.64),rgba(255,248,251,.18) 62%,transparent 75%); }
        .universe-home__portrait-card::before { content:''; position:absolute; z-index:-1; inset:42px 8px 20px; background:rgba(255,247,251,.34); border-radius:45% 55% 50% 47% / 43% 49% 55% 57%; transform:rotate(-1deg); filter:blur(.2px); }
        .universe-home__portrait-card::after { content:''; position:absolute; left:7%; right:11%; bottom:27px; height:2px; opacity:.42; background:linear-gradient(90deg,transparent,#8fa595 16%,#efb4ca 53%,#8fa595 84%,transparent); transform:rotate(1.4deg); }
        .universe-home__orbit { position:absolute; width:128px; height:52px; top:29px; border:1.5px solid rgba(115,139,157,.38); border-bottom:0; border-radius:70% 48% 0 0; transform:rotate(3deg); }
        .universe-home__pair { position:relative; z-index:2; display:flex; align-items:center; margin-top:9px; }
        .universe-home__avatar { width:108px; height:108px; padding:5px; background:rgba(255,255,255,.8); box-shadow:0 10px 24px rgba(83,101,106,.16); box-sizing:border-box; clip-path:polygon(8% 4%,92% 1%,100% 18%,96% 87%,82% 99%,9% 96%,1% 80%,3% 15%); }
        .universe-home__avatar--user { transform:rotate(-4deg) translateY(5px); }
        .universe-home__avatar--ai { transform:rotate(4deg) translateY(-4px); }
        .universe-home__avatar img { width:100%; height:100%; object-fit:cover; clip-path:inherit; }
        .universe-home__avatar > span { width:100%; height:100%; display:grid; place-items:center; background:linear-gradient(145deg,#fff0f6,#e9e8ff); color:${primaryDark}; font-weight:700; clip-path:inherit; }
        .universe-home__heart { position:relative; z-index:3; width:46px; height:46px; margin:0 -5px; display:grid; place-items:center; color:${primary}; background:rgba(255,255,255,.78); box-shadow:0 5px 16px rgba(84,91,128,.11); border-radius:46% 54% 43% 57% / 58% 43% 57% 42%; transform:rotate(-6deg); }
        .universe-home__names { position:relative; z-index:2; display:flex; align-items:center; gap:7px; margin-top:25px; color:#525b64; font:500 24px/1.2 'ZCOOL XiaoWei',serif; letter-spacing:.025em; }
        .universe-home__names i { color:#8799aa; font-style:italic; } .universe-home__names svg{color:${primary};}
        .universe-home__subname { margin-top:8px; color:#8291a1; font:italic 10px/1.2 serif; letter-spacing:.16em; }
        .universe-home__vow { margin:14px 0 0; color:#747d84; font:13px/1.5 'ZCOOL XiaoWei',serif; }
        .universe-home__days,.universe-home__quote { position:relative; margin-top:5px; border:0; box-shadow:none; backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); }
        .universe-home__days { min-height:101px; display:flex; align-items:center; padding:12px 21px; gap:18px; box-sizing:border-box; background:rgba(255,231,240,.56); border-radius:38% 62% 44% 56% / 24% 30% 70% 76%; transform:rotate(-.7deg); }
        .universe-home__days-number { color:#7786ad; font:italic 58px/1 'Ma Shan Zheng',cursive; letter-spacing:.02em; }
        .universe-home__days strong { display:block; color:#666778; font:500 15px/1.4 'ZCOOL XiaoWei',serif; }
        .universe-home__days span { display:block; margin-top:7px; color:#a2a6b9; font:italic 11px/1.2 serif; letter-spacing:.06em; }
        .universe-home__days-heart { margin-left:auto; color:${primary}82; }
        .universe-home__quote { margin:15px 5px 0 12px; padding:15px 18px 17px; background:rgba(239,245,250,.63); border-radius:52% 48% 61% 39% / 29% 39% 61% 71%; transform:rotate(.8deg); }
        .universe-home__quote-label { display:flex; align-items:center; gap:7px; color:#97a1bd; font-size:10px; letter-spacing:.12em; }
        .universe-home__quote p { margin:10px 0 0; color:#676878; font:14px/1.65 'ZCOOL XiaoWei',serif; }
        .universe-home__quote small { display:block; margin-top:7px; color:#9ba1b4; font-size:9px; letter-spacing:.06em; }
        .universe-home__shortcuts { display:flex; flex-wrap:wrap; align-items:center; gap:8px 10px; margin:17px 3px 0; }
        .universe-home__shortcuts button { min-width:0; min-height:82px; display:flex; align-items:center; gap:11px; padding:13px 15px; text-align:left; border:0; box-shadow:0 7px 19px rgba(93,95,126,.08); color:#616c73; backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); }
        .universe-home__shortcuts button:nth-child(1){width:57%;background:rgba(255,224,237,.66);border-radius:47% 53% 42% 58% / 38% 45% 55% 62%;transform:rotate(-1.4deg)}
        .universe-home__shortcuts button:nth-child(2){width:calc(43% - 10px);background:rgba(233,232,249,.68);border-radius:57% 43% 55% 45% / 45% 39% 61% 55%;transform:translateY(8px) rotate(1.8deg)}
        .universe-home__shortcuts strong,.universe-home__shortcuts small { display:block; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .universe-home__shortcuts strong { font:500 14px/1.3 'ZCOOL XiaoWei',serif; }
        .universe-home__shortcuts small { margin-top:5px; color:#a3a8b8; font-size:9px; }
        .universe-home__shortcut-icon { flex:none; width:39px; height:39px; display:grid; place-items:center; color:#66849b; background:rgba(231,244,250,.75); border-radius:57% 43% 51% 49% / 47% 58% 42% 53%; }
        .universe-home__shortcut-icon--violet { color:#806eb1; background:rgba(237,230,250,.78); }
        .universe-home__shortcut-icon--blue { color:#638997; background:rgba(224,243,239,.78); }
        .universe-home__shortcuts .universe-home__shortcut-wide { width:88%; min-height:72px; margin:5px 0 0 8%; background:rgba(226,242,239,.68); border-radius:41% 59% 54% 46% / 45% 39% 61% 55%; transform:rotate(-.5deg); }
        .universe-home__shortcut-wide i { margin-left:auto; color:#a0a5b6; font:24px/1 sans-serif; }
        .universe-home__diary { position:fixed; inset:0; z-index:90; display:flex; align-items:flex-end; }
        .universe-home__diary-backdrop { position:absolute; inset:0; border:0; background:rgba(45,39,60,.22); backdrop-filter:blur(3px); }
        .universe-home__diary-sheet { position:relative; width:100%; height:min(78dvh,720px); display:flex; flex-direction:column; overflow:hidden; border-radius:30px 30px 0 0; background:rgba(253,250,255,.98); box-shadow:0 -18px 55px rgba(57,44,72,.22); }
        .universe-home__diary-head { display:flex; align-items:center; justify-content:space-between; padding:17px 20px 12px; border-bottom:1px solid rgba(150,150,180,.14); }
        .universe-home__diary-head strong,.universe-home__diary-head span { display:block; } .universe-home__diary-head strong{color:#656476;font-size:15px}.universe-home__diary-head span{margin-top:3px;color:#aaa7b7;font-size:10px}.universe-home__diary-head button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;background:#f1edf5;color:#8d8998}
        .universe-home__diary-body { flex:1; min-height:0; overflow:hidden; padding:10px 12px calc(12px + env(safe-area-inset-bottom)); }
        @media (max-height:740px){.universe-home__portrait-card{min-height:282px}.universe-home__avatar{width:91px;height:91px}.universe-home__names{margin-top:19px}.universe-home__scroll{padding-top:5px}}
      `}</style>
    </main>
  )
}
