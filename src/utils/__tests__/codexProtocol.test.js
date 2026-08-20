import { describe, expect, it } from 'vitest'
import { buildCodexMessagePayload, normalizeCodexSessionId } from '../codexProtocol'

describe('Codex session request protocol', () => {
  it('carries the active session and prompt on every message', () => {
    expect(buildCodexMessagePayload({
      id: 'm1', text: 'hello', sessionId: 'session-a', prompt: 'be concise', clientTime: { formatted: 'now' },
    })).toMatchObject({ runtime: 'codex', id: 'm1', text: 'hello', sessionId: 'session-a', prompt: 'be concise' })
  })

  it('uses the legacy main session when the id is absent', () => {
    expect(normalizeCodexSessionId('')).toBe('main')
    expect(buildCodexMessagePayload({ id: 'm2', text: 'hello', clientTime: null }).sessionId).toBe('main')
  })

  it('carries split user bubbles as one ordered turn payload', () => {
    expect(buildCodexMessagePayload({ id: 'm3', text: '一\n二', segments: ['一', '二'], sessionId: 's1' })).toMatchObject({
      text: '一\n二', segments: ['一', '二'], sessionId: 's1',
    })
  })

  it('carries acoustic emotion separately from the visible user text', () => {
    const payload = buildCodexMessagePayload({ id: 'voice-1', text: '我没事', sessionId: 's1', voiceEmotion: 'sad' })
    expect(payload.text).toBe('我没事')
    expect(payload.voiceEmotion).toBe('sad')
  })

  it('marks an image as its own bubble beside split text messages', () => {
    expect(buildCodexMessagePayload({
      id: 'm-image', text: '一\n二', segments: ['一', '二'], imageUrl: 'data:image/png;base64,x', imageSeparate: true, sessionId: 's1',
    })).toMatchObject({ segments: ['一', '二'], imageSeparate: true, imageUrl: 'data:image/png;base64,x' })
  })

  it('carries a server-uploaded file without embedding its bytes', () => {
    const payload = buildCodexMessagePayload({
      id: 'm4', text: '帮我看看', sessionId: 's1',
      file: { path: '/opt/ai-companion/uploads/a.pdf', name: '报告.pdf', size: 321, mimeType: 'application/pdf' },
    })
    expect(payload).toMatchObject({
      filePath: '/opt/ai-companion/uploads/a.pdf', fileName: '报告.pdf', fileSize: 321, fileType: 'application/pdf',
    })
    expect(JSON.stringify(payload)).not.toContain('base64')
  })
})
