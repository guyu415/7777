export type SpicyRollEvent = {
  who?: unknown
  dice?: unknown
  tile?: unknown
}

type SpicySavedSession = Record<string, unknown> & {
  visual?: {
    event?: { seq?: unknown }
  }
}

type SpicyEngineState = {
  board?: unknown
  positions?: unknown
  coins?: unknown
  laps?: unknown
  turn?: unknown
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

export function spicyRollUserText(result: SpicyRollEvent): string {
  const dice = Number(result.dice)
  return Number.isInteger(dice) && dice >= 1 && dice <= 6
    ? `[DICE:${dice}]`
    : '继续回合'
}

export function buildSpicyVisual(
  saved: SpicySavedSession,
  state: SpicyEngineState,
  event: SpicyRollEvent,
  now = Date.now(),
) {
  const progress = String(state.board ?? '').match(/回合\s*(\d+)\/(\d+)/)
  const totalRounds = progress ? Number(progress[2]) : 18
  const specials = totalRounds <= 12
    ? { 0: 'start', 5: 'chance', 8: 'mystery', 11: 'jail', 14: 'truth', 17: 'shop' }
    : { 0: 'start', 4: 'truth', 5: 'chance', 8: 'mystery', 10: 'jail', 12: 'shop', 14: 'truth', 15: 'chance', 17: 'mystery', 19: 'shop' }
  const previousSeq = Number(saved.visual?.event?.seq) || 0
  const dice = Number(event.dice)

  return {
    game_id: typeof saved.game_id === 'string' ? saved.game_id : '',
    positions: record(state.positions),
    coins: record(state.coins),
    laps: record(state.laps),
    turn: typeof state.turn === 'string' ? state.turn : '',
    round: progress ? Number(progress[1]) : 0,
    total_rounds: totalRounds,
    tiles: Array.from({ length: 20 }, (_, index) => (specials as Record<number, string>)[index] || 'task'),
    event: {
      seq: Math.max(now, previousSeq + 1),
      who: typeof event.who === 'string' ? event.who : '',
      dice: Number.isInteger(dice) && dice >= 1 && dice <= 6 ? dice : null,
      tile: typeof event.tile === 'string' ? event.tile : '',
    },
    updated_at: now,
  }
}

export function spicyRollDelivery(result: Record<string, unknown>): string {
  const { board: _board, ...compactResult } = result
  return JSON.stringify({
    kind: 'spicy_monopoly_board_roll',
    instruction:
      '用户刚在涩涩大富翁棋盘点击按钮，服务端已直接调用游戏引擎完成这一回合。' +
      '这不是请你再掷一次：不要调用 roll_dice，也不要再次调用 spicy_monopoly 的 roll。' +
      '请只依据 result 自然主持并完整念出本轮任务、真心话、结算或其他提示；动画棋盘已自动更新，无需重复粘贴棋盘。',
    result: compactResult,
  })
}
