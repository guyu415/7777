import { describe, expect, test } from 'bun:test'
import {
  injectMusicRuntimeContext,
  injectMusicRuntimeContextIntoTurnParams,
  renderMusicRuntimeContext,
} from '../music-runtime-context.ts'

const activeSnapshot = {
  active: true,
  song: { id: '186016', name: '晴天', artists: '周杰伦' },
  positionMs: 61_234,
  currentLyric: { timeMs: 60_000, text: '故事的小黄花', translation: '' },
}

describe('music runtime context', () => {
  test('formats the four request-only fields when playback is active', () => {
    const rendered = renderMusicRuntimeContext(activeSnapshot)

    expect(rendered).toContain('song: "晴天"')
    expect(rendered).toContain('artist: "周杰伦"')
    expect(rendered).toContain('positionMs: 61234')
    expect(rendered).toContain('currentLyric: "故事的小黄花"')
    expect(rendered).toContain('不要写入长期记忆或聊天历史')
  })

  test('does not inject an inactive or missing snapshot', () => {
    const text = '请继续刚才的话题'
    expect(renderMusicRuntimeContext({ active: false })).toBe('')
    expect(injectMusicRuntimeContext(text, { active: false })).toBe(text)
    expect(injectMusicRuntimeContext(text, null)).toBe(text)
  })

  test('prepends Codex turn input without mutating the request or user text', () => {
    const params = {
      threadId: 'thread-1',
      input: [{ type: 'text', text: '请告诉我现在播放到哪一句', text_elements: [] }],
    }

    const next = injectMusicRuntimeContextIntoTurnParams(params, activeSnapshot) as typeof params

    expect(next).not.toBe(params)
    expect(next.input[0].text).toContain('currentLyric: "故事的小黄花"')
    expect(next.input[0].text).toContain('请告诉我现在播放到哪一句')
    expect(params.input[0].text).toBe('请告诉我现在播放到哪一句')
  })
})
