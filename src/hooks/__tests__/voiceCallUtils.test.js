import { describe, expect, it } from 'vitest'
import { isLikelyPlaybackEcho } from '../voiceCallUtils'

describe('voice call playback echo guard', () => {
  it('rejects the AI line or a meaningful fragment immediately after playback', () => {
    expect(isLikelyPlaybackEcho('听起来比刚才好一点了，声音亮了。', '听起来比刚才好一点了。声音亮了。', 800)).toBe(true)
    expect(isLikelyPlaybackEcho('声音亮了', '听起来比刚才好一点了。声音亮了。', 900)).toBe(true)
  })

  it('keeps an actual user reply and expires quickly', () => {
    expect(isLikelyPlaybackEcho('是吗，我自己没感觉', '声音亮了。', 700)).toBe(false)
    expect(isLikelyPlaybackEcho('声音亮了', '声音亮了。', 6000)).toBe(false)
    expect(isLikelyPlaybackEcho('嗯', '嗯，我在听。', 500)).toBe(false)
    expect(isLikelyPlaybackEcho('还好', '你现在还好吗？', 500)).toBe(false)
  })
})
