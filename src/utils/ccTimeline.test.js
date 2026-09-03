import { describe, expect, it } from 'vitest'
import { ccWireToTimelineMessage, ccWireToTimelineMessages, selectCcSnapshotDelta } from './ccTimeline'

const msg = (id, ts, from = 'cc', text = id) => ({ type: 'msg', id, ts, from, text })

describe('CC timeline snapshot recovery', () => {
  it('recovers only wires after the latest local anchor', () => {
    const local = [
      { id: 'local-a', wireIds: ['wire-a'], timestamp: 1000 },
      { id: 'local-c', wireIds: ['wire-c'], timestamp: 3000 },
    ]
    const snapshot = [msg('wire-a', 1000), msg('old-gap', 2000), msg('wire-c', 3000), msg('missed-new', 4000)]
    expect(selectCcSnapshotDelta(local, snapshot).map(item => item.id)).toEqual(['missed-new'])
  })

  it('anchors a split display message by its shared server wire id', () => {
    const local = [
      { id: 'local-0', wireIds: ['wire-a::part:0'], serverWireIds: ['wire-a'], timestamp: 1000 },
      { id: 'local-1', wireIds: ['wire-a::part:1'], serverWireIds: ['wire-a'], timestamp: 1000 },
    ]
    const snapshot = [msg('wire-a', 1000), msg('wire-b', 2000)]
    expect(selectCcSnapshotDelta(local, snapshot).map(item => item.id)).toEqual(['wire-b'])
  })

  it('uses time as a safe fallback for legacy local rows without wire ids', () => {
    const local = [{ id: 'legacy-local', timestamp: 3000, role: 'assistant', content: 'saved' }]
    const snapshot = [msg('old-1', 1000), msg('old-2', 2000), msg('new-1', 4000)]
    expect(selectCcSnapshotDelta(local, snapshot).map(item => item.id)).toEqual(['new-1'])
  })

  it('hydrates one complete ordered batch on a genuinely empty device', () => {
    const snapshot = [msg('a', 1000, 'user'), msg('b', 2000)]
    expect(selectCcSnapshotDelta([], snapshot).map(item => item.id)).toEqual(['a', 'b'])
  })

  it('maps recovered voice to readable text without restarting old TTS work', () => {
    const mapped = ccWireToTimelineMessage({ ...msg('voice', 1000), kind: 'voice' }, 'cc-session')
    expect(mapped).toMatchObject({ id: 'voice', type: 'text', voiceLoading: false, voiceFailed: true })
  })

  it('maps CC turn identity to causal parent fields, not semantic replyTo', () => {
    const user = ccWireToTimelineMessage({ ...msg('turn-a', 2000, 'user', 'A'), turnId: 'turn-a' }, 'cc-session')
    const reply = ccWireToTimelineMessage({ ...msg('reply-a', 1000), turnId: 'turn-a', replyTo: 'quoted-old-message' }, 'cc-session')

    expect(user).toMatchObject({ id: 'turn-a', turnId: 'turn-a' })
    expect(reply).toMatchObject({ id: 'reply-a', turnId: 'turn-a', replyToTurnId: 'turn-a' })
  })

  it('hydrates paragraph bubbles with separate display ids and one server id', () => {
    const mapped = ccWireToTimelineMessages({
      ...msg('reply-a', 1000), turnId: 'turn-a', text: '第一段\n\n第二段',
    }, 'cc-session')

    expect(mapped.map(message => [message.id, message.content, message.serverWireIds[0]])).toEqual([
      ['reply-a::part:0', '第一段', 'reply-a'],
      ['reply-a::part:1', '第二段', 'reply-a'],
    ])
  })

  it('keeps a persisted focus summary card when history is recovered', () => {
    const focusSummary = { task: '背单词', plannedMinutes: 25, actualMinutes: 25, reason: 'completed' }
    const mapped = ccWireToTimelineMessage({ ...msg('focus-card', 1000), focusSummary }, 'cc-session')
    expect(mapped.focusSummary).toEqual(focusSummary)
  })

  it('hydrates a bedtime note as one durable card', () => {
    const bedtimeCard = { english: 'Let the day go gently.', translation: '轻轻放下今天。', date: '2026-09-03' }
    const mapped = ccWireToTimelineMessages({ ...msg('bedtime-card', 1000), bedtimeCard }, 'cc-session')

    expect(mapped).toHaveLength(1)
    expect(mapped[0]).toMatchObject({ id: 'bedtime-card', bedtimeCard, content: 'bedtime-card' })
  })
})
