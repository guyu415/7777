import { memo, useEffect, useState } from 'react'

const TOOL_LABELS = {
  Bash: '执行命令',
  Read: '读取文件',
  Write: '写入文件',
  Edit: '修改文件',
  Glob: '查找文件',
  Grep: '搜索内容',
  WebSearch: '搜索资料',
  WebFetch: '读取网页',
  Task: '调用助手',
}

export function companionProgressCopy(progress, aiName = 'Claude') {
  const name = aiName || 'Claude'
  switch (progress?.phase) {
    case 'sending':
      return { title: '正在发送消息', detail: progress.detail || '正在送到常驻会话' }
    case 'accepted':
      return { title: '消息已送达', detail: progress.detail || `正在等待 ${name} 开始处理` }
    case 'thinking':
      return { title: `${name}正在思考`, detail: progress.detail || '正在组织回复' }
    case 'working': {
      const action = TOOL_LABELS[progress.tool] || (progress.tool ? `使用 ${progress.tool}` : '处理任务')
      return { title: `${name}正在${action}`, detail: progress.detail || '任务仍在继续' }
    }
    case 'continuing':
      return { title: '已经回了一条，还没结束', detail: progress.detail || `${name} 仍在继续处理` }
    case 'reconnecting':
      return { title: '连接波动，正在恢复', detail: progress.detail || '不会新建会话，请稍候' }
    case 'connecting':
    default:
      return { title: '正在连接常驻会话', detail: progress?.detail || '消息已进入发送流程' }
  }
}

export function formatProgressElapsed(elapsedMs) {
  const totalSeconds = Math.max(0, Math.floor((Number(elapsedMs) || 0) / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : `${seconds}秒`
}

function CompanionProgressBar({ progress, theme, aiName }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [progress?.startedAt])

  if (!progress) return null

  const primary = theme?.primary || '#c47a8a'
  const textColor = theme?.aiBubbleText || '#5f655a'
  const copy = companionProgressCopy(progress, aiName)
  const elapsed = formatProgressElapsed(now - (progress.startedAt || now))

  return (
    <div className="px-3 pt-1 pb-1.5" style={{ pointerEvents: 'none' }}>
      <style>{`
        @keyframes companionProgressPulse{0%,100%{transform:scale(.78);opacity:.55}50%{transform:scale(1.2);opacity:1}}
        @keyframes companionProgressSweep{0%{transform:translateX(-115%)}100%{transform:translateX(315%)}}
      `}</style>
      <div
        role="status"
        aria-live="polite"
        aria-label={`${copy.title}，${copy.detail}`}
        style={{
          position: 'relative', overflow: 'hidden', minHeight: 52,
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 11px 9px', borderRadius: 17,
          color: textColor,
          background: 'linear-gradient(115deg,rgba(255,255,255,.94),rgba(255,248,251,.86))',
          border: `1.5px solid ${primary}70`,
          boxShadow: `0 7px 24px ${primary}2f, inset 0 1px 0 rgba(255,255,255,.92)`,
          backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
        }}
      >
        <div style={{
          position: 'relative', width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          display: 'grid', placeItems: 'center',
          background: `${primary}16`, border: `1px solid ${primary}42`,
        }}>
          <span style={{
            position: 'absolute', width: 18, height: 18, borderRadius: '50%',
            background: `${primary}24`, animation: 'companionProgressPulse 1.35s ease-in-out infinite',
          }} />
          <span style={{ position: 'relative', width: 9, height: 9, borderRadius: '50%', background: primary, boxShadow: `0 0 0 3px ${primary}20` }} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, lineHeight: 1.25, fontWeight: 750, letterSpacing: '.01em' }}>{copy.title}</div>
          <div style={{ marginTop: 3, fontSize: 10.5, lineHeight: 1.25, opacity: .72, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{copy.detail}</div>
        </div>

        <div aria-hidden="true" style={{ flexShrink: 0, minWidth: 51, textAlign: 'right' }}>
          <div style={{ fontSize: 9.5, lineHeight: 1, opacity: .58 }}>已等待</div>
          <div style={{ marginTop: 4, fontSize: 13, lineHeight: 1, fontWeight: 760, fontVariantNumeric: 'tabular-nums', color: primary }}>{elapsed}</div>
        </div>

        <span aria-hidden="true" style={{
          position: 'absolute', left: 0, bottom: 0, width: '36%', height: 2,
          borderRadius: 2, background: `linear-gradient(90deg,transparent,${primary},transparent)`,
          animation: 'companionProgressSweep 1.8s ease-in-out infinite', opacity: .8,
        }} />
      </div>
    </div>
  )
}

export default memo(CompanionProgressBar)
