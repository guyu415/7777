import { useState } from 'react'
import { ArrowLeft, History, RotateCcw, Sparkles } from 'lucide-react'
import { useStore } from '../../store'
import { DIVINATION_DECKS, formatDivinationPrompt, getDeck } from './divinationDecks'
import { listFortuneSessions, rollFortune, tarotCardImageUrl } from '../../services/divination'

function TarotResultCard({ card, workerUrl, primary, single }) {
  const [failed, setFailed] = useState(false)
  const src = tarotCardImageUrl(workerUrl, card.id)
  const width = single ? 174 : 124
  const height = Math.round(width * 1.62)
  return (
    <div className="animate-fade-up" style={{ flex:`0 0 ${width}px`, textAlign:'center' }}>
      <div style={{ width, height, borderRadius:12, overflow:'hidden', border:`1px solid ${primary}44`, background:'linear-gradient(155deg,#171827,#0c0d16)', boxShadow:`0 9px 24px ${primary}20`, display:'grid', placeItems:'center' }}>
        {!failed && src ? <img src={src} alt={`${card.name}${card.reversed?'逆位':'正位'}`} onError={()=>setFailed(true)} style={{ width:'100%', height:'100%', objectFit:'contain', display:'block', transform:card.reversed?'rotate(180deg)':'none' }} /> : <div style={{ color:'#eadfca', padding:12 }}><div style={{fontSize:30}}>✦</div><b>{card.name}</b></div>}
      </div>
      <div style={{fontSize:10,color:'#967a86',marginTop:7}}>{card.position}</div>
      <div style={{fontSize:13,fontWeight:800,color:'#4d3340',marginTop:2}}>{card.name}</div>
      <div style={{fontSize:10.5,color:card.reversed?'#9666a6':'#6d917a',marginTop:2}}>{card.reversed?'逆位':'正位'}</div>
    </div>
  )
}

export default function DivinationRoom({ theme, onClose, onInterpret }) {
  const primary = theme?.primary || '#ff85b3'
  const workerUrl = useStore(s => s.workerUrl)
  const [tab,setTab] = useState('formal'), [method,setMethod] = useState('xiaoliuren')
  const [question,setQuestion] = useState(''), [count,setCount] = useState(3), [result,setResult] = useState(null)
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [ledger,setLedger] = useState(null)
  const [deckId,setDeckId] = useState('tarot'), [cards,setCards] = useState([]), [drawCount,setDrawCount] = useState(3)
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
    try { setResult(await rollFortune(workerUrl,{ method, question:question.trim(), ...(method==='tarot'?{count}:{}) })) }
    catch(e){ setError(e.message || '起卦失败') } finally { setBusy(false) }
  }
  const button = active => ({ border:`1px solid ${active?primary:'#ddd'}`, background:active?`${primary}18`:'#fff', borderRadius:14, padding:10, fontWeight:700 })

  return <div className="fixed inset-0 flex justify-center" style={{zIndex:90,background:'rgba(30,20,35,.35)'}}><div className="h-full w-full max-w-md flex flex-col" style={{background:'#faf7fb'}}>
    <header style={{padding:'max(12px,env(safe-area-inset-top,0px)) 14px 10px',display:'grid',gridTemplateColumns:'40px 1fr 40px',alignItems:'center',borderBottom:`1px solid ${primary}22`}}><button onClick={onClose} style={{border:0,background:'transparent'}}><ArrowLeft/></button><div style={{textAlign:'center'}}><b>抽签屋</b><small style={{display:'block',color:'#a58b96'}}>问心 · 落印 · 只断不改</small></div><button onClick={async()=>{try{setLedger(await listFortuneSessions(workerUrl,20))}catch(e){setError(e.message)}}} style={{border:0,background:'transparent'}}><History/></button></header>
    <main style={{flex:1,overflowY:'auto',padding:14}}><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}><button onClick={()=>setTab('formal')} style={button(tab==='formal')}>正式起卦</button><button onClick={()=>setTab('inspiration')} style={button(tab==='inspiration')}>灵感签</button></div>
    {tab==='formal'?<><div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:6,marginTop:12}}>{[['xiaoliuren','小六壬'],['liuyao','六爻'],['tarot','塔罗']].map(([id,label])=><button key={id} onClick={()=>{setMethod(id);setResult(null)}} style={button(method===id)}>{label}</button>)}</div><textarea value={question} onChange={e=>setQuestion(e.target.value)} rows={2} placeholder="一事一问，写清楚后再起卦" style={{width:'100%',boxSizing:'border-box',marginTop:12,border:'1px solid #ddd',borderRadius:14,padding:11,resize:'none'}}/>{method==='tarot'&&<div style={{display:'flex',gap:6,marginTop:8}}>{[1,3,10].map(n=><button key={n} onClick={()=>setCount(n)} style={button(count===n)}>{n===1?'单牌':n===3?'三牌':'十字'}</button>)}</div>}{error&&<p style={{color:'#a65367',fontSize:11}}>{error}</p>}<button onClick={cast} disabled={busy} style={{width:'100%',border:0,borderRadius:16,padding:12,marginTop:10,color:'#fff',background:primary,fontWeight:800}}>{busy?'正在落印…':'起卦'}</button><small style={{display:'block',textAlign:'center',color:'#a58b96',marginTop:6}}>随机数在 Worker 生成，结果先写入卦账</small>{result&&<section style={{marginTop:16}}><div style={{fontSize:10,textAlign:'center',color:'#987b88'}}>{result.seal}</div>{method==='tarot'&&Array.isArray(result.payload?.cards)&&<div style={{display:'flex',justifyContent:result.payload.cards.length===1?'center':'flex-start',gap:12,overflowX:'auto',padding:'14px 4px 10px'}}>{result.payload.cards.map(card=><TarotResultCard key={`${result.id}-${card.id}-${card.position}`} card={card} workerUrl={workerUrl} primary={primary} single={result.payload.cards.length===1}/>)}</div>}<pre style={{whiteSpace:'pre-wrap',fontFamily:'inherit',lineHeight:1.6,background:'#fff',borderRadius:14,padding:12}}>{result.face}</pre><button onClick={()=>onInterpret(result.text||result.face)} style={{...button(true),width:'100%'}}><Sparkles size={14} style={{display:'inline',marginRight:5}}/>让 TA 断这张卦</button></section>}</>:<><p style={{fontSize:10,textAlign:'center',color:'#987b88'}}>灵感签只在本机随机，不写入正式卦账</p><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>{DIVINATION_DECKS.map(d=><button key={d.id} onClick={()=>selectDeck(d)} style={button(deckId===d.id)}>{d.icon} {d.label}</button>)}</div><div style={{marginTop:10,padding:11,borderRadius:14,background:'#fff',border:'1px solid #e7dce2'}}><label style={{display:'block',fontSize:10.5,color:'#8f707d',marginBottom:6}}>{deck.id==='answers'?'先在心里问清楚，也可以写下来':'想问什么？不写也可以直接抽'}</label><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="比如：这件事接下来会怎样？" maxLength={160} style={{width:'100%',boxSizing:'border-box',border:`1px solid ${primary}25`,background:'#fff',borderRadius:12,padding:'10px 11px',outline:'none',fontFamily:'inherit',fontSize:13,color:'#4d3340'}}/>{deck.counts.length>1&&<div style={{display:'flex',alignItems:'center',gap:7,marginTop:9}}><span style={{fontSize:10.5,color:'#8f707d'}}>抽几张</span>{deck.counts.map(n=><button key={n} onClick={()=>{setDrawCount(n);setCards([])}} style={{...button(drawCount===n),padding:'6px 10px'}}>{n}</button>)}</div>}</div><button onClick={drawInspiration} style={{width:'100%',border:0,borderRadius:16,padding:12,marginTop:10,color:'#fff',background:primary,fontWeight:800}}>{cards.length?'再抽一次':deck.id==='answers'?'翻开答案':'抽一抽'}</button>{!!cards.length&&<><div style={{display:'flex',gap:8,overflowX:'auto',marginTop:12}}>{cards.map((c,i)=><div key={`${c.id||c.title}-${i}`} style={{flex:'0 0 130px',background:'#fff',borderRadius:14,padding:12,textAlign:'center'}}><div style={{fontSize:28}}>{c.symbol}</div><b>{c.title}</b>{c.subtitle&&<small style={{display:'block',color:c.reversed?'#9666a6':'#6d917a'}}>{c.subtitle}</small>}<small style={{display:'block'}}>{c.detail}</small></div>)}</div><div style={{display:'flex',gap:8,marginTop:8}}><button onClick={drawInspiration} aria-label="重新抽取" style={{...button(false),width:46,padding:0}}><RotateCcw size={15}/></button><button onClick={()=>onInterpret(formatDivinationPrompt(deck,question.trim(),cards))} style={{...button(true),flex:1}}>让 TA 解读</button></div></>}</>}</main></div>
    {Array.isArray(ledger)&&<div className="fixed inset-0 flex items-end justify-center" style={{zIndex:105,background:'rgba(0,0,0,.3)'}} onClick={()=>setLedger(null)}><div onClick={e=>e.stopPropagation()} style={{width:'100%',maxWidth:448,maxHeight:'70vh',overflowY:'auto',background:'#fff',borderRadius:'22px 22px 0 0',padding:14}}><b>卦账</b>{ledger.map(s=><div key={s.id} style={{padding:10,marginTop:7,background:'#faf7fb',borderRadius:12}}><b>{s.question}</b><small style={{display:'block'}}>{s.seal}</small></div>)}</div></div>}
  </div>
}
