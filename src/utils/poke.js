export const POKE_DOUBLE_TAP_MS = 360
export const POKE_SEND_HAPTIC = [10, 42, 10]
export const POKE_RECEIVE_HAPTIC = [18, 34, 28]

export function isPokeDoubleTap(previousAt, now = Date.now()) {
  return Number(previousAt) > 0 && now >= previousAt && now - previousAt <= POKE_DOUBLE_TAP_MS
}

export function formatPokeNotice(poke, fallbackAiName = 'CC') {
  const aiName = poke?.aiName || fallbackAiName || 'CC'
  if (typeof poke?.before === 'string' && typeof poke?.after === 'string') {
    let after = poke.after.replaceAll('{name}', aiName)
    // Repairs the short-lived rollout default that used CC's first-person
    // wording in a user-facing sentence.
    if (poke?.from === 'user' && after === '拍我的肩膀') after = `拍${aiName}的肩膀`
    return `${poke?.from === 'cc' ? aiName : '你'}${poke.before}了${after}`
  }
  const suffix = typeof poke?.suffix === 'string' ? poke.suffix : ''
  return poke?.from === 'cc'
    ? `${aiName}拍了拍你${suffix}`
    : `你拍了拍${aiName}${suffix}`
}

export function editablePokeParts(poke) {
  return {
    before: typeof poke?.before === 'string' ? poke.before : '拍',
    after: typeof poke?.after === 'string' ? poke.after : `拍你${typeof poke?.suffix === 'string' ? poke.suffix : ''}`,
  }
}

// The suffix belongs to the person being poked. A CC -> user row therefore
// displays the user's own suffix and is the only row the user may edit.
export function canEditPokeText(poke) {
  return poke?.from === 'cc'
}

export function buildPokeTimeline(messages = [], pokeEvents = [], toTime = Number) {
  const messageRows = messages.map((message, order) => ({ type: 'message', id: `message:${message.id}`, at: toTime(message.timestamp ?? message.ts), order, message }))
  const messageIndexByWireId = new Map()
  for (const [index, message] of messages.entries()) {
    for (const id of [message.id, ...(message.wireIds || []), ...(message.serverWireIds || [])]) {
      if (id) messageIndexByWireId.set(id, index)
    }
  }
  const leadingPokes = []
  const trailingPokes = []
  const pokesAfterMessage = new Map()
  const pokeRows = pokeEvents.map((poke, order) => ({
    type: 'poke', id: `poke:${poke.id}`, at: toTime(poke.ts),
    order: Number(poke.serverOrder ?? poke.arrivalOrder ?? order), poke,
  }))
  const sortPokes = (rows) => rows.sort((left, right) => left.order - right.order || left.at - right.at)
  for (const row of pokeRows) {
    if (!Object.prototype.hasOwnProperty.call(row.poke, 'afterWireId')) {
      trailingPokes.push(row)
      continue
    }
    if (row.poke.afterWireId === null) {
      leadingPokes.push(row)
      continue
    }
    const anchorIndex = messageIndexByWireId.get(row.poke.afterWireId)
    if (anchorIndex === undefined) {
      trailingPokes.push(row)
      continue
    }
    const group = pokesAfterMessage.get(anchorIndex) || []
    group.push(row)
    pokesAfterMessage.set(anchorIndex, group)
  }
  const rows = sortPokes(leadingPokes)
  for (const [index, messageRow] of messageRows.entries()) {
    rows.push(messageRow)
    const group = pokesAfterMessage.get(index)
    if (group) rows.push(...sortPokes(group))
  }
  rows.push(...sortPokes(trailingPokes))
  return rows
}
