import { useState } from 'react'
import { Share2 } from 'lucide-react'

export default function PokerSummaryPanel({ summary, sessions = [], onShare, accent = '#ff85b3' }) {
  const [target, setTarget] = useState(sessions[0]?.id || '')
  const [status, setStatus] = useState('')
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

  return (
    <div style={{ marginTop: 12, width: '100%', maxWidth: 340, padding: 12, borderRadius: 16, background: 'rgba(255,255,255,.7)', border: `1px solid ${accent}28`, textAlign: 'left' }}>
      <div style={{ fontSize: 11.5, color: '#6b4757', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{summary.text}</div>
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
