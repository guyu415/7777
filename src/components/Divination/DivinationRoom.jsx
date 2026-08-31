import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, History, RotateCcw, Sparkles } from 'lucide-react'
import { useStore } from '../../store'
import { DIVINATION_DECKS, formatDivinationPrompt, getDeck } from './divinationDecks'
import { listFortuneSessions, rollFortune, tarotCardImageUrl } from '../../services/divination'

const PIPS = {
  1: [[1,1]],
  2: [[0,0],[2,2]],
  3: [[0,0],[1,1],[2,2]],
  4: [[0,0],[2,0],[0,2],[2,2]],
  5: [[0,0],[2,0],[1,1],[0,2],[2,2]],
  6: [[0,0],[1,0],[2,0],[0,2],[1,2],[2,2]],
}

function Die({ value, rolling }) {
  return <div className={`fortune-die${rolling ? ' rolling' : ''}`}>
    {value ? PIPS[value]?.map(([x,y],i)=><i key={i} style={{left:10+x*18,top:10+y*18}}/>) : <b>?</b>}
  </div>
}

function DiceStage({ values, rolling }) {
  return <div className="fortune-stage">
    <div className="fortune-dicerow">{[0,1,2].map(i=><Die key={i} value={values?.[i]} rolling={rolling}/>)}</div>
    {!rolling && values?.length === 3 && <div className="fortune-lock">落 地 即 锁 · 一 事 一 卦</div>}
  </div>
}

function Coin({ back, animate }) {
  return <span className={`fortune-coin ${back ? 'back' : 'zi'}${animate ? ' flip' : ''}`}>
    <span className="fortune-hole"/>
    {!back && <span className="fortune-ins"><i>元</i><i>亨</i><i>利</i><i>貞</i></span>}
  </span>
}

function YaoMark({ yao }) {
  const n = Number(yao)
  const yin = n === 6 || n === 8
  return <span className="fortune-yao-mark">
    <span className={yin ? 'fortune-yin' : 'fortune-yang'}>{yin ? <><i/><i/></> : <i/>}</span>
    {n === 9 && <b>○ 动</b>}{n === 6 && <b>× 动</b>}
  </span>
}

function CoinStage({ tosses, yaos, rolling }) {
  const [visible, setVisible] = useState(rolling ? 0 : tosses?.length || 0)
  useEffect(() => {
    if (rolling || !tosses?.length) { setVisible(0); return undefined }
    setVisible(0)
    let shown = 0
    const timer = setInterval(() => {
      shown += 1
      setVisible(shown)
      if (shown >= tosses.length) clearInterval(timer)
    }, 330)
    return () => clearInterval(timer)
  }, [tosses, rolling])

  if (rolling) return <div className="fortune-stage"><div className="fortune-coin-wait">{[0,1,2].map(i=><Coin key={i} back={i%2===0} animate/>)}</div><div className="fortune-lock">三 钱 落 案 · 六 爻 成 卦</div></div>
  if (!tosses?.length) return null
  const labels = ['初','二','三','四','五','上']
  const rows = tosses.map((backs,index)=>({ backs, yao:yaos?.[index], index, label:labels[index] })).reverse()
  return <div className="fortune-stage"><div className="fortune-coincol">
    {rows.map(row => {
      const shown = visible > row.index
      return <div key={row.index} className={`fortune-tossrow${shown ? ' show' : ''}`}>
        <span className="fortune-yname">{row.label}</span>
        <span className="fortune-coins">{[0,1,2].map(c=><Coin key={c} back={c<row.backs} animate={shown}/>)}</span>
        <YaoMark yao={row.yao}/>
      </div>
    })}
  </div><div className="fortune-lock">六 爻 已 成 · 落 地 即 锁</div></div>
}

function TarotCard({ card, index, count, primary }) {
  const [revealed, setRevealed] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), 320 + index * 170)
    return () => clearTimeout(timer)
  }, [index, card?.id])
  const src = tarotCardImageUrl('', card.id)
  const width = count === 1 ? 176 : count === 10 ? 92 : 124
  const height = Math.round(width * 1.62)
  return <div style={{width,flex:`0 0 ${width}px`,textAlign:'center'}}>
    <div className={`fortune-tcard${revealed ? ' flip' : ''}`} style={{width,height}}>
      <div className="fortune-tc-inner">
        <div className="fortune-tc-back"><span>✦</span></div>
        <div className="fortune-tc-face" style={{borderColor:`${primary}55`}}>
          {!failed && src ? <img src={src} alt={`${card.name}${card.reversed?'逆位':'正位'}`} onError={()=>setFailed(true)} style={{transform:card.reversed?'rotate(180deg)':'none'}}/> : <div className="fortune-card-fallback"><b>{card.name}</b><small>{card.reversed?'逆位':'正位'}</small></div>}
          {card.reversed && <em>逆</em>}
        </div>
      </div>
    </div>
    <div style={{fontSize:10,color:'#967a86',marginTop:7}}>{card.position}</div>
    <div style={{fontSize:12.5,fontWeight:800,color:'#4d3340',marginTop:2}}>{card.name}</div>
    <div style={{fontSize:10.5,color:card.reversed?'#9666a6':'#6d917a',marginTop:2}}>{card.reversed?'逆位':'正位'}</div>
  </div>
}

function TarotStage({ cards, count, primary, waiting }) {
  const placeholders = useMemo(() => Array.from({length:count || 3},(_,i)=>({ id:`wait-${i}`, name:'', position:'', reversed:false })), [count])
  const list = waiting ? placeholders : cards || []
  if (!list.length) return null
  return <div className="fortune-stage"><div className={`fortune-spread${count===10?' celtic':''}`}>
    {list.map((card,index)=> waiting ? <div key={card.id} className="fortune-tcard waiting" style={{width:count===1?176:count===10?92:124,height:Math.round((count===1?176:count===10?92:124)*1.62)}}><div className="fortune-tc-back"><span>✦</span></div></div> : <TarotCard key={`${card.id}-${card.position}`} card={card} index={index} count={cards.length} primary={primary}/>) }
  </div>{waiting && <div className="fortune-lock">洗 牌 · 落 位 · 翻 面</div>}</div>
}

export default function DivinationRoom({ theme, onClose, onInterpret }) {
  const primary = theme?.primary || '#ff85b3'
  const workerUrl = useStore(s => s.workerUrl)
  const [tab,setTab] = useState('formal')
  const [method,setMethod] = useState('xiaoliuren')
  const [question,setQuestion] = useState('')
  const [count,setCount] = useState(3)
  const [result,setResult] = useState(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [ledger,setLedger] = useState(null)
  const [deckId,setDeckId] = useState('tarot')
  const [cards,setCards] = useState([])
  const [drawCount,setDrawCount] = useState(3)
  const deck = getDeck(deckId)

  const selectDeck = next => {
    setDeckId(next.id)
    setDrawCount(next.defaultCount)
    setCards([])
  }
  const drawInspiration = () => setCards(deck.draw(drawCount))
  const cast = async () => {
    if (!question.trim()) return setError('正式起卦要先写下所问何事')
    setBusy(true); setError(''); setResult(null)
    const started = Date.now()
    try {
      const data = await rollFortune(workerUrl,{ method, question:question.trim(), ...(method==='tarot'?{count}:{}) })
      const minimum = method==='xiaoliuren' ? 1050 : method==='liuyao' ? 700 : 520
      const remain = minimum - (Date.now()-started)
      if (remain > 0) await new Promise(resolve=>setTimeout(resolve,remain))
      setResult(data)
    } catch(e){ setError(e.message || '起卦失败') } finally { setBusy(false) }
  }
  const button = active => ({ border:`1px solid ${active?primary:'#ddd'}`, background:active?`${primary}18`:'#fff', borderRadius:14, padding:10, fontWeight:700 })

  return <div className="fixed inset-0 flex justify-center" style={{zIndex:90,background:'rgba(20,17,27,.72)'}}>
    <style>{`
      .fortune-stage{margin:16px 0 4px;padding:12px 6px;border-radius:18px;background:linear-gradient(180deg,#12141e,#0b0d14);border:1px solid rgba(217,164,65,.18);overflow:hidden}
      .fortune-dicerow{display:flex;gap:16px;justify-content:center;padding:5px 0}.fortune-die{width:60px;height:60px;border-radius:13px;position:relative;background:linear-gradient(155deg,#f7f6f2,#ddd9d0);box-shadow:inset 0 -3px 0 rgba(0,0,0,.14),0 4px 14px rgba(0,0,0,.42)}
      .fortune-die i{position:absolute;width:9px;height:9px;background:#23211e;border-radius:50%}.fortune-die b{position:absolute;inset:0;display:grid;place-items:center;color:#8a857c;font:400 25px Georgia,serif}.fortune-die.rolling{animation:fortuneShake .48s infinite}
      @keyframes fortuneShake{0%{transform:translate(0,0) rotate(0)}25%{transform:translate(3px,-4px) rotate(8deg)}50%{transform:translate(-4px,1px) rotate(-7deg)}75%{transform:translate(2px,3px) rotate(5deg)}100%{transform:none}}
      .fortune-lock{display:flex;align-items:center;justify-content:center;gap:8px;margin-top:13px;color:#d9a441;font-size:10.5px;letter-spacing:.22em}.fortune-lock:before,.fortune-lock:after{content:'';height:1px;width:30px;background:rgba(217,164,65,.32)}
      .fortune-coin-wait{display:flex;justify-content:center;gap:13px;padding:12px 0}.fortune-coincol{display:flex;flex-direction:column;gap:8px;max-width:340px;margin:2px auto}.fortune-tossrow{display:flex;align-items:center;gap:9px;opacity:0;transform:translateY(7px);transition:.35s}.fortune-tossrow.show{opacity:1;transform:none}.fortune-yname{width:20px;color:#8a857c;font-size:11px;text-align:center}.fortune-coins{display:flex;gap:5px}
      .fortune-coin{width:34px;height:34px;border-radius:50%;position:relative;display:inline-block;flex:none;box-shadow:inset 0 1px 1px rgba(255,242,205,.45),inset 0 -2px 3px rgba(35,22,8,.5),0 2px 5px rgba(0,0,0,.45)}.fortune-coin.back{background:radial-gradient(circle at 32% 28%,#ecd08a,#caa25c 45%,#977440 78%,#715428)}.fortune-coin.zi{background:radial-gradient(circle at 32% 28%,#7d6647,#5a4732 48%,#41321f 80%,#2f2415)}.fortune-hole{position:absolute;left:50%;top:50%;width:10px;height:10px;transform:translate(-50%,-50%);background:#090a0e;box-shadow:0 0 0 1px rgba(0,0,0,.5)}.fortune-ins{position:absolute;inset:2px;color:#e6d1a0;font:600 7px Georgia,serif}.fortune-ins i{position:absolute;font-style:normal}.fortune-ins i:nth-child(1){top:1px;left:13px}.fortune-ins i:nth-child(2){bottom:1px;left:13px}.fortune-ins i:nth-child(3){top:13px;right:1px}.fortune-ins i:nth-child(4){top:13px;left:1px}.fortune-coin.flip{animation:fortuneCoin .48s ease-out}@keyframes fortuneCoin{from{transform:rotateY(0) scale(.88)}to{transform:rotateY(720deg) scale(1)}}
      .fortune-yao-mark{margin-left:auto;display:flex;align-items:center;gap:6px;color:#f2eee5}.fortune-yao-mark b{font-size:9px;color:#d9a441;font-weight:500}.fortune-yang,.fortune-yin{display:flex;width:54px;gap:7px}.fortune-yang i{height:3px;background:#f2eee5;flex:1}.fortune-yin i{height:3px;background:#f2eee5;flex:1}
      .fortune-spread{display:flex;gap:12px;justify-content:center;overflow-x:auto;padding:7px 5px 10px}.fortune-spread.celtic{justify-content:flex-start}.fortune-tcard{perspective:900px;flex:0 0 auto}.fortune-tc-inner{position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .75s cubic-bezier(.3,.7,.25,1)}.fortune-tcard.flip .fortune-tc-inner{transform:rotateY(180deg)}.fortune-tc-back,.fortune-tc-face{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;border-radius:10px;overflow:hidden;border:1px solid rgba(217,164,65,.32)}
      .fortune-tc-back{background:radial-gradient(1px 1px at 18% 22%,rgba(244,243,239,.85),transparent 55%),radial-gradient(1px 1px at 72% 14%,rgba(244,243,239,.6),transparent 55%),radial-gradient(1.5px 1.5px at 60% 68%,rgba(244,243,239,.7),transparent 55%),radial-gradient(1px 1px at 30% 82%,rgba(244,243,239,.5),transparent 55%),radial-gradient(circle at 50% 40%,rgba(120,140,200,.16),transparent 58%),linear-gradient(160deg,#12162a,#0a0c16 58%,#0e1120);box-shadow:0 8px 22px rgba(0,0,0,.32)}.fortune-tc-back:before{content:'';position:absolute;inset:7px;border:1px solid rgba(217,164,65,.22);border-radius:6px}.fortune-tc-back span{position:absolute;inset:0;display:grid;place-items:center;color:rgba(217,164,65,.58);font-size:26px}.fortune-tcard.waiting{animation:fortuneCardFloat 1.25s ease-in-out infinite alternate}@keyframes fortuneCardFloat{from{transform:translateY(2px) rotate(-.8deg)}to{transform:translateY(-4px) rotate(.8deg)}}
      .fortune-tc-face{transform:rotateY(180deg);background:#eee7d7;display:flex;align-items:center;justify-content:center}.fortune-tc-face img{width:100%;height:100%;object-fit:cover;display:block}.fortune-tc-face em{position:absolute;top:5px;right:5px;background:rgba(122,61,80,.86);color:#fff;border-radius:999px;width:22px;height:22px;display:grid;place-items:center;font-size:10px;font-style:normal}.fortune-card-fallback{width:100%;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#584837;background:linear-gradient(155deg,#f5eddc,#dfd0b8);padding:8px}.fortune-card-fallback small{margin-top:5px}
    `}</style>
    <div className="h-full w-full max-w-md flex flex-col" style={{background:'#faf7fb'}}>
      <header style={{padding:'max(12px,env(safe-area-inset-top,0px)) 14px 10px',display:'grid',gridTemplateColumns:'40px 1fr 40px',alignItems:'center',borderBottom:`1px solid ${primary}22`}}>
        <button onClick={onClose} style={{border:0,background:'transparent'}}><ArrowLeft/></button>
        <div style={{textAlign:'center'}}><b>抽签屋</b><small style={{display:'block',color:'#a58b96'}}>问心 · 落印 · 只断不改</small></div>
        <button onClick={async()=>{try{setLedger(await listFortuneSessions(workerUrl,20))}catch(e){setError(e.message)}}} style={{border:0,background:'transparent'}}><History/></button>
      </header>
      <main style={{flex:1,overflowY:'auto',padding:14}}>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}><button onClick={()=>setTab('formal')} style={button(tab==='formal')}>正式起卦</button><button onClick={()=>setTab('inspiration')} style={button(tab==='inspiration')}>灵感签</button></div>
        {tab==='formal' ? <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginTop:12}}>{[['xiaoliuren','小六壬'],['liuyao','六爻'],['tarot','塔罗']].map(([id,label])=><button key={id} onClick={()=>{setMethod(id);setResult(null);setError('')}} style={button(method===id)}>{label}</button>)}</div>
          <textarea value={question} onChange={e=>setQuestion(e.target.value)} rows={2} placeholder="一事一问，写清楚后再起卦" style={{width:'100%',boxSizing:'border-box',marginTop:12,border:'1px solid #ddd',borderRadius:14,padding:11,resize:'none'}}/>
          {method==='tarot'&&<div style={{display:'flex',gap:6,marginTop:8}}>{[1,3,10].map(n=><button key={n} onClick={()=>setCount(n)} style={button(count===n)}>{n===1?'单牌':n===3?'三牌':'十字'}</button>)}</div>}
          {error&&<p style={{color:'#a65367',fontSize:11}}>{error}</p>}
          <button onClick={cast} disabled={busy} style={{width:'100%',border:0,borderRadius:16,padding:12,marginTop:10,color:'#fff',background:primary,fontWeight:800}}>{busy ? method==='xiaoliuren'?'骰子摇着…':method==='liuyao'?'三钱落案…':'正在洗牌…' : '起卦'}</button>
          <small style={{display:'block',textAlign:'center',color:'#a58b96',marginTop:6}}>随机数在 Worker 生成，结果先写入卦账</small>
          {busy && method==='xiaoliuren' && <DiceStage rolling/>}
          {busy && method==='liuyao' && <CoinStage rolling/>}
          {busy && method==='tarot' && <TarotStage count={count} primary={primary} waiting/>}
          {result&&<section style={{marginTop:12}}>
            <div style={{fontSize:10,textAlign:'center',color:'#987b88'}}>{result.seal}</div>
            {method==='xiaoliuren'&&<DiceStage values={result.payload?.values}/>} 
            {method==='liuyao'&&<CoinStage tosses={result.payload?.tosses} yaos={result.payload?.yaos}/>} 
            {method==='tarot'&&<TarotStage cards={result.payload?.cards} count={result.payload?.cards?.length||count} primary={primary}/>} 
            <pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',lineHeight:1.6,background:'#fff',borderRadius:14,padding:12}}>{result.face}</pre>
            <button onClick={()=>onInterpret(result.text||result.face)} style={{...button(true),width:'100%'}}><Sparkles size={14} style={{display:'inline',marginRight:5}}/>让 TA 断这张卦</button>
          </section>}
        </> : <>
          <p style={{fontSize:10,textAlign:'center',color:'#987b88'}}>灵感签只在本机随机，不写入正式卦账</p>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>{DIVINATION_DECKS.map(d=><button key={d.id} onClick={()=>selectDeck(d)} style={button(deckId===d.id)}>{d.icon} {d.label}</button>)}</div>
          <div style={{marginTop:10,padding:11,borderRadius:14,background:'#fff',border:'1px solid #e7dce2'}}><label style={{display:'block',fontSize:10.5,color:'#8f707d',marginBottom:6}}>{deck.id==='answers'?'先在心里问清楚，也可以写下来':'想问什么？不写也可以直接抽'}</label><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="比如：这件事接下来会怎样？" maxLength={160} style={{width:'100%',boxSizing:'border-box',border:`1px solid ${primary}25`,background:'#fff',borderRadius:12,padding:'10px 11px',outline:'none',fontFamily:'inherit',fontSize:13,color:'#4d3340'}}/>{deck.counts.length>1&&<div style={{display:'flex',alignItems:'center',gap:7,marginTop:9}}><span style={{fontSize:10.5,color:'#8f707d'}}>抽几张</span>{deck.counts.map(n=><button key={n} onClick={()=>{setDrawCount(n);setCards([])}} style={{...button(drawCount===n),padding:'6px 10px'}}>{n}</button>)}</div>}</div>
          <button onClick={drawInspiration} style={{width:'100%',border:0,borderRadius:16,padding:12,marginTop:10,color:'#fff',background:primary,fontWeight:800}}>{cards.length?'再抽一次':deck.id==='answers'?'翻开答案':'抽一抽'}</button>
          {!!cards.length&&<><div style={{display:'flex',gap:8,overflowX:'auto',marginTop:12}}>{cards.map((c,i)=><div key={`${c.id||c.title}-${i}`} style={{flex:'0 0 130px',background:'#fff',borderRadius:14,padding:12,textAlign:'center'}}><div style={{fontSize:28}}>{c.symbol}</div><b>{c.title}</b>{c.subtitle&&<small style={{display:'block',color:c.reversed?'#9666a6':'#6d917a'}}>{c.subtitle}</small>}<small style={{display:'block'}}>{c.detail}</small></div>)}</div><div style={{display:'flex',gap:8,marginTop:8}}><button onClick={drawInspiration} aria-label="重新抽取" style={{...button(false),width:46,padding:0}}><RotateCcw size={15}/></button><button onClick={()=>onInterpret(formatDivinationPrompt(deck,question.trim(),cards))} style={{...button(true),flex:1}}>让 TA 解读</button></div></>}
        </>}
      </main>
    </div>
    {Array.isArray(ledger)&&<div className="fixed inset-0 flex items-end justify-center" style={{zIndex:105,background:'rgba(0,0,0,.3)'}} onClick={()=>setLedger(null)}><div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:448,maxHeight:'70vh',overflowY:'auto',background:'#fff',borderRadius:'22px 22px 0 0',padding:14}}><b>卦账</b>{ledger.map(s=><div key={s.id} style={{padding:10,marginTop:7,background:'#faf7fb',borderRadius:12}}><b>{s.question}</b><small style={{display:'block'}}>{s.seal}</small></div>)}</div></div>}
  </div>
}
