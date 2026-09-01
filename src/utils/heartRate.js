const HEART_RATE_MIN = 30
const HEART_RATE_MAX = 240

const DIRECT_HEART_TOOLS = new Set([
  'get_heart_rate',
  'get_watch_data',
])

function normalizedToolName(tool = '') {
  const raw = String(tool).trim()
  return raw.startsWith('mcp__') ? (raw.split('__').pop() || raw) : raw
}

function validBpm(value) {
  const bpm = Math.round(Number(value))
  return Number.isFinite(bpm) && bpm >= HEART_RATE_MIN && bpm <= HEART_RATE_MAX
    ? bpm
    : null
}

/**
 * Identifies explicit heart-rate reads. Generic Apple Health reads only
 * qualify once their visible arguments request heart rate, so a blood-oxygen
 * or step query never briefly masquerades as a heart-rate read.
 */
export function isHeartRateTool(tool, detail = '') {
  const name = normalizedToolName(tool).toLowerCase()
  if (DIRECT_HEART_TOOLS.has(name)) return true
  if (/heart[_-]?rate|watch[_-]?(?:data|health)/.test(name)) return true
  if (/^health_(?:current_context|latest|query|summary)$/.test(name)) {
    return /heart.?rate|心率|hkquantitytypeidentifierheartrate/i.test(String(detail))
  }
  return false
}

/**
 * Pulls a BPM value out of the companion's natural-language reply or the
 * JSON it may quote. The patterns deliberately require heart-rate wording or
 * a BPM/count-per-minute unit; an unrelated step count or timestamp can never
 * become the animated value.
 */
export function extractHeartRate(content) {
  if (typeof content !== 'string' || !content.trim()) return null

  const patterns = [
    /(?:当前|实时|最近(?:一次)?|最新)?\s*(?:心率|heart[\s_-]*rate)[^\d]{0,36}(\d{2,3}(?:\.\d+)?)/i,
    /(?:"?(?:heart[\s_-]*rate|bpm)"?\s*[:=]\s*"?)(\d{2,3}(?:\.\d+)?)/i,
    /(\d{2,3}(?:\.\d+)?)\s*(?:bpm|次\s*[\/／]\s*分(?:钟)?|count\s*[\/／]\s*min(?:ute)?)/i,
    /HKQuantityTypeIdentifierHeartRate[\s\S]{0,180}?"?(?:value|quantity)"?\s*[:=]\s*"?(\d{2,3}(?:\.\d+)?)/i,
  ]

  for (const pattern of patterns) {
    const match = content.match(pattern)
    const bpm = validBpm(match?.[1])
    if (bpm !== null) return bpm
  }
  return null
}

export function heartBeatDurationMs(bpm) {
  const safeBpm = validBpm(bpm) || 72
  return Math.round(60_000 / safeBpm)
}

