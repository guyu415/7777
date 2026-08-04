import { useEffect, useRef, useState } from 'react'
import { Send, X } from 'lucide-react'
import { limitPokerChat, POKER_CHAT_LIMIT } from './pokerTableChat'

export default function PokerTableChat({ open, onClose, messages = [], players = [], onSend, busy = false, accent = '#ff85b3' }) {
  const [text, setText] = useState('')
  const logRef = useRef(null)

  useEffect(() => {
    if (open) requestAnimationFrame(() => logRef.current?.scrollTo({ top: logRef.current.scrollHeight }))
  }, [open, messages.length])

  if (!open) return null
  const send = async () => {
    const value = limitPokerChat(text)
    if (!value || busy) return
    setText('')
    await onSend(value)
  }
  const nameOf = (index) => index === 0 ? '用户' : (players[index]?.name || `玩家${index + 1}`)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 135, background: 'rgba(31,18,25,.3)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', height: 'min(62dvh, 480px)', display: 'flex', flexDirection: 'column', borderRadius: '24px 24px 0 0', background: '#fffaf9', paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px 9px', borderBottom: '1px solid rgba(0,0,0,.055)' }}>
          <div><strong style={{ color: '#573847', fontSize: 14 }}>牌桌闲聊</strong><div style={{ color: '#a07a89', fontSize: 9.5, marginTop: 2 }}>每句最多10个字 · 不报牌不解说</div></div>
          <button onClick={onClose} style={{ width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: 'rgba(0,0,0,.05)', color: '#775463' }}><X size={15} /></button>
        </div>
        <div ref={logRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px' }}>
          {!messages.length && <div style={{ textAlign: 'center', color: '#b698a3', fontSize: 11, paddingTop: 28 }}>说句短短的话吧</div>}
          {messages.map((m) => {
            const mine = m.player === 0
            return <div key={m.id} style={{ display: 'flex', flexDirection: mine ? 'row-reverse' : 'row', alignItems: 'flex-end', gap: 6, margin: '7px 0' }}>
              <div style={{ maxWidth: '72%' }}>
                <div style={{ textAlign: mine ? 'right' : 'left', color: '#aa8290', fontSize: 8.5, marginBottom: 2 }}>{nameOf(m.player)}</div>
                <div style={{ padding: '7px 10px', borderRadius: 13, background: mine ? accent : 'rgba(235,221,226,.72)', color: mine ? '#fff' : '#654453', fontSize: 12.5 }}>{m.text}</div>
              </div>
            </div>
          })}
          {busy && <div style={{ color: '#aa8290', fontSize: 10, padding: '5px 2px' }}>牌友正在接话…</div>}
        </div>
        <div style={{ display: 'flex', gap: 7, padding: '8px 13px 0' }}>
          <input value={text} onChange={(e) => setText(limitPokerChat(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') send() }} placeholder="最多十个字" disabled={busy} style={{ flex: 1, minWidth: 0, border: `1px solid ${accent}35`, borderRadius: 16, padding: '9px 12px', background: '#fff', color: '#654453', fontSize: 13, outline: 'none' }} />
          <span style={{ alignSelf: 'center', color: '#ad8b98', fontSize: 9 }}>{Array.from(text).length}/{POKER_CHAT_LIMIT}</span>
          <button onClick={send} disabled={!text.trim() || busy} style={{ width: 38, height: 38, display: 'grid', placeItems: 'center', border: 0, borderRadius: '50%', background: accent, color: '#fff', opacity: text.trim() && !busy ? 1 : .45 }}><Send size={14} /></button>
        </div>
      </div>
    </div>
  )
}
