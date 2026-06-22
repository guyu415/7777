import { getLetterById } from '../../services/letters'

export default function LetterCard({ letterId }) {
  const letter = getLetterById(letterId)
  if (!letter) return null

  const text = letter.content || ''
  const preview = text.length > 20 ? text.slice(0, 20) + '…' : text

  return (
    <div
      onClick={(e) => { e.stopPropagation(); console.log('跳转日记本', letterId) }}
      style={{
        cursor: 'pointer',
        background: 'linear-gradient(135deg, rgba(250,244,230,0.95), rgba(244,238,252,0.95))',
        border: '1px solid rgba(200,180,150,0.4)',
        borderRadius: 14,
        padding: '12px 14px',
        boxShadow: '0 3px 12px rgba(180,160,120,0.18)',
        maxWidth: 240,
        color: '#6b5840',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>📔 写给你一封信</div>
      <div style={{ fontSize: 13, display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
        <span>{letter.mood}</span>
        <span>{letter.weather}</span>
        <span style={{ fontSize: 12, color: '#9a8a70' }}>{letter.date}</span>
      </div>
      <div style={{ borderTop: '1px solid rgba(200,180,150,0.35)', paddingTop: 8, fontSize: 13, lineHeight: 1.5, color: '#7a6850' }}>
        {preview}
      </div>
    </div>
  )
}
