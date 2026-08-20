import { useEffect, useRef } from 'react'
import { Mic, MicOff, PhoneOff } from 'lucide-react'
import { useStore } from '../../store'
import { useVoiceCall } from '../../hooks/useVoiceCall'

const STATUS_TEXT = {
  listening: '在听你说…',
  recognizing: '正在识别…',
  thinking: '想想怎么回…',
  speaking: '正在说话',
  muted: '已静音',
  paused: '已暂停（回到通话界面自动继续）',
  idle: '连接中…',
}

// 全屏语音通话界面：本地 SenseVoice / 系统 STT → 对话模型 → MiniMax TTS 循环
export default function VoiceCall({ theme, onClose, audioKit }) {
  const {
    apiKey, apiBaseUrl, model, systemPrompt, workerUrl, useWorkerProxy,
    ttsApiKey, ttsGroupId, ttsVoiceId,
    aiName, aiAvatar,
    sessions, currentSessionId, providers, selectedProviderId,
  } = useStore()
  const {
    status, userCaption, aiCaption, error, seconds, muted,
    voiceEmotionLabel, voiceAcousticsLabel, speechEngine, modelStatus, modelProgress, modelFallbackReason,
    startCall, endCall, toggleMute,
  } = useVoiceCall()
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
      // Codex's prompt is thread-scoped and must match useCodexChat exactly;
      // falling back to the global API prompt here would silently rewrite
      // the persistent Codex thread's persona when a call starts.
      systemPrompt: session?.providerName === 'codex-vps'
        ? (session?.systemPrompt || '')
        : session?.systemPrompt !== undefined ? (session.systemPrompt || systemPrompt) : systemPrompt,
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
        <span className="mt-1 text-xs" style={{ color: '#bd8796' }}>
          {modelStatus === 'loading'
            ? `本地语音模型准备中${modelProgress ? ` ${modelProgress}%` : ''} · 暂用系统识别`
            : speechEngine === 'cloud'
              ? 'SenseVoice + openSMILE 云端识别'
            : speechEngine === 'local'
              ? 'SenseVoice 本地识别 · 音频不上传'
              : modelStatus === 'ready'
                ? 'SenseVoice 已就绪 · 下轮切换本地识别'
                : modelFallbackReason === 'ios-memory'
                  ? 'iPhone 内存限制 · 使用系统识别'
                  : '系统语音识别'}
        </span>

        {/* 字幕区 */}
        <div className="px-8 mt-6 w-full max-w-sm" style={{ minHeight: 96 }}>
          {userCaption && (
            <div className="text-right mb-3">
              <p className="text-sm" style={{ color: '#b08794', lineHeight: 1.6 }}>{userCaption}</p>
              {voiceEmotionLabel && (
                <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs" style={{ color: '#a9687c', background: 'rgba(255,255,255,.55)' }}>
                  语气：{voiceEmotionLabel}
                </span>
              )}
              {voiceAcousticsLabel && (
                <p className="mt-1 text-xs" style={{ color: '#a9687c', lineHeight: 1.5 }}>
                  声学：{voiceAcousticsLabel}
                </p>
              )}
            </div>
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
