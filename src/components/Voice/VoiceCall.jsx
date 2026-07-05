import { useEffect, useRef } from 'react'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { useStore } from '../../store'
import { useVoiceCall } from '../../hooks/useVoiceCall'

const STATUS_TEXT = {
  listening: '在听你说…',
  thinking: '想想怎么回…',
  speaking: '正在说话',
  muted: '已静音',
  idle: '连接中…',
}

// 全屏语音通话界面：识别（浏览器 STT）→ 对话模型 → MiniMax TTS 循环
export default function VoiceCall({ theme, onClose, audioKit }) {
  const {
    apiKey, apiBaseUrl, model, systemPrompt, workerUrl, useWorkerProxy,
    ttsApiKey, ttsGroupId, ttsVoiceId,
    aiName, aiAvatar,
    sessions, currentSessionId, providers, selectedProviderId,
  } = useStore()
  const { status, userCaption, aiCaption, error, seconds, muted, startCall, endCall, toggleMute } = useVoiceCall()
  const startedRef = useRef(false)

  const session = sessions?.find(s => s.id === (currentSessionId || 'main'))
  const provider = providers?.find(p => p.id === selectedProviderId)
  const name = session?.aiName || aiName || '小满'
  const avatar = session?.aiAvatar || aiAvatar || ''

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    // 配置解析与 useChat 一致：会话 > 供应商 > 全局
    startCall({
      sessionId: currentSessionId || 'main',
      audioKit,
      apiKey: session?.apiKey || provider?.apiKey || apiKey,
      baseUrl: session?.baseUrl || provider?.baseUrl || apiBaseUrl,
      model: session?.model || model,
      providerName: session?.providerName || '',
      systemPrompt: session?.systemPrompt !== undefined ? (session.systemPrompt || systemPrompt) : systemPrompt,
      workerUrl, useWorkerProxy,
      ttsApiKey: session?.ttsApiKey || ttsApiKey,
      ttsGroupId: session?.ttsGroupId || ttsGroupId,
      ttsVoiceId: session?.ttsVoiceId || ttsVoiceId || 'English_Trustworthy_Man',
      ttsModel: session?.ttsModel || 'speech-2.6-hd',
    })
    return () => endCall()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleHangup = () => {
    endCall()
    onClose()
  }

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const primary = theme?.primary || '#ff85b3'
  const active = status === 'listening' || status === 'speaking'

  return (
    <div
      className="fixed inset-0 flex flex-col items-center"
      style={{ zIndex: 60, background: 'linear-gradient(165deg, #fce4ec 0%, #f8bbd0 30%, #ffeef5 70%, #fff0f6 100%)' }}
    >
      <style>{`
        @keyframes call-pulse {
          0% { transform: scale(1); opacity: .55; }
          100% { transform: scale(1.55); opacity: 0; }
        }
      `}</style>

      {/* 顶部：名字 + 时长 */}
      <div className="flex flex-col items-center" style={{ marginTop: 'max(64px, env(safe-area-inset-top, 0px) + 48px)' }}>
        <span className="font-semibold" style={{ fontSize: 22, color: '#8b5060' }}>{name}</span>
        <span className="text-xs mt-1" style={{ color: '#c47a8a' }}>语音通话 · {fmt(seconds)}</span>
      </div>

      {/* 头像 + 状态光环 */}
      <div className="flex-1 flex flex-col items-center justify-center" style={{ minHeight: 0 }}>
        <div style={{ position: 'relative', width: 132, height: 132 }}>
          {active && [0, 0.6].map(delay => (
            <div key={delay} style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: `2.5px solid ${status === 'speaking' ? primary : '#7fd4a8'}`,
              animation: 'call-pulse 1.8s ease-out infinite',
              animationDelay: `${delay}s`,
            }} />
          ))}
          <div style={{
            width: 132, height: 132, borderRadius: '50%', overflow: 'hidden',
            background: 'rgba(255,255,255,0.75)',
            border: '4px solid rgba(255,255,255,0.9)',
            boxShadow: `0 12px 40px ${primary}55`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 56,
          }}>
            {avatar ? <img src={avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : '🌸'}
          </div>
        </div>

        <span className="mt-5 text-sm font-medium" style={{ color: '#a86b7c' }}>
          {STATUS_TEXT[status] || ''}
        </span>

        {/* 字幕区 */}
        <div className="px-8 mt-6 w-full max-w-sm" style={{ minHeight: 96 }}>
          {userCaption && (
            <p className="text-sm text-right mb-3" style={{ color: '#b08794', lineHeight: 1.6 }}>
              {userCaption}
            </p>
          )}
          {aiCaption && (
            <p className="text-sm" style={{ color: '#8b5060', lineHeight: 1.7 }}>
              {aiCaption}
            </p>
          )}
          {error && (
            <p className="text-sm text-center" style={{ color: '#e07070' }}>{error}</p>
          )}
        </div>
      </div>

      {/* 底部按钮 */}
      <div className="flex items-center justify-center gap-12" style={{ marginBottom: 'max(56px, env(safe-area-inset-bottom, 0px) + 40px)' }}>
        <div className="flex flex-col items-center gap-2">
          <button
            onClick={toggleMute}
            style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: muted ? '#8b5060' : 'rgba(255,255,255,0.75)',
              color: muted ? '#fff' : '#8b5060',
              boxShadow: '0 6px 20px rgba(139,80,96,0.2)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            {muted ? <MicOff size={26} /> : <Mic size={26} />}
          </button>
          <span className="text-xs" style={{ color: '#a86b7c' }}>{muted ? '取消静音' : '静音'}</span>
        </div>

        <div className="flex flex-col items-center gap-2">
          <button
            onClick={handleHangup}
            style={{
              width: 64, height: 64, borderRadius: '50%', border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #ff6b6b, #e05555)',
              color: '#fff',
              boxShadow: '0 6px 24px rgba(224,85,85,0.45)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <PhoneOff size={26} />
          </button>
          <span className="text-xs" style={{ color: '#a86b7c' }}>挂断</span>
        </div>
      </div>
    </div>
  )
}
