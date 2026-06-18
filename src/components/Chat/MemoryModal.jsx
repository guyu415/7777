import { useState } from 'react'
import { g1Remember } from '../../services/memory'

const inputStyle = {
  width: '100%',
  background: 'rgba(255,255,255,0.6)',
  border: '1px solid rgba(255,182,209,0.35)',
  borderRadius: 12,
  padding: '8px 12px',
  fontSize: 13,
  color: '#8b5060',
  outline: 'none',
  fontFamily: 'inherit',
}

export default function MemoryModal({ message, endpoint, onClose, onSuccess }) {
  const [subject, setSubject] = useState('')
  const [predicate, setPredicate] = useState('')
  const [value, setValue] = useState(message?.content || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    if (!value.trim()) return
    setSaving(true)
    setError('')
    try {
      await g1Remember(endpoint, { subject: subject.trim(), predicate: predicate.trim(), value: value.trim() })
      onSuccess()
      onClose()
    } catch (e) {
      setError('保存失败，请检查记忆服务连接')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.2)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth: 340,
          background: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderRadius: 24,
          padding: 20,
          border: '1px solid rgba(255,182,209,0.3)',
          boxShadow: '0 12px 40px rgba(255,133,179,0.2)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🧠</span>
          <span className="font-semibold text-sm" style={{ color: '#8b5060' }}>存入记忆</span>
        </div>

        {/* Fields */}
        <div className="space-y-3">
          <div>
            <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>主体 Subject</label>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="关于谁？（如：我、用户）"
              style={inputStyle}
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>关系 Predicate</label>
            <input
              value={predicate}
              onChange={e => setPredicate(e.target.value)}
              placeholder="什么关系？（如：喜欢、叫做）"
              style={inputStyle}
            />
          </div>
          <div>
            <label className="text-xs pl-1 mb-1 block" style={{ color: '#c47a8a' }}>内容 Value</label>
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: 'none', lineHeight: '1.5' }}
            />
          </div>
        </div>

        {error && (
          <p className="text-xs mt-2 pl-1" style={{ color: '#e07070' }}>{error}</p>
        )}

        {/* Buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-full text-sm font-medium transition-all duration-200"
            style={{
              background: 'rgba(255,182,209,0.2)',
              color: '#c47a8a',
              border: '1px solid rgba(255,182,209,0.3)',
            }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !value.trim()}
            className="flex-1 py-2.5 rounded-full text-sm font-medium text-white transition-all duration-200"
            style={{
              background: saving || !value.trim()
                ? 'rgba(255,182,209,0.4)'
                : 'linear-gradient(135deg, #ff85b3, #ff6b9d)',
              boxShadow: saving || !value.trim() ? 'none' : '0 4px 12px rgba(255,133,179,0.4)',
              cursor: saving || !value.trim() ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? '保存中…' : '记住 ✨'}
          </button>
        </div>
      </div>
    </div>
  )
}
