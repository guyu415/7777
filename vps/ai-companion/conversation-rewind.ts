export type RewindHistoryItem = {
  id?: string
  turnId?: string
  from?: string
  ts?: number
}

export type ConversationRewindPlan = {
  targetIndex: number
  targetWireId: string
  transcriptCutoffLine: number
  keptHistory: RewindHistoryItem[]
  removedHistory: RewindHistoryItem[]
  keptIds: string[]
  removedIds: string[]
  branchTailUuid: string | null
  marker: {
    resetAt: number
    mode: 'all' | 'after_summary'
    boundaryId: string | null
    boundaryTs: number | null
  }
}

export function normalizeRewindMessageIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((id): id is string => typeof id === 'string')
    .map(id => id.trim())
    .filter(id => id.length > 0 && id.length <= 160))]
    .slice(0, 20)
}

function historyIdentityKeys(item: RewindHistoryItem): string[] {
  return [item.id, item.turnId].filter((id): id is string => typeof id === 'string' && id.length > 0)
}

function parseTranscriptLine(line: string): any | null {
  try { return JSON.parse(line) } catch { return null }
}

function transcriptChannelMessageId(line: string): string | null {
  let parsed: any
  parsed = parseTranscriptLine(line)
  if (parsed?.type !== 'user' || parsed?.message?.role !== 'user') return null
  const content = parsed?.message?.content
  if (typeof content !== 'string' || !content.startsWith('<channel ')) return null
  const source = content.match(/\bsource="([^"]+)"/)?.[1]
  const messageId = content.match(/\bmessage_id="([^"]+)"/)?.[1]
  return source === 'ai-companion' && messageId ? messageId : null
}

function transcriptUuid(line: string): string | null {
  const uuid = parseTranscriptLine(line)?.uuid
  return typeof uuid === 'string' && uuid ? uuid : null
}

export function planConversationRewind(args: {
  history: RewindHistoryItem[]
  transcriptLines: string[]
  messageIds: unknown
  requestedAt?: number
}): ConversationRewindPlan {
  const ids = normalizeRewindMessageIds(args.messageIds)
  if (!ids.length) throw new Error('missing_message_id')
  const idSet = new Set(ids)
  const targetIndex = args.history.findIndex(item => (
    item?.from === 'user' && historyIdentityKeys(item).some(id => idSet.has(id))
  ))
  if (targetIndex < 0) throw new Error('user_message_not_found')

  const target = args.history[targetIndex]
  const targetKeys = new Set(historyIdentityKeys(target))
  const targetTranscriptLine = args.transcriptLines.findIndex(line => {
    const messageId = transcriptChannelMessageId(line)
    return !!messageId && targetKeys.has(messageId)
  })
  if (targetTranscriptLine < 0) throw new Error('transcript_checkpoint_not_found')

  const targetTranscriptRow = parseTranscriptLine(args.transcriptLines[targetTranscriptLine])
  const parentUuid = typeof targetTranscriptRow?.parentUuid === 'string' && targetTranscriptRow.parentUuid
    ? targetTranscriptRow.parentUuid
    : null
  let transcriptCutoffLine = 0
  if (parentUuid) {
    const parentLine = args.transcriptLines
      .slice(0, targetTranscriptLine)
      .findLastIndex(line => transcriptUuid(line) === parentUuid)
    if (parentLine < 0) throw new Error('transcript_parent_not_found')
    transcriptCutoffLine = parentLine + 1
  } else if (targetIndex > 0) {
    // A non-first visible turn without a transcript parent is not a safe
    // branch checkpoint. Failing closed is better than silently jumping to a
    // different leaf or turning a partial rewind into a full reset.
    throw new Error('transcript_parent_missing')
  }

  const keptHistory = args.history.slice(0, targetIndex)
  const removedHistory = args.history.slice(targetIndex)
  const keptIds = [...new Set(keptHistory.flatMap(historyIdentityKeys).filter(Boolean))]
  const removedIds = [...new Set(removedHistory
    .flatMap(historyIdentityKeys)
    .filter(Boolean))]
  const boundary = keptHistory.at(-1)
  const boundaryTs = Number(boundary?.ts)
  const hasBoundary = !!boundary?.id && Number.isFinite(boundaryTs)
  return {
    targetIndex,
    targetWireId: String(target.id || target.turnId),
    transcriptCutoffLine,
    keptHistory,
    removedHistory,
    keptIds,
    removedIds,
    branchTailUuid: parentUuid,
    marker: {
      resetAt: args.requestedAt ?? Date.now(),
      mode: hasBoundary ? 'after_summary' : 'all',
      boundaryId: hasBoundary ? String(boundary!.id) : null,
      boundaryTs: hasBoundary ? boundaryTs : null,
    },
  }
}

export function tidalStateAfterRewind(
  raw: any,
  sessionId: string,
  boundaryTs: number | null,
  keptIds: Iterable<string>,
  now = Date.now(),
): any {
  const processedBoundaryTs = Number(raw?.processedBoundaryTs)
  const processedBoundaryId = typeof raw?.processedBoundaryId === 'string' ? raw.processedBoundaryId : null
  const keptIdSet = new Set(keptIds)
  const canKeepSummary = !!raw?.rollingSummary
    && !!processedBoundaryId
    && keptIdSet.has(processedBoundaryId)
    && Number.isFinite(processedBoundaryTs)
    && boundaryTs !== null
    && processedBoundaryTs <= boundaryTs
  if (!canKeepSummary) {
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
  return {
    ...raw,
    sessionId,
    pending: null,
    queue: [],
    retryAt: null,
    lastContextTokens: null,
    reviewDeferral: null,
    lastRun: null,
    updatedAt: now,
  }
}
