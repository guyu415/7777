import { describe, expect, it } from 'vitest'
import { buildPokeTimeline, canEditPokeText, editablePokeParts, formatPokeNotice, isPokeDoubleTap, POKE_DOUBLE_TAP_MS } from '../poke'

describe('poke interaction', () => {
  it('formats user and CC pokes as centered notice copy', () => {
    expect(formatPokeNotice({ from: 'user', aiName: '恒叙', suffix: '的肩膀' })).toBe('你拍了拍恒叙的肩膀')
    expect(formatPokeNotice({ from: 'cc', aiName: '恒叙', suffix: '的小脑袋' })).toBe('恒叙拍了拍你的小脑袋')
    expect(formatPokeNotice({ from: 'cc', aiName: '恒叙', before: '捏', after: '捏你的小脸' })).toBe('恒叙捏了捏你的小脸')
    expect(formatPokeNotice({ from: 'user', aiName: '恒叙', before: '拍', after: '拍{name}的肩膀' })).toBe('你拍了拍恒叙的肩膀')
    expect(formatPokeNotice({ from: 'user', aiName: '恒叙', before: '拍', after: '拍我的肩膀' })).toBe('你拍了拍恒叙的肩膀')
  })

  it('accepts exactly two nearby touch releases as a double tap', () => {
    expect(isPokeDoubleTap(1_000, 1_000 + POKE_DOUBLE_TAP_MS)).toBe(true)
    expect(isPokeDoubleTap(1_000, 1_000 + POKE_DOUBLE_TAP_MS + 1)).toBe(false)
    expect(isPokeDoubleTap(0, 100)).toBe(false)
  })

  it('only lets the user edit the suffix that belongs to them', () => {
    expect(canEditPokeText({ from: 'cc' })).toBe(true)
    expect(canEditPokeText({ from: 'user' })).toBe(false)
  })

  it('migrates an old suffix into the two editable sides of 了', () => {
    expect(editablePokeParts({ suffix: '的小脑袋' })).toEqual({ before: '拍', after: '拍你的小脑袋' })
    expect(editablePokeParts({ before: '亲', after: '亲你的额头' })).toEqual({ before: '亲', after: '亲你的额头' })
  })

  it('anchors each new poke round after the latest server message instead of comparing skewed clocks', () => {
    const messages = [
      { id: 'old', timestamp: 100 },
      { id: 'user-new', timestamp: 9_000 },
      { id: 'cc-new-part', serverWireIds: ['cc-new'], timestamp: 9_100 },
    ]
    const pokes = [
      { id: 'poke-old', ts: 200, afterWireId: 'old', serverOrder: 1 },
      // Its server clock is numerically older than the local message clock,
      // but it was initiated after cc-new and must render there.
      { id: 'poke-latest', ts: 300, afterWireId: 'cc-new', serverOrder: 4 },
    ]
    expect(buildPokeTimeline(messages, pokes).map(row => row.id)).toEqual([
      'message:old', 'poke:poke-old', 'message:user-new', 'message:cc-new-part', 'poke:poke-latest',
    ])
  })
})
