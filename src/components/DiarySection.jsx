import { useState, useEffect } from 'react'
import { useStore, saveMessage, getMessages } from '../store'
import { getLatestLetter, getLetterById, addLetter } from '../services/letters'
import { saveSessionMsgs } from '../services/sync'

const MOOD_OPTIONS = ['😊', '🥰', '😌', '😔', '🥹', '😤', '🤔', '😶‍🌫️']
const WEATHER_OPTIONS = ['☀️', '⛅', '☁️', '🌧️', '❄️', '🌙']

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
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
  const { currentSessionId, diaryTarget, setDiaryTarget } = useStore()

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [mood, setMood] = useState('😊')
  const [weather, setWeather] = useState('☀️')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [letter, setLetter] = useState(null)
  const [loadError, setLoadError] = useState(false)

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
    if (!content.trim() || sending || !currentSessionId) return
    setSending(true)
    try {
      const date = todayStr()
      const body = content.trim()
      await addLetter({ sessionId: currentSessionId, role: 'user', mood, weather, date, content: body })

      // Also drop a real chat message into the current session so the AI
      // actually sees "a letter arrived" in its next turn — a Drive-only
      // write is invisible to it otherwise (the diary index injected into
      // the system prompt is metadata-only, no content).
      const chatMsg = {
        id: genId(),
        conversationId: currentSessionId,
        role: 'user',
        type: 'text',
        content: `[LETTER mood=${mood} weather=${weather} date=${date}]\n${body}\n[/LETTER]`,
        timestamp: Date.now(),
      }
      await saveMessage(chatMsg)
      const password = localStorage.getItem('auth.password')
      if (password) {
        try {
          const all = await getMessages(currentSessionId)
          all.sort((a, b) => a.timestamp - b.timestamp)
          await saveSessionMsgs(password, currentSessionId, all.filter(m => !m.streaming))
        } catch (e) {
          console.warn('[LETTERS] 寄出后同步失败:', e.message)
        }
      }

      setContent('')
      await load()
    } catch (e) {
      console.warn('[LETTERS] 寄出失败:', e.message)
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
    <div className="flex flex-col h-full">
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

      {/* Write panel — always writes to the current conversation */}
      <div className="flex-shrink-0 pt-2 mt-1" style={{ borderTop: '1px solid rgba(200,220,255,0.3)' }}>
        {!currentSessionId ? null : (
          <>
            <div className="flex items-center gap-1 mb-1 overflow-x-auto">
              <span style={{ fontSize: 11, color: '#7a9cc0', flexShrink: 0 }}>心情</span>
              {MOOD_OPTIONS.map(m => <button key={m} style={emojiBtn(mood === m)} onClick={() => setMood(m)}>{m}</button>)}
            </div>
            <div className="flex items-center gap-1 mb-1.5 overflow-x-auto">
              <span style={{ fontSize: 11, color: '#7a9cc0', flexShrink: 0 }}>天气</span>
              {WEATHER_OPTIONS.map(w => <button key={w} style={emojiBtn(weather === w)} onClick={() => setWeather(w)}>{w}</button>)}
            </div>
            <div className="flex items-end gap-2">
              <textarea
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder="写点什么..."
                rows={2}
                style={{
                  flex: 1, resize: 'none',
                  background: 'rgba(255,255,255,0.75)',
                  border: '1px solid rgba(200,220,255,0.5)',
                  borderRadius: 12, padding: '8px 12px', fontSize: 13, color: '#2c5282',
                  outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
                }}
              />
              <button
                onClick={sendLetter}
                disabled={!content.trim() || sending}
                className="px-4 py-2 rounded-full text-sm font-medium text-white transition-all duration-200 flex-shrink-0"
                style={{
                  background: (!content.trim() || sending) ? 'rgba(150,170,200,0.4)' : `linear-gradient(135deg, ${primary}, ${primaryDark})`,
                  boxShadow: (!content.trim() || sending) ? 'none' : `0 4px 12px ${primary}55`,
                  border: 'none', cursor: (!content.trim() || sending) ? 'default' : 'pointer',
                }}
              >
                📮
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
