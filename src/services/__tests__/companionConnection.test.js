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
      items: [{
        type: 'msg', id: 'reply-1', from: 'cc', text: '我在', ts: Date.now(),
        turnId: 'turn-1', thinking: '先确认她是不是在叫我。',
      }],
    })

    await expect(firstChunk).resolves.toEqual({
      value: { reasoningReplace: '先确认她是不是在叫我。', reasoningCompletedAt: Date.now() },
      done: false,
    })
    await expect(stream.next()).resolves.toEqual({ value: { text: '我在', wireId: 'reply-1' }, done: false })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('forwards server turn timestamps for an honest reasoning duration', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '想一想', messageId: 'timed-turn' })
    const firstChunk = stream.next()
    await flush()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()

    socket.message({ type: 'turn_start', turnId: 'timed-turn', ts: 1000 })
    await expect(firstChunk).resolves.toEqual({ value: { reasoningStartedAt: 1000 }, done: false })

    const thinkingChunk = stream.next()
    socket.message({ type: 'thinking', turnId: 'timed-turn', delta: '认真想想。' })
    await expect(thinkingChunk).resolves.toEqual({ value: { reasoning: '认真想想。' }, done: false })

    const replyChunk = stream.next()
    socket.message({
      type: 'msg', id: 'timed-reply', from: 'cc', text: '想好了', thinking: '认真想想。',
      ts: 7400, turnId: 'timed-turn',
    })
    await expect(replyChunk).resolves.toEqual({
      value: { text: '想好了', wireId: 'timed-reply', reasoningCompletedAt: 7400 },
      done: false,
    })
    socket.message({ type: 'turn_end', turnId: 'timed-turn' })
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

  it('marks voice-call turns without changing their visible text', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '喂', messageId: 'call-1', callMode: true })
    const firstChunk = stream.next()
    await flush()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()
    expect(socket.sent.find(m => m.id === 'call-1')).toMatchObject({ id: 'call-1', text: '喂', callMode: true })
    socket.message({ type: 'msg', id: 'reply-call-1', from: 'cc', text: '在呢。', ts: Date.now(), turnId: 'call-1' })
    socket.message({ type: 'turn_end', turnId: 'call-1' })
    await expect(firstChunk).resolves.toEqual({ value: { text: '在呢。', wireId: 'reply-call-1' }, done: false })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('delivers a NetEase phone action with its visible reply', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '放晴天', messageId: 'music-turn' })
    const firstChunk = stream.next()
    await flush()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()
    const musicAction = {
      provider: 'netease', songId: '186016', name: '晴天', artists: '周杰伦', album: '叶惠美', cover: '',
      deepLink: 'orpheus://song/186016/?autoplay=1', webUrl: 'https://music.163.com/song?id=186016',
    }
    socket.message({
      type: 'msg', id: 'music-reply', from: 'cc', text: '给你找到了，点一下播放。',
      ts: Date.now(), turnId: 'music-turn', musicAction,
    })
    socket.message({ type: 'turn_end', turnId: 'music-turn' })
    await expect(firstChunk).resolves.toEqual({
      value: { text: '给你找到了，点一下播放。', wireId: 'music-reply', musicAction },
      done: false,
    })
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

  it('delivers reconnect history as one snapshot instead of replaying live messages', async () => {
    const companion = await import('../companion.js')
    const snapshots = []
    const proactive = []
    companion.onCcHistorySnapshot(items => snapshots.push(items))
    companion.onProactiveMessage(message => proactive.push(message))
    companion.ensureConnected()
    const socket = MockWebSocket.instances[0]
    socket.open()
    socket.message({
      type: 'history', openTurnId: null, queuedTurnIds: [], resetAt: 0,
      items: [
        { type: 'msg', id: 'old-user', from: 'user', text: 'old', ts: 1 },
        { type: 'msg', id: 'old-ai', from: 'cc', text: 'old reply', ts: 2 },
      ],
    })
    await vi.runOnlyPendingTimersAsync()
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].map(item => item.id)).toEqual(['old-user', 'old-ai'])
    expect(proactive).toEqual([])
  })
})
