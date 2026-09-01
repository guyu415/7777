const DIRECT_HEALTH_TOOLS = new Set([
  'get_heart_rate',
  'get_watch_data',
  'health_current_context',
  'health_latest',
  'health_query',
  'health_summary',
  'health_workouts',
  'health_ecg',
  'health_capabilities',
  'health_sync_status',
])

const HEALTH_METRICS = [
  { id: 'heart-rate', label: '心率', pattern: /heart[\s_-]*rate|heartrate|心率|bpm|count\s*[\/_／]\s*min/i },
  { id: 'blood-oxygen', label: '血氧', pattern: /oxygen[\s_-]*saturation|blood[\s_-]*oxygen|血氧|spo2/i },
  { id: 'respiratory-rate', label: '呼吸率', pattern: /respiratory[\s_-]*rate|breathing[\s_-]*rate|呼吸率/i },
  { id: 'body-temperature', label: '体温', pattern: /body[\s_-]*temperature|wrist[\s_-]*temperature|temperature|体温/i },
  { id: 'steps', label: '步数', pattern: /step[\s_-]*count|\bsteps?\b|步数/i },
  { id: 'active-energy', label: '活动能量', pattern: /active[\s_-]*energy|activecalories|活动能量|活动卡路里/i },
  { id: 'sleep', label: '睡眠', pattern: /sleep[\s_-]*(analysis|stage|session)?|睡眠/i },
  { id: 'workout', label: '锻炼', pattern: /workout|exercise|锻炼|训练|运动记录/i },
  { id: 'ecg', label: '心电图', pattern: /\becg\b|electrocardiogram|心电图/i },
  { id: 'sync-status', label: '同步状态', pattern: /sync[\s_-]*status|同步状态/i },
  { id: 'capabilities', label: '可用数据', pattern: /capabilities|可用.*(?:数据|指标)|支持.*(?:数据|指标)/i },
]

function normalizedToolName(tool = '') {
  const raw = String(tool).trim()
  return raw.startsWith('mcp__') ? (raw.split('__').pop() || raw) : raw
}

export function isHealthTool(tool = '') {
  const name = normalizedToolName(tool).toLowerCase()
  return DIRECT_HEALTH_TOOLS.has(name) || /(?:^|_)(?:apple_)?health(?:_|$)|heart[_-]?rate|watch[_-]?(?:data|health)/.test(name)
}

/**
 * Returns each requested/returned Health metric once, in a stable display
 * order.  Generic reads intentionally remain generic until a real metric is
 * present in their arguments or reply; that prevents a blood-oxygen read
 * from being labelled as heart rate merely because it came from Apple Watch.
 */
export function healthDataCategories(toolUses = [], content = '') {
  const source = [
    ...toolUses.filter((item) => isHealthTool(item?.tool)).map((item) => `${item.tool || ''} ${item.detail || ''}`),
    content,
  ].join('\n')
  const metrics = HEALTH_METRICS.filter((item) => item.pattern.test(source))
  if (metrics.length) return metrics

  const names = toolUses.map((item) => normalizedToolName(item?.tool).toLowerCase())
  if (names.includes('health_workouts')) return [HEALTH_METRICS.find((item) => item.id === 'workout')]
  if (names.includes('health_ecg')) return [HEALTH_METRICS.find((item) => item.id === 'ecg')]
  if (names.includes('health_sync_status')) return [HEALTH_METRICS.find((item) => item.id === 'sync-status')]
  if (names.includes('health_capabilities')) return [HEALTH_METRICS.find((item) => item.id === 'capabilities')]
  return [{ id: 'health-data', label: '健康数据' }]
}
