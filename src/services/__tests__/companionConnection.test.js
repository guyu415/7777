import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class MockWebSocket {
  static instances = []

  constructor(url) {
    this.url = url
    this.sent = []
    MockWebSocket.instances.push(this)
  }

  send(payload) {
    this.sent.push(JSON.parse(payload))
  }

  open() {
    this.onopen?.()
  }

  message(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  close() {
    this.onclose?.({ wasClean: true, code: 1000 })
  }
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('companion connection recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-15T00:00:00Z'))
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
    vi.stubGlobal('localStorage', memoryStorage())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('recovers an in-flight reply after a forced foreground reconnect', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({
      text: '在吗', messageId: 'turn-1', voiceEmotion: 'sad', voiceAcoustics: { pitchHz: 129 },
    })
    const firstChunk = stream.next()
    await flush()

    const oldSocket = MockWebSocket.instances[0]
    oldSocket.open()
    await flush()
    expect(oldSocket.sent.some(m => m.id === 'turn-1')).toBe(true)
    expect(oldSocket.sent.find(m => m.id === 'turn-1')).toMatchObject({
      voiceEmotion: 'sad', voiceAcoustics: { pitchHz: 129 },
    })

    companion.reconnectCompanion()
    const freshSocket = MockWebSocket.instances[1]
    freshSocket.open()
    freshSocket.message({
      type: 'history', openTurnId: null, queuedTurnIds: [], resetAt: 0,
      items: [{ type: 'msg', id: 'reply-1', from: 'cc', text: '我在', ts: Date.now(), turnId: 'turn-1' }],
    })

    await expect(firstChunk).resolves.toEqual({ value: { text: '我在', wireId: 'reply-1' }, done: false })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('probes and replaces a stale-looking socket before sending', async () => {
    const companion = await import('../companion.js')
    companion.ensureConnected()
    const oldSocket = MockWebSocket.instances[0]
    oldSocket.open()
    vi.setSystemTime(new Date('2026-08-15T00:00:13Z'))

    const stream = companion.streamChatViaCompanion({ text: '回来啦', messageId: 'turn-2' })
    const firstChunk = stream.next()
    await flush()
    expect(oldSocket.sent.at(-1)).toMatchObject({ type: 'ping' })
    expect(oldSocket.sent.some(m => m.id === 'turn-2')).toBe(false)

    await vi.advanceTimersByTimeAsync(2500)
    const freshSocket = MockWebSocket.instances[1]
    freshSocket.open()
    await flush()
    expect(freshSocket.sent.some(m => m.id === 'turn-2')).toBe(true)

    freshSocket.message({ type: 'msg', id: 'reply-2', from: 'cc', text: '嗯', ts: Date.now(), turnId: 'turn-2' })
    freshSocket.message({ type: 'turn_end', turnId: 'turn-2' })
    await expect(firstChunk).resolves.toEqual({ value: { text: '嗯', wireId: 'reply-2' }, done: false })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('broadcasts server-side message deletions to subscribers', async () => {
    const companion = await import('../companion.js')
    const deleted = []
    companion.onCcMessageDeleted(ids => deleted.push(ids))
    companion.ensureConnected()
    const socket = MockWebSocket.instances[0]
    socket.open()
    socket.message({ type: 'msg_deleted', ids: ['reply-1', 'reply-2'], ts: Date.now() })
    expect(deleted).toEqual([['reply-1', 'reply-2']])
  })
})
