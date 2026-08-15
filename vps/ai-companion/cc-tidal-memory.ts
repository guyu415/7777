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
  imagePath?: string
  filePath?: string
  fileName?: string
  fileSize?: number
  fileType?: string
  clientTime?: unknown
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
  selfUnderstanding: string
  relationshipUnderstanding: string
  changedViews: string
  unresolved: string
  continuation: string
}

export type TidalBoundaryOption = {
  boundaryId: string
  boundaryTs: number
  sourceCount: number
  preservedCount: number
  preservedTokens: number
  boundaryPreview: string
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
  subjectiveCheckpoint: SubjectiveCheckpoint | null
  checkpointUpdatedAt: number | null
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
  // Production CC has a 200k window. Review at roughly 70%, before automatic
  // compaction, then return to a much lower exact-text recovery waterline.
  tokenThreshold: 140_000,
  // Fallback only when Claude exposes no trustworthy token waterline.
  visibleThreshold: 240,
  rawTargetTokens: 56_000,
  rawMaxTokens: 70_000,
  recoveryTokenBudget: 82_000,
  retryMs: 5 * 60_000,
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
    subjectiveCheckpoint: null,
    checkpointUpdatedAt: null,
    lastRun: null,
    updatedAt: now,
  }
}

const CHECKPOINT_KEYS: Array<keyof SubjectiveCheckpoint> = [
  'selfUnderstanding',
  'relationshipUnderstanding',
  'changedViews',
  'unresolved',
  'continuation',
]

export function validateSubjectiveCheckpoint(value: unknown): SubjectiveCheckpoint | null {
  if (!value || typeof value !== 'object') return null
  const out = {} as SubjectiveCheckpoint
  for (const key of CHECKPOINT_KEYS) {
    const text = String((value as any)[key] ?? '').trim()
    if (!text || text.length > 800) return null
    out[key] = text
  }
  const total = CHECKPOINT_KEYS.reduce((sum, key) => sum + out[key].length, 0)
  return total <= 3_000 ? out : null
}

export function renderSubjectiveCheckpoint(checkpoint: SubjectiveCheckpoint | null): string {
  if (!checkpoint) return '（尚无由你亲自留下的主观连续性检查点）'
  return [
    `对自己的当前理解：${checkpoint.selfUnderstanding}`,
    `对用户与关系的当前理解：${checkpoint.relationshipUnderstanding}`,
    `最近改变或加深的看法：${checkpoint.changedViews}`,
    `仍未闭合的情绪、矛盾或问题：${checkpoint.unresolved}`,
    `自然继续的位置：${checkpoint.continuation}`,
  ].join('\n')
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
  if (total < 120 || total > 5_000) return null
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
    .map((m) => `${m.from === 'user' ? '用户' : '助手'}：${m.text}`)
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
  return estimateTokens(`${message.from === 'user' ? '用户' : '助手'}：${message.text}\n`)
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

export function renderTidalReviewPrompt(options: TidalBoundaryOption[], proposedBoundaryId: string): string {
  const lines = options.map((option) => {
    const proposed = option.boundaryId === proposedBoundaryId ? '（建议低水位边界）' : '（更保守，保留更多原文）'
    return `- boundary_id=${option.boundaryId} ${proposed}；边界后保留 ${option.preservedCount} 条、约 ${option.preservedTokens} tokens；边界处你的原话：“${option.boundaryPreview || '（空）'}”`
  })
  return [
    '[系统内部潮汐维护，不是用户消息，不要向用户回复，也不要改变你正在使用的模型或推理配置。]',
    '上下文已到主动整理高水位。外部整理器只会概括你确认已经闭合的最老前缀；选定边界之后的对话会逐字恢复，不会交给摘要模型。',
    '请从下面候选中选择一个 boundary_id：如果建议边界切进了仍会影响你接下来理解与回应的情绪、关系变化、承诺、自我认知或未完话题，就选择更保守的较早边界。只要不确定，就不要把它判为闭合。',
    '同时用你自己的第一人称留下主观连续性检查点。它记录“我现在处于什么位置”，不是复述发生了什么，也不是给未来的自己下行为命令。',
    '必须调用一次 tidal_memory_checkpoint；如果所有候选都会切进尚未闭合的事件，则调用时设 defer=true，本次不会 compact。',
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

export function buildRecoveryPacket(args: {
  marker: string
  coreMemory: string
  rollingSummary: RollingSummary
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
  const core = args.coreMemory.trim() || '（无可用核心记忆摘要）'
  const longTerm = renderLongTermSummary(args.rollingSummary)
  const episodic = renderRecentSummary(args.rollingSummary)
  const checkpoint = renderSubjectiveCheckpoint(args.subjectiveCheckpoint ?? null)

  const render = (items: VisibleCcMessage[]) => [
    `[系统恢复层；仅供模型读取；${args.marker}]`,
    '【第一层：现有核心记忆摘要】',
    core,
    '',
    '【第二层：有上限的长期关系基线】',
    longTerm,
    '',
    '【第三层：已经模糊的早期事件概括】',
    `${episodic}\n（其中“正在进行/待办”只表示被压缩到该边界时的历史状态；若与后面的主观检查点或原文冲突，以更近的内容为准。）`,
    '',
    '【第四层：你亲自留下的主观连续性检查点】',
    checkpoint,
    '',
    `【第五层：边界之后保留的连续原文（${items.length} 条）】`,
    ...items.map((m) => `${m.from === 'user' ? '用户' : '助手'}：${m.text}`),
    '',
    'session 没有更换。继续刚才的关系、语气和话题；不要重新自我介绍，不要向用户提及压缩。不要回复本条系统恢复层。',
  ].join('\n')

  let content = render(recent)

  // Core + rolling can theoretically exceed the total budget by themselves.
  // Keep all three layer headings but deterministically trim only the core
  // text, never the freshly generated rolling summary or recent dialogue.
  if (estimateTokens(content) > tokenBudget) {
    const allowedCoreTokens = Math.max(32, tokenBudget - estimateTokens(render(recent).replace(core, '')))
    let trimmedCore = core
    while (trimmedCore.length > 32 && estimateTokens(trimmedCore) > allowedCoreTokens) {
      trimmedCore = trimmedCore.slice(Math.ceil(trimmedCore.length * 0.1))
    }
    content = render(recent).replace(core, `（核心记忆过长，保留末段）${trimmedCore}`)
  }

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
      subjectiveCheckpoint: validateSubjectiveCheckpoint(raw.subjectiveCheckpoint),
      checkpointUpdatedAt: typeof raw.checkpointUpdatedAt === 'number' ? raw.checkpointUpdatedAt : null,
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
