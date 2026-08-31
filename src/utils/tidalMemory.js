export const EMPTY_ROLLING_SUMMARY = [
  '关系与身份连续性：',
  '重要情绪与互动状态：',
  '明确事实和约定：',
  '正在进行的事情：',
  '待办：',
  '用户偏好：',
].join('\n')

// Blank per-layer templates for the "清空重写" action — headers only, no
// '无' placeholder text, so the user can type straight into an empty body.
export const EMPTY_LONG_TERM_TEXT = ['关系与身份连续性：', '明确事实和约定：', '用户偏好：'].join('\n')
export const EMPTY_RECENT_TEXT = ['重要情绪与互动状态：', '正在进行的事情：', '待办：'].join('\n')

const SUMMARY_FIELDS = [
  ['relationshipIdentity', '关系与身份连续性'],
  ['emotionInteraction', '重要情绪与互动状态'],
  ['factsCommitments', '明确事实和约定'],
  ['ongoing', '正在进行的事情'],
  ['todos', '待办'],
  ['preferences', '用户偏好'],
]

export function parseTidalSummary(text = '') {
  const normalized = String(text).replace(/\r\n?/g, '\n').trim()
  const positions = SUMMARY_FIELDS.map(([, label]) => {
    const match = new RegExp(`(?:^|\\n)${label}[：:]`).exec(normalized)
    return match ? {
      start: match.index + (match[0].startsWith('\n') ? 1 : 0),
      bodyStart: match.index + match[0].length,
    } : null
  })
  if (positions.some((position) => !position)) return null
  if (positions.some((position, index) => index > 0 && position.start <= positions[index - 1].start)) return null
  const fields = {}
  SUMMARY_FIELDS.forEach(([key], index) => {
    fields[key] = normalized.slice(positions[index].bodyStart, positions[index + 1]?.start ?? normalized.length).trim()
  })
  return fields
}

export function renderTidalSummary(fields) {
  return SUMMARY_FIELDS.map(([key, label]) => `${label}：${fields?.[key] || '无'}`).join('\n')
}

export function renderTidalLongTerm(fields) {
  return [
    `关系与身份连续性：${fields?.relationshipIdentity || '无'}`,
    `明确事实和约定：${fields?.factsCommitments || '无'}`,
    `用户偏好：${fields?.preferences || '无'}`,
  ].join('\n')
}

export function renderTidalRecent(fields) {
  return [
    `重要情绪与互动状态：${fields?.emotionInteraction || '无'}`,
    `正在进行的事情：${fields?.ongoing || '无'}`,
    `待办：${fields?.todos || '无'}`,
  ].join('\n')
}

export function mergeTidalLayers(longTermText, recentText) {
  const extract = (text, labels) => {
    const normalized = String(text).replace(/\r\n?/g, '\n').trim()
    const out = {}
    for (let index = 0; index < labels.length; index += 1) {
      const [key, label] = labels[index]
      const start = new RegExp(`(?:^|\\n)${label}[：:]`).exec(normalized)
      if (!start) return null
      const bodyStart = start.index + start[0].length
      const nextLabel = labels[index + 1]?.[1]
      const tail = normalized.slice(bodyStart)
      const next = nextLabel ? new RegExp(`\\n${nextLabel}[：:]`).exec(tail) : null
      out[key] = tail.slice(0, next?.index ?? tail.length).trim()
    }
    return out
  }
  const longTerm = extract(longTermText, [SUMMARY_FIELDS[0], SUMMARY_FIELDS[2], SUMMARY_FIELDS[5]])
  const recent = extract(recentText, [SUMMARY_FIELDS[1], SUMMARY_FIELDS[3], SUMMARY_FIELDS[4]])
  return longTerm && recent ? renderTidalSummary({ ...longTerm, ...recent }) : null
}

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
