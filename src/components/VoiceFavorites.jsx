import { useState, useEffect } from 'react'
import { ChevronLeft } from 'lucide-react'
import { useStore } from '../store'
import { loadAsset, deleteAsset } from '../services/sync'
import VoicePlayer from './Voice/VoicePlayer'

const SYNC_BASE = 'https://chat.xiaoman.xyz'
const FAV_LIST_KEY = 'user:xiaoman2.26:voice_fav_list'

function fmtDate(ts) {
  const d = new Date(ts)
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${mo}-${day} ${hh}:${mm}`
}

// 兼容解析：裸 JSON 直接 parse；旧版 data URL 用 TextDecoder 还原 UTF-8 再 parse
function parseFavList(value) {
  if (!value) return []
  const v = value.trim()
  if (v.startsWith('data:')) {
    try {
      const b64 = v.slice(v.indexOf(',') + 1)
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      return JSON.parse(new TextDecoder().decode(bytes))
    } catch { return [] }
  }
  try { return JSON.parse(v) } catch { return [] }
}

export default function VoiceFavorites({ theme }) {
  const { setCurrentView } = useStore()
  const primary = theme?.primary ?? '#8b5cf6'

  const [list, setList] = useState(null)
  const [error, setError] = useState(null)
  const [playingUrl, setPlayingUrl] = useState({})
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    const password = localStorage.getItem('auth.password')
    if (!password) { setError('请先登录'); return }
    fetch(`${SYNC_BASE}/sync/get?password=${encodeURIComponent(password)}&key=${encodeURIComponent(FAV_LIST_KEY)}`)
      .then(r => r.ok ? r.json() : null)
      .then(json => setList(parseFavList(json?.value).slice().reverse()))
      .catch(e => setError(e.message))
  }, [])

  const handlePlay = async (item) => {
    if (playingUrl[item.id]) return
    const password = localStorage.getItem('auth.password')
    if (!password) return
    try {
      const url = await loadAsset(password, `user:xiaoman2.26:voice_fav:${item.id}`)
      setPlayingUrl(prev => ({ ...prev, [item.id]: url }))
    } catch (e) {
      console.error('[VoiceFavorites] load error', e)
    }
  }

  const handleDelete = async (item) => {
    const password = localStorage.getItem('auth.password')
    if (!password) return
    setDeleting(item.id)
    try {
      // 乐观更新：先从本地状态移除
      const newList = list.filter(i => i.id !== item.id)
      setList(newList)
      // 写回 KV（逆序存储，写入时恢复原序）
      const stored = newList.slice().reverse()
      await fetch(`${SYNC_BASE}/sync/set`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, key: FAV_LIST_KEY, value: JSON.stringify(stored) }),
      })
      // 删除音频资产（忽略失败，不阻塞）
      deleteAsset(password, `user:xiaoman2.26:voice_fav:${item.id}`).catch(() => {})
    } catch (e) {
      console.error('[VoiceFavorites] delete error', e)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="flex flex-col h-full" style={{
      background: 'linear-gradient(160deg, #f0f4ff 0%, #fdf2fb 100%)',
    }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(200,220,255,0.25)',
        boxShadow: '0 2px 12px rgba(74,172,240,0.08)',
      }}>
        <button
          onClick={() => setCurrentView('sessionSettings')}
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-200"
          style={{ background: `${primary}18`, color: primary }}
        >
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-sm flex-1" style={{ color: '#2c5282' }}>⭐ 语音收藏</span>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {error && (
          <div className="text-center text-sm py-8" style={{ color: '#e74c3c' }}>{error}</div>
        )}
        {list === null && !error && (
          <div className="text-center text-sm py-8" style={{ color: '#8b9ac0' }}>加载中…</div>
        )}
        {list !== null && list.length === 0 && (
          <div className="text-center text-sm py-8" style={{ color: '#8b9ac0' }}>暂无收藏</div>
        )}
        {list?.map(item => (
          <div key={item.id} style={{
            background: 'rgba(255,255,255,0.6)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            borderRadius: 16,
            padding: '12px 14px',
            border: '1px solid rgba(200,220,255,0.3)',
            boxShadow: '0 2px 10px rgba(74,172,240,0.06)',
          }}>
            {item.text && (
              <p className="text-sm mb-2 leading-relaxed" style={{ color: '#2c5282' }}>{item.text}</p>
            )}
            <div className="flex items-center justify-between gap-3">
              {playingUrl[item.id] ? (
                <VoicePlayer url={playingUrl[item.id]} duration={item.duration} naked />
              ) : (
                <button
                  onClick={() => handlePlay(item)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all"
                  style={{ background: `${primary}18`, color: primary }}
                >
                  ▶ 播放
                </button>
              )}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-xs" style={{ color: '#8b9ac0' }}>{fmtDate(item.ts)}</span>
                <button
                  onClick={() => handleDelete(item)}
                  disabled={deleting === item.id}
                  className="w-6 h-6 rounded-full flex items-center justify-center transition-all"
                  style={{ background: 'rgba(220,60,60,0.08)', color: '#e07070', fontSize: 12 }}
                >
                  🗑
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
