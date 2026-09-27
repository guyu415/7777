import { getMessages, saveBlob, saveMessage, useStore } from '../store'
import { ccWireToTimelineMessages, selectCcSnapshotDelta } from '../utils/ccTimeline'
import { messageServerIdentityKeys } from '../utils/messageTimeline'
import {
  onCcHistorySnapshot,
  onProactiveMessage,
  onRemoteUserMessage,
} from './companion'
import { saveSessionMsgs } from './sync'
import { fetchTTSAudio } from './tts'

function identitySet(messages) {
  const ids = new Set()
  for (const message of messages) {
    for (const id of messageServerIdentityKeys(message)) ids.add(id)
  }
  return ids
}

export function findCcReasoningTarget(messages, wire) {
  if (!wire?.id || typeof wire.thinking !== 'string' || !wire.thinking.trim()) return null
  return (Array.isArray(messages) ? messages : []).find(message => (
    message?.role === 'assistant'
    && Number(message.wirePartIndex || 0) === 0
    && messageServerIdentityKeys(message).includes(wire.id)
  )) || null
}

export function ccReasoningUpdates(target, wire) {
  const startedAt = Number(target.reasoningStartedAt) || Number(target.timestamp) || Date.now()
  const completedAt = Math.max(startedAt, Number(wire.ts) || Date.now())
  return {
    reasoning: wire.thinking,
    reasoningStartedAt: startedAt,
    reasoningCompletedAt: completedAt,
    reasoningDurationMs: Math.max(1, completedAt - startedAt),
    reasoningStreaming: false,
  }
}

function currentCcSession() {
  return useStore.getState().sessions?.find(session => session.providerName === 'claude-code-vps') || null
}

function previewFor(message) {
  if (message.bedtimeCard) return `🌙 ${message.bedtimeCard.english || message.content || '睡前英文寄语'}`.slice(0, 40)
  if (message.type === 'voice' || message.voiceLoading) return `[语音] ${message.voiceText || message.content || ''}`.slice(0, 40)
  if (message.type === 'media') return `[${message.mediaKind === 'video' ? '视频' : '动画'}] ${message.mediaName || message.content || ''}`.slice(0, 40)
  return (message.content || '').slice(0, 40)
}

// Owns every CC message that did not come through useChat's currently awaited
// turn: live proactive messages, remote user wires and reconnect recovery.
// All sources enter one serial queue and one batched store mutation.
export function subscribeCcMessageInbox() {
  let stopped = false
  let queue = Promise.resolve()
  const inFlightIds = new Set()
  const cloudTimers = new Map()

  const scheduleCloudSync = (sessionId) => {
    clearTimeout(cloudTimers.get(sessionId))
    cloudTimers.set(sessionId, setTimeout(async () => {
      cloudTimers.delete(sessionId)
      const password = globalThis.localStorage?.getItem('auth.password')
      if (!password) return
      try {
        const messages = (await getMessages(sessionId))
          .filter(message => !message.streaming)
          .sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
        await saveSessionMsgs(password, sessionId, messages)
      } catch (error) {
        console.warn('[CC-INBOX] 云端消息同步失败:', error?.message)
      }
    }, 500))
  }

  const resolveLiveVoice = async (wire, initialMessage, session) => {
    const state = useStore.getState()
    const apiKey = session.ttsApiKey || state.ttsApiKey
    const groupId = session.ttsGroupId || state.ttsGroupId
    const voiceId = session.ttsVoiceId || state.ttsVoiceId
    const model = session.ttsModel || state.ttsModel
    let updates

    if (!apiKey || !groupId) {
      updates = { type: 'text', content: wire.text || '', voiceText: wire.text || '', voiceLoading: false, voiceFailed: true }
    } else {
      try {
        const blob = await fetchTTSAudio(wire.text || '', {
          apiKey, groupId, voiceId: wire.voice || voiceId || 'English_Trustworthy_Man', model,
        })
        let duration = 0
        try {
          const audioContext = new AudioContext()
          const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer())
          duration = Math.round(decoded.duration)
          audioContext.close()
        } catch {}
        const voiceBlobId = `${wire.id}-blob`
        await saveBlob(voiceBlobId, blob)
        updates = {
          type: 'voice', content: '', voiceText: wire.text || '', voiceBlobId,
          duration, voiceLoading: false, voiceFailed: false,
        }
      } catch (error) {
        console.error('[CC-INBOX] 主动语音合成失败:', error?.message)
        updates = { type: 'text', content: wire.text || '', voiceText: wire.text || '', voiceLoading: false, voiceFailed: true }
      }
    }

    const complete = { ...initialMessage, ...updates }
    await saveMessage(complete).catch(error => console.error('[CC-INBOX] 语音落库失败:', error?.message))
    const latest = useStore.getState()
    if (latest.currentSessionId === session.id) latest.updateMessage(wire.id, updates)
    latest.updateSession(session.id, { lastMsgPreview: previewFor(complete), lastMsgTime: complete.timestamp })
    scheduleCloudSync(session.id)
  }

  const ingest = async (wires, { snapshot = false, live = false } = {}) => {
    if (stopped) return
    const session = currentCcSession()
    if (!session) return

    const persisted = await getMessages(session.id).catch(() => [])
    const stateBefore = useStore.getState()
    const visible = stateBefore.currentSessionId === session.id ? stateBefore.messages : []
    const localMessages = [...visible, ...persisted]
    const known = identitySet(localMessages)
    const isReasoningRevision = wire => {
      const target = findCcReasoningTarget(localMessages, wire)
      return Boolean(target && target.reasoning !== wire.thinking)
    }
    let candidates = snapshot
      ? selectCcSnapshotDelta([...persisted, ...visible], wires)
      : (Array.isArray(wires) ? wires : []).filter(wire => (
          wire?.id && (!known.has(wire.id) || isReasoningRevision(wire))
        ))
    candidates = candidates.filter(wire => wire?.id && !inFlightIds.has(wire.id))
    if (!candidates.length) return
    for (const wire of candidates) inFlightIds.add(wire.id)

    try {
      // Same-id thinking revisions update the existing first fragment in
      // place. Mapping them as new wires would write a second IndexedDB row
      // under the server id and rely on later timeline dedupe to hide it.
      // Patching the real local id keeps store, IndexedDB and cloud history
      // aligned for live delivery, late turn_end updates and reconnect repair.
      const revisions = []
      const newWires = []
      for (const wire of candidates) {
        const target = findCcReasoningTarget(localMessages, wire)
        if (target && known.has(wire.id)) revisions.push({ wire, target })
        else if (!known.has(wire.id)) newWires.push(wire)
      }

      let revised = false
      for (const { wire, target } of revisions) {
        if (target.reasoning === wire.thinking) continue
        const updates = ccReasoningUpdates(target, wire)
        const current = useStore.getState()
        if (current.currentSessionId === session.id) current.updateMessage(target.id, updates)
        await saveMessage({ ...target, ...updates }).catch(error => {
          console.error('[CC-INBOX] 思考更新落库失败:', error?.message)
        })
        revised = true
      }

      const messages = newWires
        .flatMap(wire => ccWireToTimelineMessages(wire, session.id, { live }) || [])
        .filter(Boolean)
      if (!messages.length) {
        if (revised) scheduleCloudSync(session.id)
        return
      }

      // One store commit for the whole snapshot/live batch. This is the only
      // place recovered wires become visible, so no callback race can decide
      // their order.
      const current = useStore.getState()
      if (current.currentSessionId === session.id) current.mergeMessages(messages)
      const latestMessage = messages.reduce((latest, message) => (
        Number(message.timestamp || 0) >= Number(latest.timestamp || 0) ? message : latest
      ))
      const currentSession = current.sessions?.find(item => item.id === session.id)
      if (Number(latestMessage.timestamp || 0) >= Number(currentSession?.lastMsgTime || 0)) {
        current.updateSession(session.id, {
          lastMsgPreview: previewFor(latestMessage),
          lastMsgTime: latestMessage.timestamp,
        })
      }

      await Promise.all(messages.map(message => saveMessage(message).catch(error => {
        console.error('[CC-INBOX] 消息落库失败:', error?.message)
      })))
      scheduleCloudSync(session.id)

      if (live) {
        for (const wire of newWires) {
          if (wire.kind === 'voice') {
            const voiceMessage = messages.find(message => message.id === wire.id)
            if (voiceMessage) void resolveLiveVoice(wire, voiceMessage, session)
          }
        }
      }
    } finally {
      for (const wire of candidates) inFlightIds.delete(wire.id)
    }
  }

  const enqueue = (task) => {
    queue = queue.then(() => stopped ? undefined : task()).catch(error => {
      console.error('[CC-INBOX] 事件处理失败:', error?.message)
    })
  }

  const unsubHistory = onCcHistorySnapshot(items => enqueue(() => ingest(items, { snapshot: true, live: false })))
  const unsubRemoteUser = onRemoteUserMessage(message => enqueue(() => ingest([{
    type: 'msg', id: message.id, from: 'user', text: message.text, ts: message.ts,
  }], { live: true })))
  const unsubProactive = onProactiveMessage(message => enqueue(() => ingest([{
    type: 'msg', from: 'cc', ...message,
  }], { live: true })))

  return () => {
    stopped = true
    unsubHistory()
    unsubRemoteUser()
    unsubProactive()
    for (const timer of cloudTimers.values()) clearTimeout(timer)
    cloudTimers.clear()
  }
}
