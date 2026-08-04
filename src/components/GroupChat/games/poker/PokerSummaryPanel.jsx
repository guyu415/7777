import { useState } from 'react'
import { Share2 } from 'lucide-react'

export default function PokerSummaryPanel({ summary, sessions = [], onShare, onDiscuss, accent = '#ff85b3' }) {
  const [target, setTarget] = useState(sessions[0]?.id || '')
  const [status, setStatus] = useState('')
  const [discussing, setDiscussing] = useState(false)
  if (!summary) return null

  const share = async () => {
    if (!target || !onShare) return
    setStatus('发送中…')
    try {
      await onShare(target, summary)
      setStatus(`已分享到「${sessions.find((s) => s.id === target)?.name || target}」`)
    } catch (e) {
      setStatus(e.message || '分享失败')
    }
  }

  const discuss = async () => {
    if (!onDiscuss || discussing) return
    setDiscussing(true)
    setStatus('')
    try {
      await onDiscuss(summary)
      setStatus('已展开群聊讨论')
    } catch (e) {
      setStatus(e.message || '展开失败')
    } finally {
      setDiscussing(false)
    }
  }

  return (
    <div style={{ marginTop: 12, width: '100%', maxWidth: 340, padding: 12, borderRadius: 16, background: 'rgba(255,255,255,.7)', border: `1px solid ${accent}28`, textAlign: 'left' }}>
      <div style={{ fontSize: 11.5, color: '#6b4757', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{summary.text}</div>
      <button onClick={discuss} disabled={!onDiscuss || discussing} style={{ width: '100%', marginTop: 9, border: 0, borderRadius: 11, padding: '8px 10px', background: `linear-gradient(135deg,${accent},${accent}cc)`, color: '#fff', fontSize: 10.5, fontWeight: 700, opacity: onDiscuss ? 1 : .5 }}>{discussing ? '正在展开…' : '展开群聊讨论'}</button>
      <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
        <select value={target} onChange={(e) => { setTarget(e.target.value); setStatus('') }} style={{ minWidth: 0, flex: 1, borderRadius: 10, border: `1px solid ${accent}35`, background: '#fff', color: '#684555', fontSize: 10.5, padding: '7px 8px' }}>
          {sessions.map((s) => <option key={s.id} value={s.id}>分享至：{s.name || s.id}</option>)}
        </select>
        <button onClick={share} disabled={!target} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, border: 0, borderRadius: 10, padding: '7px 10px', background: accent, color: '#fff', fontSize: 10.5 }}><Share2 size={11} /> 分享</button>
      </div>
      {status && <div style={{ marginTop: 5, color: '#9a7584', fontSize: 9.5 }}>{status}</div>}
    </div>
  )
}
