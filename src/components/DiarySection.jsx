import { useState, useEffect } from 'react'
import { useStore } from '../store'
import { getLatestLetter, getLetterById, addLetter } from '../services/letters'
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
function LetterBody({ text }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 200 || text.split('\n').length > 6
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

// Diary is a Google Drive-backed mailbox — no browsable history, no avatar
// picker. Opening it shows just the latest letter as a plain content card
// (no header — no avatar/name/mood/weather badges, per explicit request);
// the compose box still lets the user write back, always to whichever
// session is currently active (no character picker needed since there's
// only ever one "current" conversation). cc can also write on its own via
// a separate direct path (see channel-server.ts's diary_write tool).
//
// `diaryTarget` (set when a letter-card bubble in chat is clicked) overrides
// "show latest" with "show this specific letter, by its Drive fileId".
export default function DiarySection({ theme }) {
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

  const load = async (targetId) => {
    setLoading(true)
    setLoadError(false)
    try {
      const result = targetId ? await getLetterById(targetId) : await getLatestLetter()
      setLetter(result)
    } catch (e) {
      console.warn('[LETTERS] 读取失败:', e.message)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (diaryTarget) {
      load(diaryTarget)
      setDiaryTarget(null)
    } else {
      load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    background: active ? `${primary}1f` : 'rgba(255,255,255,0.35)',
    transition: 'all 0.15s',
  })

  return (
    <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
      {/* Latest (or targeted) letter — plain semi-transparent blue overlay,
          no avatar/name/mood/weather header, just the text. */}
      <div className="flex-1 overflow-y-auto px-1" style={{ minHeight: 0 }}>
        {loading ? (
          <div className="flex items-center justify-center h-full text-center" style={{ color: '#a0b8d0' }}>
            <div className="text-sm">读取中…</div>
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-1 py-4" style={{ color: '#a0b8d0' }}>
            <div className="text-3xl">📭</div>
            <div className="text-xs">信箱暂时联系不上，稍后再看看？</div>
          </div>
        ) : !letter ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-1 py-4" style={{ color: '#a0b8d0' }}>
            <div className="text-3xl">📭</div>
            <div className="text-xs">还没有信，跟 AI 聊聊看看？</div>
          </div>
        ) : (
          <div
            style={{
              background: 'rgba(74,144,226,0.32)',
              backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
              borderRadius: 18,
              padding: '18px 18px',
              boxShadow: '0 4px 20px rgba(30,70,150,0.18)',
            }}
          >
            <LetterBody text={letter.content || ''} />
          </div>
        )}
      </div>

      {/* Write panel — always archives to Drive and delivers to resident CC. */}
      <div className="flex-shrink-0 pt-2 mt-1" style={{ borderTop: '1px solid rgba(200,220,255,0.3)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {!ccSession ? (
          <div style={{ padding: 10, color: '#a06f7c', fontSize: 12 }}>请先绑定 Claude Code 常驻聊天窗。</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, margin: '3px 0 7px', fontSize: 12, color: '#7a9cc0' }}>
              <button type="button" onClick={() => setDeliveryMode('now')} style={{ border: 0, borderRadius: 999, padding: '5px 10px', color: deliveryMode === 'now' ? '#fff' : '#6d8daf', background: deliveryMode === 'now' ? primary : 'rgba(220,232,248,.7)' }}>立即发送</button>
              <button type="button" onClick={() => setDeliveryMode('scheduled')} style={{ border: 0, borderRadius: 999, padding: '5px 10px', color: deliveryMode === 'scheduled' ? '#fff' : '#6d8daf', background: deliveryMode === 'scheduled' ? primary : 'rgba(220,232,248,.7)' }}>定时发送</button>
              <button type="button" onClick={() => setDetailsOpen(value => !value)} style={{ marginLeft: deliveryMode === 'scheduled' ? 0 : 'auto', border: 0, borderRadius: 999, padding: '5px 9px', color: detailsOpen ? primaryDark : '#8295aa', background: detailsOpen ? `${primary}18` : 'transparent' }}>
                {detailsOpen ? '收起心情天气' : `${mood || weather ? `${mood || ''}${weather || ''} ` : ''}心情天气⌄`}
              </button>
              {deliveryMode === 'scheduled' && <input type="datetime-local" value={deliverAt} min={defaultDeliveryTime()} onChange={e => setDeliverAt(e.target.value)} style={{ minWidth: 180, flex: '1 1 100%', border: '1px solid rgba(160,190,225,.45)', borderRadius: 9, padding: '5px 6px', color: '#52749a', background: 'rgba(255,255,255,.76)', fontSize: 11 }} />}
            </div>
            {detailsOpen && (
              <div style={{ marginBottom: 7, padding: '7px 8px', borderRadius: 12, background: 'rgba(235,242,252,.56)' }}>
                <div className="flex items-center gap-1 overflow-x-auto">
                  <span style={{ fontSize: 11, color: '#7a9cc0', flexShrink: 0 }}>心情</span>
                  {MOOD_OPTIONS.map(m => <button key={m} style={emojiBtn(mood === m)} onClick={() => setMood(current => current === m ? null : m)}>{m}</button>)}
                </div>
                <div className="flex items-center gap-1 mt-1 overflow-x-auto">
                  <span style={{ fontSize: 11, color: '#7a9cc0', flexShrink: 0 }}>天气</span>
                  {WEATHER_OPTIONS.map(w => <button key={w} style={emojiBtn(weather === w)} onClick={() => setWeather(current => current === w ? null : w)}>{w}</button>)}
                </div>
              </div>
            )}
            <div className="flex items-center gap-2">
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                onFocus={e => setTimeout(() => e.target.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 250)}
                placeholder="写点什么..."
                rows={1}
                style={{
                  flex: 1, height: 44, minHeight: 44, maxHeight: 44, resize: 'none', overflowY: 'auto',
                  background: 'rgba(255,255,255,0.75)',
                  border: '1px solid rgba(200,220,255,0.5)',
                  borderRadius: 22, padding: '11px 15px', fontSize: 13, lineHeight: '20px', color: '#2c5282',
                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
              <button
                onClick={sendLetter}
                disabled={!content.trim() || sending}
                className="rounded-full text-sm font-medium text-white transition-all duration-200 flex-shrink-0"
                style={{
                  width: 44, height: 44, padding: 0,
                  background: (!content.trim() || sending) ? 'rgba(150,170,200,0.4)' : `linear-gradient(135deg, ${primary}, ${primaryDark})`,
                  boxShadow: (!content.trim() || sending) ? 'none' : `0 4px 12px ${primary}55`,
                  border: 'none', cursor: (!content.trim() || sending) ? 'default' : 'pointer',
                }}
              >
                📮
              </button>
            </div>
            {sendStatus && <div style={{ marginTop: 5, paddingInline: 2, color: sendStatus.startsWith('寄出失败') ? '#b76472' : '#668b78', fontSize: 11 }}>{sendStatus}</div>}
          </>
        )}
      </div>
    </div>
  )
}
