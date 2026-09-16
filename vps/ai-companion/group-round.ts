export type GroupRoundQueueEntry<MemberId extends string = string> = {
  memberId: MemberId
  mentioned: boolean
}

// A member that speaks may have produced new context for members that ran
// earlier in this round. Queue only those not already waiting; members that
// have not run yet will naturally see the new message in their existing turn.
export function enqueueGroupRelayTargets<MemberId extends string>(
  queue: GroupRoundQueueEntry<MemberId>[],
  members: MemberId[],
  speaker: MemberId,
): GroupRoundQueueEntry<MemberId>[] {
  const queued = new Set(queue.map((entry) => entry.memberId))
  const additions = members
    .filter((memberId) => memberId !== speaker && !queued.has(memberId))
    .map((memberId) => ({ memberId, mentioned: false }))
  return [...queue, ...additions]
}
