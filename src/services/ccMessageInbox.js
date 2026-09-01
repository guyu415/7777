import { getMessages, saveBlob, saveMessage, useStore } from '../store'
import { ccWireToTimelineMessage, selectCcSnapshotDelta } from '../utils/ccTimeline'
import { messageIdentityKeys } from '../utils/messageTimeline'
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
    for (const id of messageIdentityKeys(message)) ids.add(id)
  }
  return ids
}

function currentCcSession() {
  return useStore.getState().sessions?.find(session => session.providerName === 'claude-code-vps') || null
}

function previewFor(message) {
  if (message.type === 'voice' || message.voiceLoading) return `[语音] ${message.voiceText || message.content || ''}`.slice(0, 40)
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
    const known = identitySet([...persisted, ...visible])
    let candidates = snapshot
      ? selectCcSnapshotDelta([...persisted, ...visible], wires)
      : (Array.isArray(wires) ? wires : []).filter(wire => wire?.id && !known.has(wire.id))
    candidates = candidates.filter(wire => wire?.id && !inFlightIds.has(wire.id))
    if (!candidates.length) return
    for (const wire of candidates) inFlightIds.add(wire.id)

    try {
      const messages = candidates
        .map(wire => ccWireToTimelineMessage(wire, session.id, { live }))
        .filter(Boolean)
      if (!messages.length) return

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
        for (let index = 0; index < candidates.length; index++) {
          if (candidates[index].kind === 'voice' && messages[index]) {
            void resolveLiveVoice(candidates[index], messages[index], session)
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
