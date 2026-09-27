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

  const copy = companionProgressCopy(progress, aiName)
  const elapsed = formatProgressElapsed(now - (progress.startedAt || now))

  return (
    <div role="status" aria-live="polite" style={{ minWidth: 0, flex: 1, color: theme?.aiBubbleText || '#6f8068', textShadow: '0 1px 2px rgba(255,255,255,0.75)' }}>
      <div style={{ fontSize: 11, lineHeight: 1.3, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {copy.title}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, fontSize: 10, lineHeight: 1.3, opacity: .75 }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{copy.detail}</span>
        <span aria-hidden="true" style={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>· {elapsed}</span>
      </div>
    </div>
  )
}

export default memo(CompanionProgressBar)
