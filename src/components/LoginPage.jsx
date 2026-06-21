import { useState } from 'react'
import { login, getSettings, saveSettings, extractSettings } from '../services/sync'
import { useStore } from '../store'

export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const handleLogin = async () => {
    const pwd = password.trim()
    if (!pwd) return
    setLoading(true)
    setError('')
    setStatus('')
    try {
      const { ok, isNew } = await login(pwd)
      if (!ok) { setError('登录失败，请重试'); return }

      if (isNew) {
        const currentSettings = extractSettings(useStore.getState())
        setStatus('正在上传本地配置...')
        await saveSettings(pwd, currentSettings)
        setStatus('云端账号已建立 ✨')
        await new Promise(r => setTimeout(r, 1200))
      } else {
        setStatus('正在同步云端配置...')
        const cloudSettings = await getSettings(pwd)
        if (cloudSettings) useStore.getState().restoreFromCloud(cloudSettings)
        setStatus('配置已同步 ✓')
        await new Promise(r => setTimeout(r, 600))
      }

      localStorage.setItem('auth.password', pwd)
      onLogin()
    } catch (e) {
      setError(e.message || '连接失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="h-full w-full flex items-center justify-center"
      style={{ background: 'linear-gradient(160deg, #fce4ec 0%, #f8bbd0 25%, #fce4ec 55%, #fff0f6 80%, #ffeef5 100%)' }}>
      <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '-80px', right: '-60px', width: '280px', height: '280px', borderRadius: '50%', background: 'rgba(255,182,193,0.45)', filter: 'blur(60px)' }} />
        <div style={{ position: 'absolute', bottom: '-100px', left: '-80px', width: '340px', height: '340px', borderRadius: '50%', background: 'rgba(255,192,203,0.4)', filter: 'blur(80px)' }} />
      </div>

      <div className="relative w-full max-w-xs px-6" style={{ zIndex: 1 }}>
        <div style={{
          background: 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderRadius: 28,
          padding: '32px 24px',
          border: '1px solid rgba(255,182,209,0.4)',
          boxShadow: '0 8px 40px rgba(255,133,179,0.15)',
        }}>
          <div className="text-center mb-6">
            <div className="text-4xl mb-3">🌸</div>
            <h1 className="font-semibold text-lg" style={{ color: '#8b5060' }}>小漫聊天</h1>
            <p className="text-xs mt-1" style={{ color: '#c47a8a' }}>输入密码继续</p>
          </div>

          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !loading && handleLogin()}
            placeholder="请输入密码"
            autoFocus
            style={{
              width: '100%', background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(255,182,209,0.4)', borderRadius: 16,
              padding: '12px 16px', fontSize: 16, color: '#8b5060',
              outline: 'none', fontFamily: 'inherit', marginBottom: 12, boxSizing: 'border-box',
            }}
          />

          {status && <p className="text-xs text-center mb-3" style={{ color: '#c47a8a' }}>{status}</p>}
          {error && <p className="text-xs text-center mb-3" style={{ color: '#e07070' }}>{error}</p>}

          <button
            onClick={handleLogin}
            disabled={loading || !password.trim()}
            style={{
              width: '100%', padding: '12px', borderRadius: 20, border: 'none',
              background: loading ? 'rgba(255,133,179,0.3)' : 'linear-gradient(135deg, #ff85b3, #ff6b9d)',
              color: 'white', fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
              cursor: loading || !password.trim() ? 'default' : 'pointer',
              opacity: !password.trim() ? 0.5 : 1,
              boxShadow: loading ? 'none' : '0 4px 16px rgba(255,133,179,0.4)',
              transition: 'all 0.2s',
            }}
          >
            {loading ? '登录中...' : '登 录'}
          </button>
        </div>
      </div>
    </div>
  )
}
