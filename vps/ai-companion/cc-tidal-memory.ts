import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export type VisibleCcMessage = {
  id: string
  from: 'user' | 'cc'
  text: string
  ts: number
  turnId?: string
}

export type QueuedCcMessage = {
  id: string
  text: string
  kind?: 'message' | 'poke' | 'poke_settings'
  userName?: string
  aiName?: string
  before?: string
  after?: string
  imagePath?: string
  filePath?: string
  fileName?: string
  fileSize?: number
  fileType?: string
  callMode?: boolean
  clientTime?: unknown
  voiceEmotion?: string
  voiceAcoustics?: unknown
  queuedAt: number
}

export type RollingSummary = {
  relationshipIdentity: string
  emotionInteraction: string
  factsCommitments: string
  ongoing: string
  todos: string
  preferences: string
}

export type SubjectiveCheckpoint = {
  continuityBridge: string
}

export type TidalBoundaryOption = {
  boundaryId: string
  boundaryTs: number
  sourceCount: number
  preservedCount: number
  preservedTokens: number
  boundaryPreview: string
}

export type TidalReviewMode = 'ask' | 'reask' | 'force'

export type TidalReviewDeferral = {
  baselinePercent: number
  reasked: boolean
}

export type TidalPhase =
  | 'reviewing'
  | 'summarizing'
  | 'summary_ready'
  | 'compact_sending'
  | 'compacted'
  | 'recovery_sending'
  | 'recovering'

export type TidalPending = {
  taskId: string
  phase: TidalPhase
  triggerReason: 'tokens' | 'visible_messages' | 'tokens+visible_messages' | 'retry_recovery'
  boundaryId: string
  boundaryTs: number
  sourceCount: number
  summary?: RollingSummary
  summaryProvider?: 'luna' | 'fallback'
  contextTokens: number
  compactStartedAt?: number
  compactConfirmedAt?: number
  recoveryMarker?: string
  recoveryInjectedAt?: number
  baseSummaryRevision?: number
  boundaryOptions?: TidalBoundaryOption[]
  proposedBoundaryId?: string
  subjectiveCheckpoint?: SubjectiveCheckpoint
  reviewedAt?: number
  reviewDeferred?: boolean
  reviewMode?: TidalReviewMode
  reviewContextPercent?: number
  sourceStartId?: string
}

export type TidalLastRun = {
  status: 'success' | 'retry_wait' | 'failed'
  stage: string
  at: number
  retryAt?: number | null
  model?: string | null
}

export type TidalState = {
  version: 1
  sessionId: string
  rollingSummary: RollingSummary | null
  processedBoundaryId: string | null
  processedBoundaryTs: number | null
  pending: TidalPending | null
  queue: QueuedCcMessage[]
  retryAt: number | null
  lastContextTokens: number | null
  summaryRevision: number
  summaryUpdatedAt: number | null
  summaryModel: string | null
  summarySource: 'automatic' | 'manual' | 'legacy' | null
  progressiveCoverage: boolean
  subjectiveCheckpoint: SubjectiveCheckpoint | null
  checkpointUpdatedAt: number | null
  reviewDeferral: TidalReviewDeferral | null
  lastRun: TidalLastRun | null
  updatedAt: number
}

export type TidalPublicStatus = {
  status: 'idle' | 'running' | 'success' | 'retry_wait' | 'failed'
  stage: string
  at: number | null
  retryAt: number | null
}

export type TidalConfig = {
  tokenThreshold: number
  visibleThreshold: number
  /** Desired exact-text suffix after a tide. This is a token target, not a fixed message window. */
  rawTargetTokens: number
  /** Main CC may move the boundary earlier while the exact suffix remains under this hard limit. */
  rawMaxTokens: number
  recoveryTokenBudget: number
  retryMs: number
}

export const DEFAULT_TIDAL_CONFIG: TidalConfig = {
  // Production CC now has a 1M window. Keep the resident chat below the
  // expensive upper half while leaving ample headroom before CC's native
  // ~980k compaction boundary.
  tokenThreshold: 450_000,
  // Fallback only when Claude exposes no trustworthy token waterline.
  visibleThreshold: 240,
  rawTargetTokens: 180_000,
  rawMaxTokens: 240_000,
  recoveryTokenBudget: 260_000,
  retryMs: 5 * 60_000,
}

/**
 * Keep the 1M resident profile by default, but scale back to the proven 200k
 * profile when the user switches this same long-lived session to a smaller
 * context model. The caps also make environment overrides unable to produce
 * a recovery packet larger than the active model can accept.
 */
export function tidalConfigForWindow(
  config: TidalConfig,
  contextWindowSize: number | null,
): TidalConfig {
  const size = Number(contextWindowSize)
  if (!Number.isFinite(size) || size <= 0 || size >= 500_000) return { ...config }
  return {
    tokenThreshold: Math.min(config.tokenThreshold, Math.floor(size * 0.70)),
    visibleThreshold: config.visibleThreshold,
    rawTargetTokens: Math.min(config.rawTargetTokens, Math.floor(size * 0.28)),
    rawMaxTokens: Math.min(config.rawMaxTokens, Math.floor(size * 0.35)),
    recoveryTokenBudget: Math.min(config.recoveryTokenBudget, Math.floor(size * 0.41)),
    retryMs: config.retryMs,
  }
}

export function createTidalState(sessionId: string, now = Date.now()): TidalState {
  return {
    version: 1,
    sessionId,
    rollingSummary: null,
    processedBoundaryId: null,
    processedBoundaryTs: null,
    pending: null,
    queue: [],
    retryAt: null,
    lastContextTokens: null,
    summaryRevision: 0,
    summaryUpdatedAt: null,
    summaryModel: null,
    summarySource: null,
    progressiveCoverage: false,
    subjectiveCheckpoint: null,
    checkpointUpdatedAt: null,
    reviewDeferral: null,
    lastRun: null,
    updatedAt: now,
  }
}

export function validateSubjectiveCheckpoint(value: unknown): SubjectiveCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const continuityBridge = String((value as any).continuityBridge ?? '').trim()
  if (!continuityBridge || continuityBridge.length > 600) return null
  return { continuityBridge }
}

export function renderSubjectiveCheckpoint(checkpoint: SubjectiveCheckpoint | null): string {
  return checkpoint?.continuityBridge ?? ''
}

export function tidalReviewMode(
  currentPercent: number | null,
  deferral: TidalReviewDeferral | null,
): 'wait' | TidalReviewMode {
  if (!deferral) return 'ask'
  if (currentPercent === null || !Number.isFinite(currentPercent)) return 'wait'
  const growth = currentPercent - deferral.baselinePercent
  if (growth >= 10) return 'force'
  if (growth >= 5 && !deferral.reasked) return 'reask'
  return 'wait'
}

function finiteNonNegative(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/**
 * Reads only the input-side usage from a stream-json message_start event.
 * A result event is deliberately ignored: result.usage is cumulative across
 * every model call in the whole turn and therefore is not a context waterline.
 */
export function inputTokensFromMessageStart(event: unknown): number | null {
  const raw = event as any
  const messageStart = raw?.type === 'stream_event' && raw?.event?.type === 'message_start'
    ? raw.event
    : raw?.type === 'message_start'
      ? raw
      : null
  if (!messageStart) return null
  const usage = messageStart?.message?.usage
  if (!usage || typeof usage !== 'object') return null
  return finiteNonNegative(usage.input_tokens)
    + finiteNonNegative(usage.cache_creation_input_tokens)
    + finiteNonNegative(usage.cache_read_input_tokens)
}

/**
 * Claude's persisted assistant message.usage is the finalized copy of the
 * same input-side usage first emitted by stream-json message_start. Convert it
 * to that event shape so production and tests share exactly one parser.
 */
export function latestInputTokensFromTranscript(transcriptPath: string): number | null {
  if (!existsSync(transcriptPath)) return null
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return null
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue
    let row: any
    try { row = JSON.parse(lines[i]) } catch { continue }
    if (row?.type !== 'assistant' || !row?.message?.usage) continue
    const tokens = inputTokensFromMessageStart({ type: 'message_start', message: { usage: row.message.usage } })
    // Claude occasionally appends a synthetic all-zero assistant record after
    // a rate-limit/status event. It is not an API message_start and must not
    // erase the last real waterline.
    if (tokens !== null && tokens > 0) return tokens
  }
  return null
}

/**
 * The first real input waterline is the best available low-water mark after
 * a full `/clear`. It lets a newly deployed checker recover a missed baseline
 * without pretending that the fixed system/tool prompt can be reclaimed.
 */
export function firstInputTokensFromTranscript(transcriptPath: string): number | null {
  if (!existsSync(transcriptPath)) return null
  let lines: string[]
  try {
    lines = readFileSync(transcriptPath, 'utf8').split('\n')
  } catch {
    return null
  }
  for (const line of lines) {
    if (!line) continue
    let row: any
    try { row = JSON.parse(line) } catch { continue }
    if (row?.type !== 'assistant' || !row?.message?.usage) continue
    const tokens = inputTokensFromMessageStart({ type: 'message_start', message: { usage: row.message.usage } })
    if (tokens !== null && tokens > 0) return tokens
  }
  return null
}

export function unprocessedVisibleMessages(
  history: VisibleCcMessage[],
  processedBoundaryId: string | null,
): VisibleCcMessage[] {
  if (!processedBoundaryId) return history.filter(isVisibleMessage)
  const boundaryIndex = history.findIndex((m) => m.id === processedBoundaryId)
  if (boundaryIndex < 0) return history.filter(isVisibleMessage)
  return history.slice(boundaryIndex + 1).filter(isVisibleMessage)
}

/** One-time bridge from the old fixed 16-message recovery window. */
export function progressiveVisibleMessages(
  history: VisibleCcMessage[],
  processedBoundaryId: string | null,
  hasSubjectiveCheckpoint: boolean,
  legacyOverlap = 16,
): VisibleCcMessage[] {
  const visible = history.filter(isVisibleMessage)
  if (!processedBoundaryId || hasSubjectiveCheckpoint) {
    return unprocessedVisibleMessages(visible, processedBoundaryId)
  }
  const boundaryIndex = visible.findIndex((message) => message.id === processedBoundaryId)
  if (boundaryIndex < 0) return visible
  return visible.slice(Math.max(0, boundaryIndex - Math.max(0, legacyOverlap - 1)))
}

function isVisibleMessage(message: VisibleCcMessage): boolean {
  return (message.from === 'user' || message.from === 'cc')
    && typeof message.text === 'string'
    && message.text.trim().length > 0
}

export function tidalTrigger(
  contextTokens: number | null,
  visibleCount: number,
  config: TidalConfig = DEFAULT_TIDAL_CONFIG,
  forceRetry = false,
): { trigger: boolean; reason: TidalPending['triggerReason'] | null } {
  const byTokens = contextTokens !== null && contextTokens >= config.tokenThreshold
  const byVisible = contextTokens === null && visibleCount >= config.visibleThreshold
  if (!byTokens && !byVisible && forceRetry && visibleCount > 0) {
    return { trigger: true, reason: 'retry_recovery' }
  }
  return {
    trigger: byTokens || byVisible,
    reason: byTokens ? 'tokens' : byVisible ? 'visible_messages' : null,
  }
}

export function validateRollingSummary(value: unknown): RollingSummary | null {
  if (!value || typeof value !== 'object') return null
  const keys: Array<keyof RollingSummary> = [
    'relationshipIdentity',
    'emotionInteraction',
    'factsCommitments',
    'ongoing',
    'todos',
    'preferences',
  ]
  const out = {} as RollingSummary
  for (const key of keys) {
    const text = String((value as any)[key] ?? '').trim()
    if (!text || text.length > 1_200) return null
    out[key] = text
  }
  const total = keys.reduce((n, key) => n + out[key].length, 0)
  if (total > 5_000) return null
  // Keep both layers bounded independently. This prevents either the durable
  // relationship record or one intense recent episode from consuming the
  // whole recovery packet.
  const durableTotal = out.relationshipIdentity.length + out.factsCommitments.length + out.preferences.length
  const recentTotal = out.emotionInteraction.length + out.ongoing.length + out.todos.length
  if (durableTotal > 2_600 || recentTotal > 2_400) return null
  return out
}

export function renderLongTermSummary(summary: RollingSummary | null): string {
  if (!summary) return '（尚无长期关系基线）'
  return [
    `关系与身份连续性：${summary.relationshipIdentity}`,
    `明确事实和约定：${summary.factsCommitments}`,
    `用户偏好：${summary.preferences}`,
  ].join('\n')
}

export function renderRecentSummary(summary: RollingSummary | null): string {
  if (!summary) return '（尚无近期状态摘要）'
  return [
    `重要情绪与互动状态：${summary.emotionInteraction}`,
    `正在进行的事情：${summary.ongoing}`,
    `待办：${summary.todos}`,
  ].join('\n')
}

export function recentSummaryChars(summary: RollingSummary): number {
  return summary.emotionInteraction.length + summary.ongoing.length + summary.todos.length
}

export function minimumRecentSummaryChars(sourceCount: number): number {
  if (sourceCount >= 180) return 700
  if (sourceCount >= 80) return 500
  if (sourceCount >= 30) return 300
  return 0
}

export function renderRollingSummary(summary: RollingSummary | null): string {
  if (!summary) return '（尚无滚动对话摘要）'
  return [
    `关系与身份连续性：${summary.relationshipIdentity}`,
    `重要情绪与互动状态：${summary.emotionInteraction}`,
    `明确事实和约定：${summary.factsCommitments}`,
    `正在进行的事情：${summary.ongoing}`,
    `待办：${summary.todos}`,
    `用户偏好：${summary.preferences}`,
  ].join('\n')
}

const ROLLING_SUMMARY_LABELS: Array<[keyof RollingSummary, string]> = [
  ['relationshipIdentity', '关系与身份连续性'],
  ['emotionInteraction', '重要情绪与互动状态'],
  ['factsCommitments', '明确事实和约定'],
  ['ongoing', '正在进行的事情'],
  ['todos', '待办'],
  ['preferences', '用户偏好'],
]

export function parseRollingSummaryText(value: unknown): RollingSummary | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\r\n?/g, '\n').trim()
  if (!text || text.length > 8_000) return null
  const positions = ROLLING_SUMMARY_LABELS.map(([, label]) => {
    const match = new RegExp(`(?:^|\\n)${label}[：:]`).exec(text)
    return match ? { start: match.index + (match[0].startsWith('\n') ? 1 : 0), bodyStart: match.index + match[0].length } : null
  })
  if (positions.some((position) => !position)) return null
  for (let i = 1; i < positions.length; i++) {
    if (positions[i]!.start <= positions[i - 1]!.start) return null
  }
  const parsed = {} as RollingSummary
  for (let i = 0; i < ROLLING_SUMMARY_LABELS.length; i++) {
    const [key] = ROLLING_SUMMARY_LABELS[i]
    parsed[key] = text.slice(positions[i]!.bodyStart, positions[i + 1]?.start ?? text.length).trim()
  }
  return validateRollingSummary(parsed)
}

export function manualSummaryUpdateCandidate(
  state: TidalState,
  args: { sessionId: string; expectedRevision: number; summaryText: unknown; now?: number },
): { ok: true; state: TidalState } | { ok: false; code: 'session_mismatch' | 'version_conflict' | 'tidal_active' | 'invalid_summary' } {
  if (!args.sessionId || args.sessionId !== state.sessionId) return { ok: false, code: 'session_mismatch' }
  if (!Number.isInteger(args.expectedRevision) || args.expectedRevision !== state.summaryRevision) return { ok: false, code: 'version_conflict' }
  if (state.pending) return { ok: false, code: 'tidal_active' }
  const summary = parseRollingSummaryText(args.summaryText)
  if (!summary) return { ok: false, code: 'invalid_summary' }
  const now = args.now ?? Date.now()
  return {
    ok: true,
    state: {
      ...state,
      rollingSummary: summary,
      summaryRevision: state.summaryRevision + 1,
      summaryUpdatedAt: now,
      summaryModel: state.summaryModel ?? 'manual',
      summarySource: 'manual',
      updatedAt: now,
    },
  }
}

export function tidalStatusSnapshot(state: TidalState, now = Date.now()): TidalPublicStatus {
  if (state.pending) {
    if (state.retryAt && state.retryAt > now) {
      return { status: 'retry_wait', stage: state.lastRun?.stage ?? state.pending.phase, at: state.lastRun?.at ?? state.updatedAt, retryAt: state.retryAt }
    }
    return { status: 'running', stage: state.pending.phase, at: state.updatedAt, retryAt: state.retryAt }
  }
  if (state.retryAt && state.retryAt > now) {
    return { status: 'retry_wait', stage: state.lastRun?.stage ?? 'retry_scheduled', at: state.lastRun?.at ?? state.updatedAt, retryAt: state.retryAt }
  }
  if (state.lastRun) {
    return { status: state.lastRun.status, stage: state.lastRun.stage, at: state.lastRun.at, retryAt: state.lastRun.retryAt ?? null }
  }
  if (state.rollingSummary) {
    return { status: 'success', stage: 'existing_summary', at: state.summaryUpdatedAt ?? state.updatedAt, retryAt: null }
  }
  return { status: 'idle', stage: 'no_summary', at: null, retryAt: null }
}

export function summaryInput(
  previous: RollingSummary | null,
  messages: VisibleCcMessage[],
  longTermReference = '',
): string {
  const dialogue = messages
    .filter(isVisibleMessage)
    .map((m) => `${m.from === 'user' ? '用户' : '你'}：${m.text}`)
    .join('\n\n')
  return [
    '【长期记忆校准参考（只用于防止稳定事实丢失，不要整段抄写）】',
    longTermReference.trim() || '（无）',
    '',
    '【上一版分层摘要】',
    renderRollingSummary(previous),
    '',
    '【经主CC确认可以模糊化的最老闭合原文（边界之后的对话未提供，仍将逐字保留）】',
    dialogue || '（无）',
  ].join('\n')
}

export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (/[㐀-鿿　-〿＀-￯]/u.test(char)) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}

function messageTokens(message: VisibleCcMessage): number {
  return estimateTokens(`${message.from === 'user' ? '用户' : '你'}：${message.text}\n`)
}

function isCompletedTurnBoundary(messages: VisibleCcMessage[], index: number): boolean {
  const current = messages[index]
  const next = messages[index + 1]
  if (!current || current.from !== 'cc') return false
  if (!next) return true
  if (current.turnId && next.turnId) return current.turnId !== next.turnId
  return next.from === 'user'
}

/**
 * Builds token-bounded choices for the main CC to approve. The first choice
 * is the smallest old prefix that returns the exact suffix to the low-water
 * target. Earlier choices preserve more verbatim history and are offered as
 * veto fallbacks, but none may exceed the hard raw-text ceiling.
 */
export function tidalBoundaryOptions(
  messages: VisibleCcMessage[],
  targetRawTokens: number,
  maxRawTokens: number,
  maxOptions = 6,
): TidalBoundaryOption[] {
  const source = messages.filter(isVisibleMessage)
  if (source.length < 4) return []
  const suffixTokens = new Array<number>(source.length + 1).fill(0)
  for (let i = source.length - 1; i >= 0; i--) suffixTokens[i] = suffixTokens[i + 1] + messageTokens(source[i])

  const safe = source
    .map((message, index) => ({ message, index, preservedTokens: suffixTokens[index + 1] }))
    .filter(({ index, preservedTokens }) => (
      index >= 1
      && isCompletedTurnBoundary(source, index)
      && preservedTokens <= maxRawTokens
    ))
  if (!safe.length) return []

  const proposedPosition = safe.findIndex(({ preservedTokens }) => preservedTokens <= targetRawTokens)
  const proposed = proposedPosition >= 0 ? proposedPosition : safe.length - 1
  const candidates = safe.slice(0, proposed + 1)
  const picked: typeof safe = []
  // Always include the proposed low-water boundary, then spread the remaining
  // choices toward older boundaries so CC can preserve an open event intact.
  picked.push(candidates[candidates.length - 1])
  if (maxOptions > 1 && candidates.length > 1) {
    for (let slot = 1; slot < maxOptions; slot++) {
      const index = Math.round((candidates.length - 1) * (1 - slot / (maxOptions - 1)))
      const candidate = candidates[index]
      if (candidate && !picked.some((item) => item.index === candidate.index)) picked.push(candidate)
    }
  }

  return picked
    .sort((a, b) => a.index - b.index)
    .map(({ message, index, preservedTokens }) => ({
      boundaryId: message.id,
      boundaryTs: message.ts,
      sourceCount: index + 1,
      preservedCount: source.length - index - 1,
      preservedTokens,
      boundaryPreview: [
        source.slice(0, index + 1).reverse().find((item) => item.from === 'user')?.text,
        message.text,
      ].filter(Boolean).map((text) => String(text).replace(/\s+/g, ' ').trim().slice(0, 90)).join(' / '),
    }))
}

export function renderTidalReviewPrompt(
  options: TidalBoundaryOption[],
  proposedBoundaryId: string,
  mode: TidalReviewMode = 'ask',
): string {
  const lines = options.map((option) => {
    const proposed = option.boundaryId === proposedBoundaryId ? '（建议低水位边界）' : '（更保守，保留更多原文）'
    return `- boundary_id=${option.boundaryId} ${proposed}；边界后保留 ${option.preservedCount} 条、约 ${option.preservedTokens} tokens；边界处你的原话：“${option.boundaryPreview || '（空）'}”`
  })
  const decision = mode === 'force'
    ? [
        '这是在上次拒绝后上下文又增长 10 个百分点的强制整理。本次不能 defer；必须选择一个最保守且安全的边界。',
        '本次必须写 continuity_bridge 检查点，用第一人称留下压缩后维持连续性所必需的理解；不得留空。',
      ]
    : [
        mode === 'reask' ? '这是在上次拒绝后上下文又增长 5 个百分点时的再次询问；如果仍没有安全边界，可以继续 defer。' : '如果所有候选都会切进尚未闭合的事件，可以设 defer=true，本次不会摘要或 compact。',
        '若选择任一边界（包括最保守、改动最小的边界），必须明确决定是否需要检查点：需要则 write_checkpoint=true 并填写 continuity_bridge；不需要则 write_checkpoint=false。',
      ]
  return [
    '[系统内部潮汐维护，不是用户消息，不要向用户回复，也不要改变你正在使用的模型或推理配置。]',
    '上下文已到主动整理高水位。外部整理器只会概括你确认已经闭合的最老前缀；选定边界之后的对话会逐字恢复，不会交给摘要模型。',
    '请从下面候选中选择一个 boundary_id：如果建议边界切进了仍会影响你接下来理解与回应的情绪、关系变化、承诺、自我认知或未完话题，就选择更保守的较早边界。只要不确定，就不要把它判为闭合。',
    ...decision,
    '必须调用一次 tidal_memory_checkpoint。continuity_bridge 只写边界后原文与核心记忆无法还原、但继续相处必需的一条跨边界理解，最多 600 字。',
    '',
    '【可选闭合边界】',
    ...lines,
  ].join('\n')
}

export type RecoveryPacket = {
  marker: string
  content: string
  recent: VisibleCcMessage[]
  estimatedTokens: number
  fitsBudget: boolean
}

export type ThinkingFlushDecision = {
  action: 'wait' | 'skip_low_benefit' | 'flush'
  growthTokens: number
  growthPercent: number
  estimatedGainTokens: number
  estimatedGainPercent: number
}

/**
 * The 20-point interval is only an evaluation cadence. A clear is worthwhile
 * only when context growth not represented by the recovery packet would save
 * at least 10% of the active model window.
 */
export function thinkingFlushDecision(args: {
  currentContextTokens: number
  baselineContextTokens: number
  contextWindowSize: number
  currentRecoveryTokens: number
  baselineRecoveryTokens: number
  evaluationDeltaPercent?: number
  minimumGainPercent?: number
}): ThinkingFlushDecision {
  const windowSize = Math.max(1, finiteNonNegative(args.contextWindowSize))
  const growthTokens = Math.max(0, finiteNonNegative(args.currentContextTokens) - finiteNonNegative(args.baselineContextTokens))
  const recoveryGrowth = Math.max(0, finiteNonNegative(args.currentRecoveryTokens) - finiteNonNegative(args.baselineRecoveryTokens))
  const estimatedGainTokens = Math.max(0, growthTokens - recoveryGrowth)
  const growthPercent = growthTokens / windowSize * 100
  const estimatedGainPercent = estimatedGainTokens / windowSize * 100
  const evaluationDelta = Math.max(0, args.evaluationDeltaPercent ?? 20)
  const minimumGain = Math.max(0, args.minimumGainPercent ?? 10)
  return {
    action: growthPercent < evaluationDelta
      ? 'wait'
      : estimatedGainPercent < minimumGain
        ? 'skip_low_benefit'
        : 'flush',
    growthTokens,
    growthPercent,
    estimatedGainTokens,
    estimatedGainPercent,
  }
}

/**
 * A full user-requested clear intentionally discards every older archive.
 * Lightweight cleanup may still preserve the exact post-clear conversation,
 * but must never pull an old summary or pre-clear troubleshooting text back.
 */
export function buildVerbatimRecoveryPacket(args: {
  marker: string
  visibleHistory: VisibleCcMessage[]
  sinceTs: number
  tokenBudget?: number
}): RecoveryPacket {
  const tokenBudget = Math.max(256, args.tokenBudget ?? DEFAULT_TIDAL_CONFIG.recoveryTokenBudget)
  const recent = args.visibleHistory
    .filter(isVisibleMessage)
    .filter((message) => Number.isFinite(message.ts) && message.ts >= args.sinceTs)
  const content = [
    `[系统恢复层；仅供模型读取；${args.marker}]`,
    `【本次完整清空之后保留的连续原文（${recent.length} 条）】`,
    ...recent.map((message) => `${message.from === 'user' ? '用户' : '你'}：${message.text}`),
    '',
    '这里只恢复本次完整清空之后的可见原文；没有旧摘要、旧档案或更早的排障记录。核心记忆仍由系统自动加载。继续刚才的关系、语气和话题，不要重新自我介绍，也不要向用户提及本次轻量清理。仅本条系统恢复层保持静默；下一条真实用户消息仍必须通过 reply（或适当的可见动作工具）发送。',
  ].join('\n')
  const estimatedTokens = estimateTokens(content)
  return { marker: args.marker, content, recent, estimatedTokens, fitsBudget: estimatedTokens <= tokenBudget }
}

export function buildRecoveryPacket(args: {
  marker: string
  rollingSummary: RollingSummary
  includeLongTermFallback?: boolean
  subjectiveCheckpoint?: SubjectiveCheckpoint | null
  visibleHistory: VisibleCcMessage[]
  boundaryId: string
  tokenBudget?: number
}): RecoveryPacket {
  const tokenBudget = Math.max(256, args.tokenBudget ?? DEFAULT_TIDAL_CONFIG.recoveryTokenBudget)
  const boundaryIndex = args.visibleHistory.findIndex((m) => m.id === args.boundaryId)
  // The boundary is the newest message represented only in the blurred
  // archive. Everything after it remains verbatim; it must never also be fed
  // to the external summarizer.
  const recent = (boundaryIndex >= 0 ? args.visibleHistory.slice(boundaryIndex + 1) : [])
    .filter(isVisibleMessage)
  const checkpoint = renderSubjectiveCheckpoint(args.subjectiveCheckpoint ?? null)
  const archive = [
    ...(args.includeLongTermFallback ? [renderLongTermSummary(args.rollingSummary)] : []),
    renderRecentSummary(args.rollingSummary),
  ].join('\n')

  const render = (items: VisibleCcMessage[]) => [
    `[系统恢复层；仅供模型读取；${args.marker}]`,
    '【已经闭合并模糊化的早期事件档案】',
    archive,
    '',
    ...(checkpoint ? ['【仅在原文无法还原时使用的跨边界桥接】', checkpoint, ''] : []),
    `【边界之后保留的连续原文（${items.length} 条）】`,
    ...items.map((m) => `${m.from === 'user' ? '用户' : '你'}：${m.text}`),
    '',
    `${args.includeLongTermFallback ? '当前没有可自动加载的核心记忆，档案临时包含长期基线。' : '核心记忆由系统自动加载，不在这里重复。'}闭合档案不代表当前状态；若与桥接或连续原文冲突，以更近的内容为准。session 没有更换。继续刚才的关系、语气和话题；不要重新自我介绍，不要向用户提及压缩。仅本条系统恢复层保持静默；下一条真实用户消息仍必须通过 reply（或适当的可见动作工具）发送，不要把本条静默要求延续到下一轮。`,
  ].join('\n')

  const content = render(recent)
  const estimatedTokens = estimateTokens(content)
  return { marker: args.marker, content, recent, estimatedTokens, fitsBudget: estimatedTokens <= tokenBudget }
}

export function transcriptContainsMarker(transcriptPath: string, marker: string): boolean {
  if (!marker || !existsSync(transcriptPath)) return false
  try { return readFileSync(transcriptPath, 'utf8').includes(marker) } catch { return false }
}

export function transcriptHasCompactAfter(transcriptPath: string, startedAt: number): boolean {
  if (!existsSync(transcriptPath)) return false
  let lines: string[]
  try { lines = readFileSync(transcriptPath, 'utf8').split('\n') } catch { return false }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue
    let row: any
    try { row = JSON.parse(lines[i]) } catch { continue }
    const ts = Date.parse(String(row?.timestamp ?? ''))
    if (Number.isFinite(ts) && ts < startedAt) break
    if (row?.isCompactSummary === true || row?.subtype === 'compact_boundary' || row?.type === 'summary') return true
    if (row?.type === 'system' && /compact/i.test(String(row?.subtype ?? ''))) return true
  }
  return false
}

export function loadTidalState(path: string, sessionId: string): TidalState {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<TidalState>
    if (raw?.version !== 1 || typeof raw.sessionId !== 'string') return createTidalState(sessionId)
    return {
      version: 1,
      sessionId: raw.sessionId,
      rollingSummary: validateRollingSummary(raw.rollingSummary),
      processedBoundaryId: typeof raw.processedBoundaryId === 'string' ? raw.processedBoundaryId : null,
      processedBoundaryTs: typeof raw.processedBoundaryTs === 'number' ? raw.processedBoundaryTs : null,
      pending: raw.pending && typeof raw.pending === 'object' ? raw.pending as TidalPending : null,
      queue: Array.isArray(raw.queue)
        ? raw.queue.filter((q): q is QueuedCcMessage => !!q && typeof q.id === 'string' && typeof q.text === 'string')
        : [],
      retryAt: typeof raw.retryAt === 'number' ? raw.retryAt : null,
      lastContextTokens: typeof raw.lastContextTokens === 'number' ? raw.lastContextTokens : null,
      summaryRevision: Number.isInteger(raw.summaryRevision) && Number(raw.summaryRevision) >= 0 ? Number(raw.summaryRevision) : (validateRollingSummary(raw.rollingSummary) ? 1 : 0),
      summaryUpdatedAt: typeof raw.summaryUpdatedAt === 'number' ? raw.summaryUpdatedAt : (validateRollingSummary(raw.rollingSummary) ? (typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now()) : null),
      summaryModel: typeof raw.summaryModel === 'string' ? raw.summaryModel : null,
      summarySource: raw.summarySource === 'automatic' || raw.summarySource === 'manual' || raw.summarySource === 'legacy' ? raw.summarySource : null,
      // The former five-field checkpoint was also the rollout marker for the
      // progressive exact suffix. Preserve that signal without carrying its
      // duplicated prose into the new recovery packet.
      progressiveCoverage: raw.progressiveCoverage === true || (!!raw.subjectiveCheckpoint && typeof raw.subjectiveCheckpoint === 'object'),
      subjectiveCheckpoint: validateSubjectiveCheckpoint(raw.subjectiveCheckpoint),
      checkpointUpdatedAt: typeof raw.checkpointUpdatedAt === 'number' ? raw.checkpointUpdatedAt : null,
      reviewDeferral: raw.reviewDeferral && typeof raw.reviewDeferral === 'object'
        && Number.isFinite(Number(raw.reviewDeferral.baselinePercent))
        ? { baselinePercent: Number(raw.reviewDeferral.baselinePercent), reasked: raw.reviewDeferral.reasked === true }
        : null,
      lastRun: raw.lastRun && typeof raw.lastRun === 'object' ? raw.lastRun as TidalLastRun : null,
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    }
  } catch {
    return createTidalState(sessionId)
  }
}

export function saveTidalState(path: string, state: TidalState): void {
  mkdirSync(dirname(path), { recursive: true })
  state.updatedAt = Date.now()
  const tmp = `${path}.tmp.${process.pid}`
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 })
  renameSync(tmp, path)
}

export function queuedTurnIds(state: TidalState): string[] {
  return state.queue.map((q) => q.id)
}

// Keeps the completed-summary side of a conversation boundary. Exact ids are
// authoritative; the timestamp fallback lets older/imported histories still
// honor a valid persisted boundary even if that one id is absent locally.
export function retainThroughBoundary<T extends { id: string; ts: number }>(
  items: T[],
  boundaryId: string,
  boundaryTs: number,
): T[] {
  const exact = items.findIndex((item) => item.id === boundaryId)
  if (exact >= 0) return items.slice(0, exact + 1)
  return items.filter((item) => Number.isFinite(item.ts) && item.ts <= boundaryTs)
}

// `/clear` creates a fresh Claude conversation id. A summary-preserving clear
// carries only the completed summary/coverage metadata across that boundary;
// all transient work and queued post-summary messages are always discarded.
export function tidalStateAfterConversationClear(
  state: TidalState,
  sessionId: string,
  preserveSummary: boolean,
  now = Date.now(),
): TidalState {
  if (!preserveSummary) return createTidalState(sessionId, now)
  return {
    ...state,
    sessionId,
    pending: null,
    queue: [],
    retryAt: null,
    lastContextTokens: null,
    reviewDeferral: null,
    updatedAt: now,
  }
}

export function appendOnly<T>(items: T[], item: T): void {
  items.push(item)
}

export function enqueueUnique(state: TidalState, message: QueuedCcMessage): boolean {
  if (state.queue.some((q) => q.id === message.id)) return false
  state.queue.push(message)
  return true
}

export function claimTidalPending(state: TidalState, pending: TidalPending): boolean {
  if (state.pending) return false
  state.pending = pending
  return true
}

export function sessionIdUnchanged(expected: string, actual: string): boolean {
  return !!expected && expected === actual
}

export function shouldEvaluateTidalSurface(surface: string): boolean {
  return surface === 'main'
}

// A resumed Claude Code session already contains its own full conversation
// state. Re-injecting the recovery packet on every service restart duplicates
// memory and grows the prompt. Fresh/unknown starts still need the packet.
export function shouldInjectTidalStartupRecovery(sessionMode: unknown): boolean {
  return sessionMode !== 'resumed'
}

export async function guardedSummaryBeforeCompact(args: {
  summarize: () => Promise<unknown>
  compact: (summary: RollingSummary) => Promise<void>
}): Promise<{ ok: boolean; stage: 'summary' | 'compact' | 'done' }> {
  let raw: unknown
  try { raw = await args.summarize() } catch { return { ok: false, stage: 'summary' } }
  const summary = validateRollingSummary(raw)
  if (!summary) return { ok: false, stage: 'summary' }
  try { await args.compact(summary) } catch { return { ok: false, stage: 'compact' } }
  return { ok: true, stage: 'done' }
}
