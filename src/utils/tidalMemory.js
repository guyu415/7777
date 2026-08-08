export const EMPTY_ROLLING_SUMMARY = [
  '关系与身份连续性：',
  '重要情绪与互动状态：',
  '明确事实和约定：',
  '正在进行的事情：',
  '待办：',
  '用户偏好：',
].join('\n')

export function tidalStatusPresentation(tide) {
  switch (tide?.status) {
    case 'success': return { label: '成功', color: '#3b9f68', background: 'rgba(59,159,104,0.11)' }
    case 'retry_wait': return { label: '等待重试', color: '#b87920', background: 'rgba(224,164,72,0.13)' }
    case 'failed': return { label: '失败', color: '#d05f67', background: 'rgba(208,95,103,0.11)' }
    case 'running': return { label: '整理中', color: '#4a7fc1', background: 'rgba(74,127,193,0.11)' }
    default: return { label: '尚未整理', color: '#8299b2', background: 'rgba(130,153,178,0.11)' }
  }
}

export function formatTidalTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

export function formatTidalCoverage(coverage) {
  if (!coverage) return '尚未形成覆盖边界'
  const at = formatTidalTime(coverage.boundaryTs)
  const id = typeof coverage.boundaryId === 'string' ? coverage.boundaryId.slice(-10) : ''
  return `${at}${id ? ` · 消息 …${id}` : ''}`
}
