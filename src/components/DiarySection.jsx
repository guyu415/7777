import { useState, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { getLatestLetter, getLetterById, getRecentLettersByCharacter, addLetter } from '../services/letters'
import { scheduleDiaryLetter, sendDiaryLetterNow } from '../services/companion'

const MOOD_OPTIONS = ['😊', '🥰', '😌', '😔', '🥹', '😤', '🤔', '😶‍🌫️']
const WEATHER_OPTIONS = ['☀️', '⛅', '☁️', '🌧️', '❄️', '🌙']

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function defaultDeliveryTime() {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

// Collapsible letter body — folds when content exceeds ~6 lines
function LetterBody({ text, full = false }) {
  const [expanded, setExpanded] = useState(false)
  const long = !full && (text.length > 200 || text.split('\n').length > 6)
  return (
    <div style={{ fontSize: 15, lineHeight: 1.7, color: '#fff', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <div style={!expanded && long ? { display: '-webkit-box', WebkitLineClamp: 6, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>
        {text}
      </div>
      {long && (
        <button onClick={() => setExpanded(v => !v)} style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.75)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  )
}

// Drive-backed mailbox. History loads an index; each selected body is fetched on demand.
// Chat letter cards can still open a specific Drive file through diaryTarget.
export default function DiarySection({ theme, liquid = false }) {
  const { sessions, diaryTarget, setDiaryTarget } = useStore()
  const ccSession = sessions?.find(session => session.providerName === 'claude-code-vps')

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [mood, setMood] = useState(null)
  const [weather, setWeather] = useState(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [letter, setLetter] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [deliveryMode, setDeliveryMode] = useState('now')
  const [deliverAt, setDeliverAt] = useState(defaultDeliveryTime)
  const [sendStatus, setSendStatus] = useState('')
  const [selectedId, setSelectedId] = useState(diaryTarget || '')
  const [history, setHistory] = useState([])
  const [historyStatus, setHistoryStatus] = useState('loading')
  const [historyRevision, setHistoryRevision] = useState(0)
  const loadRequest = useRef(0)

  const load = async (targetId = '') => {
    const request = ++loadRequest.current
    setSelectedId(targetId)
    setLoading(true)
    setLoadError(false)
    try {
      const result = targetId ? await getLetterById(targetId) : await getLatestLetter()
      if (request === loadRequest.current) setLetter(result)
    } catch (e) {
      console.warn('[LETTERS] 读取失败:', e.message)
      if (request === loadRequest.current) setLoadError(true)
    } finally {
      if (request === loadRequest.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (diaryTarget) {
      load(diaryTarget)
      setDiaryTarget(null)
    } else {
      load()
    }
    return () => { loadRequest.current += 1 }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!liquid) return
    let cancelled = false
    setHistory([])
    setHistoryStatus('loading')
    getRecentLettersByCharacter(ccSession?.id, 50, { throwOnError: true })
      .then(items => {
        if (cancelled) return
        setHistory([...items].reverse())
        setHistoryStatus('ready')
      })
      .catch(() => { if (!cancelled) setHistoryStatus('error') })
    return () => { cancelled = true }
  }, [liquid, ccSession?.id, historyRevision])

  const sendLetter = async () => {
    if (!content.trim() || sending || !ccSession?.id) return
    setSending(true)
    setSendStatus('')
    try {
      const date = todayStr()
      const body = content.trim()
      const archived = await addLetter({
        sessionId: ccSession.id, role: 'user', date, content: body,
        mood: mood || '-', weather: weather || '-',
      })
      const id = `diary-letter-${archived?.id || genId()}`
      const text = `[LETTER mood=${mood || '-'} weather=${weather || '-'} date=${date}]\n${body}\n[/LETTER]`
      if (deliveryMode === 'scheduled') {
        const timestamp = new Date(deliverAt).getTime()
        if (!Number.isFinite(timestamp) || timestamp < Date.now() + 5_000) throw new Error('请选择一个未来的发送时间')
        await scheduleDiaryLetter({ id, text, deliverAt: timestamp })
        setSendStatus(`已定时：${new Date(timestamp).toLocaleString('zh-CN', { hour12: false })}`)
      } else {
        await sendDiaryLetterNow({ id, text })
        setSendStatus('已送达 Claude Code 常驻聊天')
      }

      setContent('')
      setHistoryRevision(value => value + 1)
      await load()
    } catch (e) {
      console.warn('[LETTERS] 寄出失败:', e.message)
      setSendStatus(`寄出失败：${e.message}`)
    } finally {
      setSending(false)
    }
  }

  const emojiBtn = (active) => ({
    fontSize: 16, lineHeight: 1, padding: '3px 5px', borderRadius: 9, cursor: 'pointer',
    border: active ? `1.5px solid ${primary}` : '1.5px solid transparent',
    background: active ? `${primary}32` : (liquid ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.35)'),
    transition: 'all 0.15s',
  })

  return (
    <div className={`flex flex-col h-full diary-section${liquid ? ' diary-section--liquid' : ''}`} style={{ minHeight: 0 }}>
      {liquid && (
        <div className="diary-section__history">
          <label htmlFor="diary-history">往期信件</label>
          <select id="diary-history" value={selectedId} onChange={event => load(event.target.value)}>
            <option value="">最新一封</option>
            {selectedId && !history.some(item => item.id === selectedId) && <option value={selectedId}>当前打开的信</option>}
            {history.map((item, index) => <option key={item.id} value={item.id}>{item.date || '未标日期'} · {item.role === 'user' ? '我的回信' : '来信'} · {history.length - index}</option>)}
          </select>
          <small>{historyStatus === 'loading' ? '目录读取中…' : historyStatus === 'error' ? <button onClick={() => setHistoryRevision(value => value + 1)}>目录读取失败 · 重试</button> : history.length ? `当前会话 · 最近 ${history.length} 封` : '当前会话暂无可选信件'}</small>
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-1 diary-section__letters" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="flex items-center justify-center h-full text-center" style={{ color: liquid ? 'rgba(232,242,255,.7)' : '#a0b8d0' }}>
            <div className="text-sm">读取中…</div>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-1 py-4" style={{ color: liquid ? 'rgba(232,242,255,.7)' : '#a0b8d0' }}>
            <div className="text-3xl">📭</div>
            <div className="text-xs">信箱暂时联系不上，稍后再看看？</div>
          </div>
        ) : !letter ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-1 py-4" style={{ color: liquid ? 'rgba(232,242,255,.7)' : '#a0b8d0' }}>
            <div className="text-3xl">📭</div>
            <div className="text-xs">还没有信，跟 AI 聊聊看看？</div>
          </div>
        ) : (
          <div
            className="diary-section__letter-card"
            style={{
              background: liquid ? 'transparent' : 'rgba(74,144,226,0.32)',
              backdropFilter: liquid ? undefined : 'blur(10px)', WebkitBackdropFilter: liquid ? undefined : 'blur(10px)',
              borderRadius: 18,
              padding: '18px 18px',
              boxShadow: liquid ? 'none' : '0 4px 20px rgba(30,70,150,0.18)',
            }}
          >
            <LetterBody key={letter.id || selectedId} text={letter.content || ''} full={liquid} />
          </div>
        )}
      </div>

      {/* Write panel — always archives to Drive and delivers to resident CC. */}
      <div className="flex-shrink-0 pt-2 mt-1 diary-section__compose" style={{ borderTop: liquid ? '0' : '1px solid rgba(200,220,255,0.3)', paddingBottom: liquid ? 12 : 'env(safe-area-inset-bottom, 0px)' }}>
        {!ccSession ? (
          <div style={{ padding: 10, color: liquid ? '#ffd7e2' : '#a06f7c', fontSize: 12 }}>请先绑定 Claude Code 常驻聊天窗。</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '3px 0 7px', fontSize: 12, color: liquid ? 'rgba(225,239,255,.72)' : '#7a9cc0' }}>
              <button type="button" onClick={() => setDeliveryMode('now')} style={{ border: liquid ? '1px solid rgba(255,255,255,.16)' : 0, borderRadius: 999, padding: '5px 10px', color: deliveryMode === 'now' ? '#fff' : (liquid ? 'rgba(230,241,255,.72)' : '#6d8daf'), background: deliveryMode === 'now' ? (liquid ? 'rgba(134,188,255,.30)' : primary) : (liquid ? 'rgba(255,255,255,.06)' : 'rgba(220,232,248,.7)') }}>立即发送</button>
              <button type="button" onClick={() => setDeliveryMode('scheduled')} style={{ border: liquid ? '1px solid rgba(255,255,255,.16)' : 0, borderRadius: 999, padding: '5px 10px', color: deliveryMode === 'scheduled' ? '#fff' : (liquid ? 'rgba(230,241,255,.72)' : '#6d8daf'), background: deliveryMode === 'scheduled' ? (liquid ? 'rgba(134,188,255,.30)' : primary) : (liquid ? 'rgba(255,255,255,.06)' : 'rgba(220,232,248,.7)') }}>定时发送</button>
              <button type="button" onClick={() => setDetailsOpen(value => !value)} style={{ marginLeft: deliveryMode === 'scheduled' ? 0 : 'auto', border: 0, borderRadius: 999, padding: '5px 9px', color: liquid ? 'rgba(235,244,255,.78)' : (detailsOpen ? primaryDark : '#8295aa'), background: detailsOpen ? (liquid ? 'rgba(255,255,255,.10)' : `${primary}18`) : 'transparent' }}>
                {detailsOpen ? '收起心情天气' : `${mood || weather ? `${mood || ''}${weather || ''} ` : ''}心情天气⌄`}
              </button>
              {deliveryMode === 'scheduled' && <input type="datetime-local" value={deliverAt} min={defaultDeliveryTime()} onChange={e => setDeliverAt(e.target.value)} style={{ minWidth: 180, flex: '1 1 100%', border: '1px solid rgba(160,190,225,.45)', borderRadius: 9, padding: '5px 6px', color: liquid ? '#f3f8ff' : '#52749a', background: liquid ? 'rgba(255,255,255,.10)' : 'rgba(255,255,255,.76)', fontSize: 11 }} />}
            </div>
            {detailsOpen && (
              <div style={{ marginBottom: 7, padding: '7px 8px', borderRadius: 12, background: liquid ? 'rgba(255,255,255,.06)' : 'rgba(235,242,252,.56)' }}>
                <div className="flex items-center gap-1 overflow-x-auto">
                  <span style={{ fontSize: 11, color: liquid ? 'rgba(225,239,255,.72)' : '#7a9cc0', flexShrink: 0 }}>心情</span>
                  {MOOD_OPTIONS.map(m => <button key={m} style={emojiBtn(mood === m)} onClick={() => setMood(current => current === m ? null : m)}>{m}</button>)}
                </div>
                <div className="flex items-center gap-1 mt-1 overflow-x-auto">
                  <span style={{ fontSize: 11, color: liquid ? 'rgba(225,239,255,.72)' : '#7a9cc0', flexShrink: 0 }}>天气</span>
                  {WEATHER_OPTIONS.map(w => <button key={w} style={emojiBtn(weather === w)} onClick={() => setWeather(current => current === w ? null : w)}>{w}</button>)}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <textarea
                aria-label="回信内容"
                value={content}
                onChange={e => setContent(e.target.value)}
                onFocus={e => setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 250)}
                placeholder="写点什么..."
                rows={1}
                style={{
                  flex: 1, height: 44, minHeight: 44, maxHeight: 44, resize: 'none', overflowY: 'auto',
                  background: liquid ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.75)',
                  border: liquid ? '1px solid rgba(255,255,255,.19)' : '1px solid rgba(200,220,255,0.5)',
                  borderRadius: 22, padding: '11px 15px', fontSize: 13, lineHeight: '20px', color: liquid ? '#f8fbff' : '#2c5282',
                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
              <button
                aria-label={sending ? '正在寄出' : '寄出回信'}
                onClick={sendLetter}
                disabled={!content.trim() || sending}
                className="rounded-full text-sm font-medium text-white transition-all duration-200 flex-shrink-0"
                style={{
                  width: 44, height: 44, padding: 0,
                  background: (!content.trim() || sending) ? 'rgba(150,170,200,0.28)' : (liquid ? 'linear-gradient(135deg,rgba(159,207,255,.74),rgba(87,133,207,.78))' : `linear-gradient(135deg, ${primary}, ${primaryDark})`),
                  boxShadow: (!content.trim() || sending) ? 'none' : (liquid ? '0 5px 18px rgba(78,139,222,.30)' : `0 4px 12px ${primary}55`),
                  border: 'none', cursor: (!content.trim() || sending) ? 'default' : 'pointer',
                }}
              >
                📮
              </button>
            </div>
            {sendStatus && <div style={{ marginTop: 5, paddingInline: 2, color: sendStatus.startsWith('寄出失败') ? (liquid ? '#ffd1dc' : '#b76472') : (liquid ? '#cdebdc' : '#668b78'), fontSize: 11 }}>{sendStatus}</div>}
          </>
        )}
      </div>
      {liquid && <style>{`
        .diary-section--liquid{display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;overflow:hidden;gap:8px;color:#f8fbff}
        .diary-section__history{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:6px 12px;padding:4px 4px 10px;border-bottom:1px solid rgba(220,237,255,.14)}
        .diary-section__history label{font-size:12px;color:rgba(232,242,255,.8)}
        .diary-section__history select{width:100%;min-width:0;min-height:40px;padding:8px 12px;border:1px solid rgba(220,237,255,.22);border-radius:12px;background:rgba(255,255,255,.06);color:#f8fbff;font-size:14px;color-scheme:dark}
        .diary-section__history small{grid-column:1/-1;font-size:10px;color:rgba(225,239,255,.6)}
        .diary-section__history small button{color:inherit;background:none;border:0;padding:4px 0;text-decoration:underline}
        .diary-section--liquid :is(button,select,textarea):focus-visible{outline:2px solid #b7ddff;outline-offset:2px}
        .diary-section--liquid .diary-section__letters{min-height:0;overflow:auto;overscroll-behavior:contain;padding:6px 4px 12px;box-sizing:border-box;scrollbar-width:none}
        .diary-section--liquid .diary-section__letters::-webkit-scrollbar{display:none}
        .diary-section--liquid .diary-section__letter-card{box-sizing:border-box;padding:8px 10px!important}
        .diary-section--liquid .diary-section__letter-card>div{font-family:'ZCOOL XiaoWei','Noto Serif SC',serif;font-size:14px!important;line-height:1.8!important;color:#f8fbff!important;text-shadow:0 1px 10px rgba(0,19,50,.24)}
        .diary-section--liquid .diary-section__compose{max-height:45dvh;overflow:auto;overscroll-behavior:contain;padding:12px 4px;margin:0;box-sizing:border-box}
        .diary-section--liquid textarea::placeholder{color:rgba(229,240,255,.55)}
        .diary-section--liquid input{color-scheme:dark}
      `}</style>}
    </div>
  )
}
