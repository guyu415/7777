import { useState } from 'react'
import { Eye, EyeOff, KeyRound, Sparkles } from 'lucide-react'
import { login, getSettings, saveSettings, extractSettings } from '../services/sync'
import { useStore } from '../store'
import { slimSettings } from '../utils/image'

export default function LoginPage({ onLogin }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [scene] = useState(() => {
    const hour = new Date().getHours()
    return hour >= 6 && hour < 18 ? 'day' : 'night'
  })

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
        if (cloudSettings) {
          // 云端可能还是旧版的"胖配置"，先把超大头像/背景压小再入库，
          // 否则 zustand persist 写 localStorage 会触发 QuotaExceededError
          setStatus('正在整理云端配置...')
          const { settings: slimmed } = await slimSettings(cloudSettings)
          try {
            useStore.getState().restoreFromCloud(slimmed)
          } catch (e) {
            // 本地持久化失败也不中断登录——配置已在内存中生效
            console.warn('[LOGIN] 本地持久化失败:', e.message)
          }
        }
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
    <main className={`eunoia-login eunoia-login--${scene}`}>
      <div className="eunoia-login__photo" aria-hidden="true" />
      <div className="eunoia-login__veil" aria-hidden="true" />
      <div className="eunoia-login__light eunoia-login__light--one" aria-hidden="true" />
      <div className="eunoia-login__light eunoia-login__light--two" aria-hidden="true" />

      <form
        className="eunoia-login__card"
        onSubmit={(event) => {
          event.preventDefault()
          if (!loading && password.trim()) handleLogin()
        }}
      >
        <div className="eunoia-login__shine" aria-hidden="true" />

        <div className="eunoia-login__mark" aria-hidden="true">
          <Sparkles size={23} strokeWidth={1.65} />
        </div>

        <div className="eunoia-login__heading">
          <h1 className="eunoia-login__title" data-text="Eunoia">Eunoia</h1>
          <p>输入密码，回到你的私人空间</p>
        </div>

        <label className="eunoia-login__field">
          <span className="sr-only">密码</span>
          <KeyRound className="eunoia-login__field-icon" size={18} strokeWidth={1.7} aria-hidden="true" />
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder="请输入密码"
            autoComplete="current-password"
          />
          <button
            className="eunoia-login__reveal"
            type="button"
            onClick={() => setShowPassword(value => !value)}
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </label>

        <div className="eunoia-login__message" aria-live="polite">
          {status && <span className="eunoia-login__status">{status}</span>}
          {error && <span className="eunoia-login__error">{error}</span>}
        </div>

        <button
          className="eunoia-login__submit"
          type="submit"
          disabled={loading || !password.trim()}
        >
          <span>{loading ? '正在进入…' : '进入 Eunoia'}</span>
          {loading && <i aria-hidden="true" />}
        </button>

        <p className="eunoia-login__note">你的数据会在登录后安全同步</p>
      </form>

      <style>{`
        .eunoia-login {
          position: relative;
          width: 100%;
          height: 100%;
          min-height: 100dvh;
          display: grid;
          place-items: center;
          overflow: hidden;
          padding: max(24px, env(safe-area-inset-top)) 22px max(24px, env(safe-area-inset-bottom));
          background: #193853;
          box-sizing: border-box;
          isolation: isolate;
        }

        .eunoia-login__photo,
        .eunoia-login__veil {
          position: absolute;
          inset: 0;
        }

        .eunoia-login__photo {
          z-index: -4;
          inset: -4%;
          background: center / cover no-repeat;
          transform: scale(1.02);
          animation: eunoia-login-drift 16s ease-in-out infinite alternate;
        }

        .eunoia-login--day .eunoia-login__photo {
          background-image: url('/backgrounds/eunoia-splash-day.webp');
        }

        .eunoia-login--night .eunoia-login__photo {
          background-image: url('/backgrounds/eunoia-splash-night.webp');
        }

        .eunoia-login__veil {
          z-index: -3;
          background: linear-gradient(160deg, rgba(5,34,51,.25), rgba(29,79,86,.08) 48%, rgba(12,34,51,.28));
        }

        .eunoia-login--night .eunoia-login__veil {
          background: linear-gradient(160deg, rgba(13,16,46,.34), rgba(81,40,87,.08) 48%, rgba(15,17,43,.4));
        }

        .eunoia-login__light {
          position: absolute;
          z-index: -2;
          width: 340px;
          height: 340px;
          border-radius: 50%;
          filter: blur(70px);
          opacity: .34;
          pointer-events: none;
        }

        .eunoia-login__light--one {
          top: -150px;
          right: -150px;
          background: #d9ffff;
        }

        .eunoia-login__light--two {
          bottom: -190px;
          left: -130px;
          background: #ffd7df;
        }

        .eunoia-login--night .eunoia-login__light--one { background: #af91ff; }
        .eunoia-login--night .eunoia-login__light--two { background: #ff8a9e; }

        .eunoia-login__card {
          position: relative;
          width: min(100%, 348px);
          padding: 34px 25px 23px;
          border: 1px solid rgba(255,255,255,.48);
          border-radius: 34px;
          background: linear-gradient(145deg, rgba(255,255,255,.34), rgba(238,255,255,.16));
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.74),
            inset 0 -1px 0 rgba(255,255,255,.16),
            0 26px 70px rgba(8,34,48,.3),
            0 4px 15px rgba(10,54,70,.13);
          backdrop-filter: blur(19px) saturate(1.22);
          -webkit-backdrop-filter: blur(19px) saturate(1.22);
          box-sizing: border-box;
          overflow: hidden;
          animation: eunoia-login-card-in 700ms cubic-bezier(.2,.75,.2,1) both;
        }

        .eunoia-login--night .eunoia-login__card {
          background: linear-gradient(145deg, rgba(255,245,255,.28), rgba(89,62,119,.16));
          border-color: rgba(255,237,250,.43);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.66), 0 28px 76px rgba(21,13,48,.4);
        }

        .eunoia-login__shine {
          position: absolute;
          inset: 0 0 auto;
          height: 44%;
          border-radius: 34px 34px 48% 48%;
          background: linear-gradient(180deg, rgba(255,255,255,.19), transparent);
          pointer-events: none;
        }

        .eunoia-login__mark {
          position: relative;
          display: grid;
          place-items: center;
          width: 52px;
          height: 52px;
          margin: 0 auto 14px;
          border-radius: 19px;
          color: rgba(255,255,255,.94);
          border: 1px solid rgba(255,255,255,.64);
          background: linear-gradient(145deg, rgba(255,255,255,.42), rgba(193,245,248,.1));
          box-shadow: inset 0 1px 2px rgba(255,255,255,.75), inset 0 -5px 10px rgba(79,167,184,.12), 0 8px 17px rgba(18,66,78,.18);
          transform: rotate(-4deg);
        }

        .eunoia-login__heading { position: relative; text-align: center; margin-bottom: 24px; }

        .eunoia-login__title {
          position: relative;
          display: inline-block;
          margin: 0;
          color: transparent;
          font: 800 32px/1 ui-rounded, "SF Pro Rounded", "Avenir Next", system-ui, sans-serif;
          letter-spacing: -.055em;
          background: linear-gradient(180deg, rgba(255,255,255,.96), rgba(255,255,255,.36) 45%, rgba(217,252,255,.72));
          background-clip: text;
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          -webkit-text-stroke: .8px rgba(255,255,255,.72);
          filter: drop-shadow(0 5px 5px rgba(23,73,84,.22));
        }

        .eunoia-login__heading p {
          margin: 9px 0 0;
          color: rgba(247,255,255,.84);
          font-size: 12px;
          letter-spacing: .04em;
          text-shadow: 0 1px 5px rgba(18,54,70,.32);
        }

        .eunoia-login__field {
          position: relative;
          display: flex;
          align-items: center;
          height: 52px;
          border: 1px solid rgba(255,255,255,.5);
          border-radius: 18px;
          background: rgba(255,255,255,.2);
          box-shadow: inset 0 2px 5px rgba(31,82,94,.08), 0 1px 0 rgba(255,255,255,.3);
          transition: background 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
        }

        .eunoia-login__field:focus-within {
          background: rgba(255,255,255,.29);
          border-color: rgba(255,255,255,.82);
          box-shadow: 0 0 0 3px rgba(218,252,255,.17), inset 0 2px 5px rgba(31,82,94,.06);
        }

        .eunoia-login__field-icon {
          flex: none;
          margin-left: 15px;
          color: rgba(255,255,255,.78);
        }

        .eunoia-login__field input {
          min-width: 0;
          flex: 1;
          height: 100%;
          padding: 0 9px;
          border: 0;
          outline: 0;
          background: transparent;
          color: #fff;
          caret-color: #fff;
          font: 500 16px/1 inherit;
          letter-spacing: .025em;
        }

        .eunoia-login__field input::placeholder { color: rgba(250,255,255,.62); }

        .eunoia-login__reveal {
          display: grid;
          place-items: center;
          flex: none;
          width: 44px;
          height: 44px;
          margin-right: 3px;
          padding: 0;
          border: 0;
          border-radius: 15px;
          background: transparent;
          color: rgba(255,255,255,.72);
          cursor: pointer;
        }

        .eunoia-login__message {
          min-height: 31px;
          display: grid;
          place-items: center;
          padding-top: 7px;
          text-align: center;
          font-size: 11px;
        }

        .eunoia-login__status { color: rgba(240,255,255,.9); }
        .eunoia-login__error { color: #ffe0e5; text-shadow: 0 1px 5px rgba(99,20,35,.35); }

        .eunoia-login__submit {
          position: relative;
          width: 100%;
          height: 51px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 9px;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,.62);
          border-radius: 19px;
          background: linear-gradient(135deg, rgba(220,253,255,.73), rgba(143,220,226,.6));
          box-shadow: inset 0 1px 0 rgba(255,255,255,.8), inset 0 -5px 12px rgba(38,143,159,.14), 0 10px 22px rgba(20,77,90,.24);
          color: rgba(20,76,88,.92);
          font: 700 14px/1 inherit;
          letter-spacing: .04em;
          cursor: pointer;
          transition: transform 160ms ease, opacity 160ms ease, box-shadow 160ms ease;
        }

        .eunoia-login--night .eunoia-login__submit {
          background: linear-gradient(135deg, rgba(255,232,248,.78), rgba(211,178,235,.62));
          color: rgba(76,45,91,.94);
          box-shadow: inset 0 1px 0 rgba(255,255,255,.84), inset 0 -5px 12px rgba(123,67,139,.12), 0 10px 25px rgba(42,22,71,.27);
        }

        .eunoia-login__submit:not(:disabled):active { transform: scale(.98); }
        .eunoia-login__submit:disabled { cursor: default; opacity: .46; box-shadow: none; }

        .eunoia-login__submit i {
          width: 13px;
          height: 13px;
          border: 2px solid currentColor;
          border-right-color: transparent;
          border-radius: 50%;
          animation: eunoia-login-spin .7s linear infinite;
        }

        .eunoia-login__note {
          margin: 13px 0 0;
          text-align: center;
          color: rgba(245,255,255,.66);
          font-size: 10px;
          letter-spacing: .025em;
        }

        @keyframes eunoia-login-card-in {
          from { opacity: 0; transform: translateY(14px) scale(.975); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }

        @keyframes eunoia-login-drift {
          from { transform: translate3d(-.8%, 0, 0) scale(1.06); }
          to { transform: translate3d(.8%, -.5%, 0) scale(1.075); }
        }

        @keyframes eunoia-login-spin { to { transform: rotate(360deg); } }

        @media (prefers-reduced-motion: reduce) {
          .eunoia-login__photo,
          .eunoia-login__card,
          .eunoia-login__submit i { animation: none; }
        }
      `}</style>
    </main>
  )
}
