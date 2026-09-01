import { describe, expect, it } from 'vitest'
import { ccWireToTimelineMessage, selectCcSnapshotDelta } from './ccTimeline'

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
})
