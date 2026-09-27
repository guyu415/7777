import { describe, expect, test } from 'bun:test'
import { isPublicAssistantMediaId, newAssistantMediaId } from '../assistant-media'

describe('assistant media capability links', () => {
  test('creates unique 128-bit capability ids for supported media', () => {
    const first = newAssistantMediaId('20260927', '.html')
    const second = newAssistantMediaId('20260927', '.html')
    expect(first).toMatch(/^20260927-media-[a-f0-9]{32}\.html$/)
    expect(second).not.toBe(first)
    expect(isPublicAssistantMediaId(first)).toBeTrue()
  })

  test('keeps legacy and malformed ids out of the public route', () => {
    expect(isPublicAssistantMediaId('20260927-media-clawd-bath.html')).toBeFalse()
    expect(isPublicAssistantMediaId('20260927-media-abc123.html')).toBeFalse()
    expect(isPublicAssistantMediaId('20260927-media-0123456789abcdef0123456789abcdef.exe')).toBeFalse()
  })
})
