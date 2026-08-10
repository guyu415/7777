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

// Collapsible letter body — folds when content exceeds ~5 lines
function LetterBody({ text, color }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 160 || text.split('\n').length > 5
  return (
    <div style={{ borderTop: '1px solid rgba(200,180,150,0.3)', paddingTop: 8, fontSize: 14, lineHeight: 1.6, color, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      <div style={!expanded && long ? { display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' } : undefined}>
        {text}
      </div>
      {long && (
        <button onClick={() => setExpanded(v => !v)} style={{ marginTop: 6, fontSize: 12, color: '#9a8ab0', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </div>
  )
}

// Diary is now a Google Drive-backed mailbox — no more browsable full
// history in this UI (that used to be a per-character-filterable, scrollable
// list over a local+KV copy of every letter ever written). Opening it just
// shows the single latest letter; the compose box below still lets the user
// write one back (to `filter`'s session), which cc can also do on its own
// via a separate direct write path (see channel-server.ts's diary_write
// tool) without going through this UI at all.
//
// `diaryTarget` (set when a letter-card bubble in chat is clicked) overrides
// "show latest" with "show this specific letter, by its Drive fileId" —
// preserves the old click-through-to-that-letter behavior even though there
// is no longer a full timeline to scroll it into view within.
export default function DiarySection({ theme }) {
  const { sessions, aiAvatar: globalAiAvatar, userAvatar, diaryTarget, setDiaryTarget } = useStore()

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [filter, setFilter] = useState('all')
  const [mood, setMood] = useState('😊')
  const [weather, setWeather] = useState('☀️')
  const [content, setContent] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [letter, setLetter] = useState(null)
  const [loadError, setLoadError] = useState(false)

  const charOf = (sessionId) => {
    const s = sessions?.find(x => x.id === sessionId)
    return {
      name: s?.name || '未知会话',
      avatar: s?.aiAvatar || globalAiAvatar || '',
    }
  }

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
    if (filter === 'all' || !content.trim() || sending) return
    setSending(true)
    try {
      const date = todayStr()
      const body = content.trim()
      await addLetter({ sessionId: filter, role: 'user', mood, weather, date, content: body })

      // Also drop a real chat message into this session so the AI actually
      // sees "a letter arrived" in its next turn — a Drive-only write is
      // invisible to it otherwise (the diary index injected into the system
      // prompt is metadata-only, no content).
      const chatMsg = {
        id: genId(),
        conversationId: filter,
        role: 'user',
        type: 'text',
        content: `[LETTER mood=${mood} weather=${weather} date=${date}]\n${body}\n[/LETTER]`,
        timestamp: Date.now(),
      }
      await saveMessage(chatMsg)
      const password = localStorage.getItem('auth.password')
      if (password) {
        try {
          const all = await getMessages(filter)
          all.sort((a, b) => a.timestamp - b.timestamp)
          await saveSessionMsgs(password, filter, all.filter(m => !m.streaming))
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

  const canWrite = filter !== 'all'
  const filterCharName = canWrite ? charOf(filter).name : ''

  const AvatarFilter = ({ active, avatar, emoji, label, onClick }) => (
    <button
      onClick={onClick}
      title={label}
      style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'none', border: 'none', cursor: 'pointer', padding: 0, width: 48 }}
    >
      <div style={{
        width: 38, height: 38, borderRadius: '50%', overflow: 'hidden',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        background: 'rgba(255,255,255,0.6)',
        border: active ? `2px solid ${primary}` : '2px solid transparent',
        boxShadow: active ? `0 0 8px ${primary}88` : 'none',
        transition: 'all 0.2s',
      }}>
        {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (emoji || '🌸')}
      </div>
      <span style={{ fontSize: 9, lineHeight: 1.1, maxWidth: 46, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: active ? primaryDark : '#9aaec0' }}>
        {label}
      </span>
    </button>
  )

  const emojiBtn = (active) => ({
    fontSize: 16, lineHeight: 1, padding: '3px 5px', borderRadius: 9, cursor: 'pointer',
    border: active ? `1.5px solid ${primary}` : '1.5px solid transparent',
    background: active ? `${primary}1f` : 'rgba(255,255,255,0.35)',
    transition: 'all 0.15s',
  })

  const letterIsUser = letter?.role === 'user'
  const letterChar = letter ? charOf(letter.sessionId) : null
  const letterAvatar = letter ? (letterIsUser ? userAvatar : letterChar.avatar) : null
  const letterName = letter ? (letterIsUser ? '我' : letterChar.name) : null

  return (
    <div className="flex flex-col h-full">
      {/* Avatar filter row — still picks WHO to write to below; no longer
          filters a browsable list, since there is none anymore */}
      <div className="flex gap-1 px-1 pb-2 overflow-x-auto flex-shrink-0">
        <AvatarFilter active={filter === 'all'} emoji="📔" label="全部" onClick={() => setFilter('all')} />
        {(sessions || []).map(s => (
          <AvatarFilter
            key={s.id}
            active={filter === s.id}
            avatar={s.aiAvatar || globalAiAvatar}
            label={s.name}
            onClick={() => setFilter(s.id)}
          />
        ))}
      </div>

      {/* Latest (or targeted) letter only */}
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
              background: letterIsUser
                ? 'linear-gradient(135deg, rgba(255,240,246,0.96), rgba(252,236,244,0.96))'
                : 'linear-gradient(135deg, rgba(250,244,230,0.96), rgba(244,238,252,0.96))',
              border: letterIsUser ? '1px solid rgba(230,160,190,0.45)' : '1px solid rgba(200,180,150,0.42)',
              borderRadius: 16,
              padding: '14px 16px',
              boxShadow: '0 2px 10px rgba(150,140,120,0.14)',
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <div style={{ width: 26, height: 26, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>
                {letterAvatar ? <img src={letterAvatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (letterIsUser ? '🐣' : '🌸')}
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: letterIsUser ? '#b56a8a' : '#6b5840' }}>{letterName}</span>
              <span style={{ fontSize: 13, marginLeft: 'auto' }}>{letter.mood} {letter.weather}</span>
              <span style={{ fontSize: 11, color: '#9a8a70' }}>{letter.date}</span>
            </div>
            <LetterBody text={letter.content || ''} color={letterIsUser ? '#8a5a70' : '#7a6850'} />
          </div>
        )}
      </div>

      {/* Write panel */}
      <div className="flex-shrink-0 pt-2 mt-1" style={{ borderTop: '1px solid rgba(200,220,255,0.3)' }}>
        {!canWrite ? null : (
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
                placeholder={`写点什么给 ${filterCharName}...`}
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
