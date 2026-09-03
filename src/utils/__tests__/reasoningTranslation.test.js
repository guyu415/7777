import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ReasoningTranslationController,
  appendReasoningDelta,
  getProtectedReasoningSpans,
  isMostlyChinese,
  resetReasoningTranslationState,
  splitReasoning,
  shouldTranslateReasoningSegment,
} from '../reasoningTranslation'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Claude reasoning translation display queue', () => {
  afterEach(() => {
    vi.useRealTimers()
    resetReasoningTranslationState()
  })

  it('splits at sentences and newlines without splitting technical spans', () => {
    const source = 'I will inspect `src/App.jsx`. Then I will run:\nnpm test\nThe request failed with status 404.'
    const parts = splitReasoning(source)
    expect(parts.map((part) => part.text).join('')).toBe(source)
    expect(parts.some((part) => part.text.includes('`src/App.jsx`'))).toBe(true)
    expect(parts.some((part) => part.text.includes('npm test'))).toBe(true)
    const protectedText = getProtectedReasoningSpans(source).map((range) => range.text)
    expect(protectedText).toEqual(expect.arrayContaining(['`src/App.jsx`', 'npm test', 'The request failed with status 404.']))
  })

  it('batches a long thought instead of making one model request per sentence', () => {
    const sentence = 'This sentence carries enough detail to be useful, but it should not create a separate request. '
    const source = sentence.repeat(14)
    const parts = splitReasoning(source)
    expect(parts.map((part) => part.text).join('')).toBe(source)
    expect(parts.length).toBeLessThan(5)
    expect(parts.every((part) => part.text.length <= 720)).toBe(true)
  })

  it('deduplicates replayed or cumulative thinking blocks without eating short repetition', () => {
    const first = '她正在认真想清楚这件事，再决定该怎么回答。'
    expect(appendReasoningDelta(first, first)).toBe(first)
    expect(appendReasoningDelta(first, `${first}然后继续。`)).toBe(`${first}然后继续。`)
    expect(appendReasoningDelta('她先确认了前半段内容，然后继续思考这一点。', '然后继续思考这一点。最后作答。'))
      .toBe('她先确认了前半段内容，然后继续思考这一点。最后作答。')
    expect(appendReasoningDelta('好，', '好。')).toBe('好，好。')
  })

  it('skips Chinese and protected-only segments', () => {
    expect(isMostlyChinese('已经确认这个方案可以继续。')).toBe(true)
    expect(shouldTranslateReasoningSegment('已经确认这个方案可以继续。')).toBe(false)
    expect(shouldTranslateReasoningSegment('`/opt/ai-companion/config/gemini.secret`')).toBe(false)
    expect(shouldTranslateReasoningSegment('The answer is uncertain.')).toBe(true)
  })

  it('shows raw text immediately and plays completed translations in order', async () => {
    vi.useFakeTimers()
    const pending = []
    const translate = vi.fn(({ text }) => new Promise((resolve) => pending.push({ text, resolve })))
    const controller = new ReasoningTranslationController('message-order', translate)
    const source = 'First sentence carries enough context to belong in a useful translation batch. '.repeat(10)
    const expectedParts = splitReasoning(source)
    controller.update(source, false)

    expect(controller.snapshot().segments.map((segment) => segment.raw).join('')).toBe(source)
    expect(expectedParts.length).toBeGreaterThan(1)
    expect(translate).toHaveBeenCalledTimes(expectedParts.length)
    pending.slice(1).forEach((request, index) => request.resolve(`后续第 ${index + 2} 段。`))
    await flush()
    expect(controller.snapshot().segments[1].status).toBe('ready')
    expect(controller.snapshot().segments[0].status).toBe('loading')

    pending[0].resolve('第一段。')
    await flush()
    expect(controller.snapshot().segments[0].status).toBe('animating')
    expect(controller.snapshot().segments[1].status).toBe('ready')
    await vi.advanceTimersByTimeAsync(100)
    expect(controller.snapshot().segments[0].status).toBe('done')
    await vi.advanceTimersByTimeAsync(1000)
    expect(controller.snapshot().segments.every((segment) => segment.status === 'done')).toBe(true)
  })

  it('seals a sentence fragment after the 600ms idle window', async () => {
    vi.useFakeTimers()
    const translate = vi.fn().mockResolvedValue('这是一个片段。')
    const controller = new ReasoningTranslationController('message-idle', translate)
    controller.update('This is a fragment', true)
    expect(translate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(599)
    expect(translate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(translate).toHaveBeenCalledTimes(1)
  })

  it('falls back to raw text when Gemini fails and does not repeat a completed animation', async () => {
    vi.useFakeTimers()
    const translate = vi.fn().mockRejectedValue(new Error('offline'))
    const controller = new ReasoningTranslationController('message-failure', translate)
    controller.update('The network is unavailable.', false)
    await flush()
    expect(controller.snapshot().segments[0]).toMatchObject({ status: 'fallback', translation: 'The network is unavailable.' })

    const successful = vi.fn().mockResolvedValue('网络不可用。')
    const second = new ReasoningTranslationController('message-success', successful)
    second.update('The network is unavailable.', false)
    await flush()
    await vi.advanceTimersByTimeAsync(500)
    expect(second.snapshot().segments[0].status).toBe('done')
    const calls = successful.mock.calls.length
    second.update('The network is unavailable.', false)
    expect(successful).toHaveBeenCalledTimes(calls)
  })
})
