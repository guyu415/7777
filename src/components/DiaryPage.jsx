import { useState, useEffect, useRef, useMemo } from 'react'
import { useStore, saveMessage, getMessages } from '../store'
import { getAllLetters, getLettersByCharacter, addLetter } from '../services/letters'
import { saveSessionMsgs } from '../services/sync'

const MOOD_OPTIONS = ['😊', '🥰', '😌', '😔', '🥹', '😤', '🤔', '😶‍🌫️']
const WEATHER_OPTIONS = ['☀️', '⛅', '☁️', '🌧️', '❄️', '🌙']

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function todayStr() {
  // en-CA locale yields YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

export default function DiaryPage({ theme }) {
  const { sessions, aiName: globalAiName, aiAvatar: globalAiAvatar, userAvatar, diaryTarget, setDiaryTarget } = useStore()

  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [filter, setFilter] = useState('all')
  const [mood, setMood] = useState('😊')
  const [weather, setWeather] = useState('☀️')
  const [content, setContent] = useState('')
  const [letters, setLetters] = useState(() => getAllLetters())
  const [sending, setSending] = useState(false)

  const scrollRef = useRef(null)
  const bottomRef = useRef(null)
  const letterRefs = useRef({})

  const refresh = () => setLetters(getAllLetters())

  const charOf = (sessionId) => {
    const s = sessions?.find(x => x.id === sessionId)
    return {
      name: s?.aiName || globalAiName || '未知',
      avatar: s?.aiAvatar || globalAiAvatar || '',
    }
  }

  const visibleLetters = useMemo(() => {
    const list = filter === 'all' ? getAllLetters() : getLettersByCharacter(filter)
    return [...list].sort((a, b) => a.createdAt - b.createdAt) // chronological, newest at bottom
  }, [filter, letters])

  const scrollToBottom = () => {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // On entering / when navigated from a chat letter card: scroll to target letter, else bottom
  useEffect(() => {
    if (diaryTarget) {
      const target = letters.find(l => l.id === diaryTarget)
      if (target && target.sessionId && filter === 'all') {
        // keep 'all' so target is visible regardless of character
      }
      setTimeout(() => {
        const el = letterRefs.current[diaryTarget]
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        setDiaryTarget(null)
      }, 80)
    } else {
      scrollToBottom()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendLetter = async () => {
    if (filter === 'all' || !content.trim() || sending) return
    setSending(true)
    try {
      const session = sessions?.find(s => s.id === filter)
      const { name, avatar } = charOf(filter)
      const date = todayStr()
      const body = content.trim()

      addLetter({ sessionId: filter, characterName: name, characterAvatar: avatar, role: 'user', mood, weather, date, content: body })

      // Append as a [LETTER...] chat message so the AI perceives it in context next reply
      const chatMsg = {
        id: genId(),
        conversationId: filter,
        role: 'user',
        type: 'text',
        content: `[LETTER mood=${mood} weather=${weather} date=${date}]\n${body}\n[/LETTER]`,
        timestamp: Date.now(),
      }
      await saveMessage(chatMsg)

      // Cloud-sync that session's messages
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
      refresh()
      scrollToBottom()
    } finally {
      setSending(false)
    }
  }

  const tabStyle = (active) => ({
    flexShrink: 0,
    padding: '6px 16px', borderRadius: 20, fontSize: 13, cursor: 'pointer', transition: 'all 0.2s',
    border: active ? `1.5px solid ${primary}` : '1.5px solid rgba(200,220,255,0.4)',
    background: active ? `${primary}22` : 'rgba(255,255,255,0.4)',
    color: active ? primaryDark : '#6a90b8',
    fontWeight: active ? 600 : 400,
    whiteSpace: 'nowrap',
  })

  const emojiBtn = (active) => ({
    fontSize: 18, lineHeight: 1, padding: '4px 6px', borderRadius: 10, cursor: 'pointer',
    border: active ? `1.5px solid ${primary}` : '1.5px solid transparent',
    background: active ? `${primary}1f` : 'rgba(255,255,255,0.35)',
    transition: 'all 0.15s',
  })

  const canWrite = filter !== 'all'
  const filterCharName = canWrite ? charOf(filter).name : ''

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)', paddingBottom: 12,
          background: 'rgba(255,255,255,0.72)',
          backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(200,220,255,0.25)',
          boxShadow: '0 2px 12px rgba(74,172,240,0.08)',
        }}>
        <span className="font-semibold text-sm" style={{ color: '#2c5282' }}>📔 日记本</span>
        <img src="/assets/whale.png" alt="" style={{ width: 32, height: 32, objectFit: 'contain' }} />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 px-3 py-2 overflow-x-auto flex-shrink-0" style={{ background: 'rgba(255,255,255,0.3)' }}>
        <button style={tabStyle(filter === 'all')} onClick={() => setFilter('all')}>全部</button>
        {(sessions || []).map(s => (
          <button key={s.id} style={tabStyle(filter === s.id)} onClick={() => setFilter(s.id)}>
            {s.aiName || globalAiName || s.name}
          </button>
        ))}
      </div>

      {/* Letters list */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {visibleLetters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-2" style={{ color: '#a0b8d0' }}>
            <div className="text-4xl">📭</div>
            <div className="text-sm">
              {filter === 'all' ? '还没有信件，跟 AI 聊聊看看？' : `还没收到来自 ${filterCharName} 的信`}
            </div>
          </div>
        ) : (
          visibleLetters.map(l => {
            const isUser = l.role === 'user'
            const ch = charOf(l.sessionId)
            const avatar = isUser ? userAvatar : (l.characterAvatar || ch.avatar)
            const name = isUser ? '我' : (l.characterName || ch.name)
            return (
              <div
                key={l.id}
                ref={el => { letterRefs.current[l.id] = el }}
                className={isUser ? 'ml-auto' : 'mr-auto'}
                style={{
                  maxWidth: '90%',
                  background: isUser
                    ? 'linear-gradient(135deg, rgba(255,240,246,0.96), rgba(252,236,244,0.96))'
                    : 'linear-gradient(135deg, rgba(250,244,230,0.96), rgba(244,238,252,0.96))',
                  border: isUser ? '1px solid rgba(230,160,190,0.45)' : '1px solid rgba(200,180,150,0.42)',
                  borderRadius: 16,
                  padding: '12px 14px',
                  boxShadow: '0 3px 14px rgba(150,140,120,0.16)',
                  outline: diaryTarget === l.id ? `2px solid ${primary}` : 'none',
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div style={{ width: 28, height: 28, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, background: 'rgba(255,255,255,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>
                    {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (isUser ? '🐣' : '🌸')}
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: isUser ? '#b56a8a' : '#6b5840' }}>{name}</span>
                  <span style={{ fontSize: 12, marginLeft: 'auto', color: '#9a8a70' }}>{l.date}</span>
                </div>
                <div style={{ fontSize: 13, display: 'flex', gap: 10, marginBottom: 8 }}>
                  <span>{l.mood}</span><span>{l.weather}</span>
                </div>
                <div style={{ borderTop: '1px solid rgba(200,180,150,0.3)', paddingTop: 8, fontSize: 14, lineHeight: 1.6, color: isUser ? '#8a5a70' : '#7a6850', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {l.content}
                </div>
              </div>
            )
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Write panel */}
      <div className="flex-shrink-0 px-3 pt-2 pb-2" style={{
        background: 'rgba(255,255,255,0.55)',
        backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        borderTop: '1px solid rgba(200,220,255,0.3)',
      }}>
        {!canWrite ? (
          <div className="text-center text-sm py-3" style={{ color: '#a0b8d0' }}>请先选择一个角色，再写信 ✿</div>
        ) : (
          <>
            <div className="flex items-center gap-1 mb-1 overflow-x-auto">
              <span style={{ fontSize: 12, color: '#7a9cc0', flexShrink: 0, marginRight: 2 }}>心情</span>
              {MOOD_OPTIONS.map(m => (
                <button key={m} style={emojiBtn(mood === m)} onClick={() => setMood(m)}>{m}</button>
              ))}
            </div>
            <div className="flex items-center gap-1 mb-2 overflow-x-auto">
              <span style={{ fontSize: 12, color: '#7a9cc0', flexShrink: 0, marginRight: 2 }}>天气</span>
              {WEATHER_OPTIONS.map(w => (
                <button key={w} style={emojiBtn(weather === w)} onClick={() => setWeather(w)}>{w}</button>
              ))}
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={`写点什么给 ${filterCharName}...`}
              rows={3}
              style={{
                width: '100%', resize: 'none',
                background: 'rgba(255,255,255,0.75)',
                border: '1px solid rgba(200,220,255,0.5)',
                borderRadius: 14, padding: '10px 14px', fontSize: 14, color: '#2c5282',
                outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
              }}
            />
            <div className="flex justify-end mt-2">
              <button
                onClick={sendLetter}
                disabled={!content.trim() || sending}
                className="px-6 py-2 rounded-full text-sm font-medium text-white transition-all duration-200"
                style={{
                  background: (!content.trim() || sending) ? 'rgba(150,170,200,0.4)' : `linear-gradient(135deg, ${primary}, ${primaryDark})`,
                  boxShadow: (!content.trim() || sending) ? 'none' : `0 4px 14px ${primary}55`,
                  border: 'none', cursor: (!content.trim() || sending) ? 'default' : 'pointer',
                }}
              >
                📮 寄出
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
