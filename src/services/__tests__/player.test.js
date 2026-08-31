import { describe, expect, it } from 'vitest'
import { playbackEndAtMs } from '../player'

describe('NetEase estimated playback expiry', () => {
  it('uses the catalog duration when available', () => {
    expect(playbackEndAtMs({ durationMs: 240_000 }, [{ timeMs: 210_000 }])).toBe(240_000)
  })

  it('expires 30 seconds after the last lyric for legacy cards', () => {
    expect(playbackEndAtMs({}, [{ timeMs: 1_000 }, { timeMs: 215_500 }])).toBe(245_500)
  })

  it('does not invent an end time without duration or lyrics', () => {
    expect(playbackEndAtMs({}, [])).toBe(0)
  })
})
