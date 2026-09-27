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

  it('treats a standalone live poke as a visible reply', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '拍我一下', messageId: 'poke-turn' })
    const firstChunk = stream.next()
    await flush()

    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()
    socket.message({
      type: 'msg', kind: 'poke', id: 'poke-reply', from: 'cc', text: '', ts: Date.now(),
      turnId: 'poke-turn', before: '拍', after: '拍你的肩膀',
    })
    socket.message({ type: 'turn_end', turnId: 'poke-turn' })

    await expect(firstChunk).resolves.toEqual({
      value: { visibleAction: { type: 'poke', id: 'poke-reply' } },
      done: false,
    })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('recovers a standalone poke after reconnecting mid-turn', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '还在吗', messageId: 'poke-reconnect-turn' })
    const firstChunk = stream.next()
    await flush()

    const oldSocket = MockWebSocket.instances[0]
    oldSocket.open()
    await flush()
    expect(oldSocket.sent.some(m => m.id === 'poke-reconnect-turn')).toBe(true)

    companion.reconnectCompanion()
    const freshSocket = MockWebSocket.instances[1]
    freshSocket.open()
    freshSocket.message({
      type: 'history', openTurnId: null, queuedTurnIds: [], resetAt: 0,
      items: [{
        type: 'msg', kind: 'poke', id: 'poke-reconnect-reply', from: 'cc', text: '', ts: Date.now(),
        turnId: 'poke-reconnect-turn', before: '戳', after: '戳你的脸颊',
      }],
    })

    await expect(firstChunk).resolves.toEqual({
      value: { visibleAction: { type: 'poke', id: 'poke-reconnect-reply' } },
      done: false,
    })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('delivers a native media bubble during an active turn', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '做个视频', messageId: 'media-turn' })
    const firstChunk = stream.next()
    await flush()

    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()
    socket.message({
      type: 'msg', kind: 'media', id: 'media-reply', from: 'cc', text: '做好了', ts: Date.now(),
      turnId: 'media-turn', mediaId: '20260927-media-m1.html', mediaName: 'Clawd 泡泡浴.html',
      mediaSize: 27318, mediaType: 'text/html; charset=utf-8', mediaKind: 'animation',
    })
    socket.message({ type: 'turn_end', turnId: 'media-turn' })

    await expect(firstChunk).resolves.toEqual({
      value: {
        media: {
          id: 'media-reply', caption: '做好了', mediaId: '20260927-media-m1.html',
          mediaName: 'Clawd 泡泡浴.html', mediaSize: 27318,
          mediaType: 'text/html; charset=utf-8', mediaKind: 'animation',
        },
      },
      done: false,
    })
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

  it('reports visible progress phases without inserting status chunks into the reply stream', async () => {
    const companion = await import('../companion.js')
    const progress = []
    const stream = companion.streamChatViaCompanion({
      text: '帮我看看', messageId: 'progress-turn', onProgress: update => progress.push(update),
    })
    const firstChunk = stream.next()
    await flush()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()

    socket.message({ type: 'inbound_ack', id: 'progress-turn' })
    socket.message({ type: 'turn_start', turnId: 'progress-turn', ts: 1000 })
    await expect(firstChunk).resolves.toEqual({ value: { reasoningStartedAt: 1000 }, done: false })

    const toolChunk = stream.next()
    socket.message({ type: 'tool_use', turnId: 'progress-turn', tool: 'Read', detail: '/tmp/example.txt', ts: 2000 })
    await expect(toolChunk).resolves.toEqual({
      value: { toolUse: { tool: 'Read', detail: '/tmp/example.txt', ts: 2000 } }, done: false,
    })

    const replyChunk = stream.next()
    socket.message({ type: 'msg', id: 'progress-reply', from: 'cc', text: '看好了', ts: 3000, turnId: 'progress-turn' })
    socket.message({ type: 'turn_end', turnId: 'progress-turn' })
    await expect(replyChunk).resolves.toEqual({ value: { text: '看好了', wireId: 'progress-reply' }, done: false })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })

    expect(progress.map(update => update.phase)).toEqual([
      'sending', 'accepted', 'thinking', 'working', 'continuing',
    ])
  })

  it('patches late thinking onto an already delivered reply instead of yielding a second reply', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '下课了', messageId: 'late-turn' })
    const firstChunk = stream.next()
    await flush()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()

    socket.message({
      type: 'msg', id: 'late-reply', from: 'cc', text: '去休息一会儿。', ts: 5000,
      turnId: 'late-turn',
    })
    await expect(firstChunk).resolves.toEqual({
      value: { text: '去休息一会儿。', wireId: 'late-reply' }, done: false,
    })

    const patchChunk = stream.next()
    // Current/older servers can publish the transcript delta first. Once a
    // reply exists, it must not become a new standalone thinking bubble.
    socket.message({ type: 'thinking', turnId: 'late-turn', delta: '先确认她是不是下课了。' })
    socket.message({
      type: 'msg', id: 'late-reply', from: 'cc', text: '去休息一会儿。',
      thinking: '先确认她是不是下课了。', ts: 5000, turnId: 'late-turn',
    })
    await expect(patchChunk).resolves.toEqual({
      value: {
        reasoningPatch: '先确认她是不是下课了。',
        wireId: 'late-reply',
        reasoningCompletedAt: 5000,
      },
      done: false,
    })
    socket.message({ type: 'turn_end', turnId: 'late-turn' })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('restores buffered reasoning before a later new reply in the same turn', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '做个东西', messageId: 'multi-turn' })
    const firstChunk = stream.next()
    await flush()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()

    socket.message({
      type: 'msg', id: 'ack-reply', from: 'cc', text: '收到，我来做。', ts: 2000,
      turnId: 'multi-turn',
    })
    await expect(firstChunk).resolves.toEqual({
      value: { text: '收到，我来做。', wireId: 'ack-reply' }, done: false,
    })

    const reasoningChunk = stream.next()
    socket.message({
      type: 'msg', id: 'done-reply', from: 'cc', text: '做好了。', thinking: '检查结果。',
      ts: 9000, turnId: 'multi-turn',
    })
    await expect(reasoningChunk).resolves.toEqual({
      value: { reasoningReplace: '检查结果。', reasoningCompletedAt: 9000 }, done: false,
    })
    await expect(stream.next()).resolves.toEqual({
      value: { text: '做好了。', wireId: 'done-reply', reasoningCompletedAt: 9000 }, done: false,
    })
    socket.message({ type: 'turn_end', turnId: 'multi-turn' })
    await expect(stream.next()).resolves.toEqual({ value: undefined, done: true })
  })

  it('surfaces a reasoning safeguard refusal with a specific error code', async () => {
    const companion = await import('../companion.js')
    const stream = companion.streamChatViaCompanion({ text: '在思考链里回答', messageId: 'reasoning-turn' })
    const firstChunk = stream.next()
    await flush()
    const socket = MockWebSocket.instances[0]
    socket.open()
    await flush()

    socket.message({ type: 'turn_error', turnId: 'reasoning-turn', error: 'reasoning_extraction' })

    await expect(firstChunk).rejects.toMatchObject({
      message: 'Opus 5.5 拦截了这一轮关于思考链的请求',
      code: 'reasoning_extraction',
      turnId: 'reasoning-turn',
    })
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
