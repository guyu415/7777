import { useEffect, useMemo, useState } from 'react'
import { getMessage, getMessages, getReasoningTranslation, saveMessage, saveReasoningTranslation, useStore } from '../store'
import { translateThinking } from '../services/reasoningTranslation'
import { saveSessionMsgs } from '../services/sync'
import { getReasoningTranslationController, hashReasoningText } from '../utils/reasoningTranslation'

const EMPTY_SNAPSHOT = { raw: '', streaming: false, segments: [] }

/**
 * Connects a rendered Claude Code reasoning bubble to the display queue. A
 * completed translation is written back to the durable message so reopening
 * the sheet (or reloading the app) never translates the same text again.
 */
export function useReasoningTranslation(message, enabled) {
  const raw = typeof message?.reasoning === 'string' ? message.reasoning : ''
  const streaming = Boolean(message?.reasoningStreaming)
  const sourceHash = raw ? hashReasoningText(raw) : ''
  const durableMessageId = (Array.isArray(message?.serverWireIds) && message.serverWireIds[0]) || message?.id || ''
  const [durableTranslation, setDurableTranslation] = useState(null)
  const messageTranslation = sourceHash
    && message?.reasoningTranslationSourceHash === sourceHash
    && typeof message?.reasoningTranslation === 'string'
    && message.reasoningTranslation
  const persistedTranslation = enabled
    && sourceHash
    && (messageTranslation || (durableTranslation?.sourceHash === sourceHash ? durableTranslation.text : ''))
  const messageId = enabled && !persistedTranslation ? String(message?.id || '') : ''
  const controller = useMemo(
    () => messageId ? getReasoningTranslationController(messageId, translateThinking) : null,
    [messageId],
  )
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!controller) return undefined
    return controller.subscribe(() => setRevision((revision) => revision + 1))
  }, [controller])

  useEffect(() => {
    controller?.update(raw, streaming)
  }, [controller, raw, streaming])

  useEffect(() => {
    let cancelled = false
    if (!enabled || !durableMessageId || !sourceHash || messageTranslation) {
      setDurableTranslation(null)
      return () => { cancelled = true }
    }
    getReasoningTranslation(durableMessageId, sourceHash)
      .then(record => {
        if (!cancelled && record?.text) setDurableTranslation({ sourceHash, text: record.text })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [durableMessageId, enabled, messageTranslation, sourceHash])

  useEffect(() => {
    if (!controller || streaming || !raw || !message?.id) return
    const snapshot = controller.snapshot()
    if (snapshot.raw !== raw || !snapshot.segments.length) return
    if (snapshot.segments.some(segment => !['done', 'fallback', 'skip'].includes(segment.status))) return
    // A temporary model/rate-limit failure displays the original segment but
    // must not be persisted as if it were a successful translation. That
    // lets a reopen/reload retry it after the translator recovers.
    if (snapshot.segments.some(segment => segment.status === 'fallback')) return
    const translated = snapshot.segments.map(segment => segment.translation || segment.raw).join('')
    if (!translated || message.reasoningTranslationSourceHash === sourceHash) return

    const fields = {
      reasoningTranslation: translated,
      reasoningTranslationSourceHash: sourceHash,
      reasoningTranslationUpdatedAt: Date.now(),
    }
    // Store the display translation in its own object store before touching
    // the frequently-replayed chat row. Even a future transport snapshot
    // that replaces the whole message cannot erase this keyed copy.
    setDurableTranslation({ sourceHash, text: translated })
    void saveReasoningTranslation(durableMessageId, sourceHash, translated)
      .catch(error => console.warn('[REASONING-TRANSLATION] 独立持久化失败:', error?.message))
    useStore.getState().updateMessage(message.id, fields)
    void (async () => {
      const persisted = await getMessage(message.id).catch(() => null)
      await saveMessage({ ...(persisted || message), ...fields })
      const password = globalThis.localStorage?.getItem('auth.password')
      if (!password || !message.conversationId) return
      const messages = (await getMessages(message.conversationId)).filter(item => !item.streaming)
      await saveSessionMsgs(password, message.conversationId, messages)
    })().catch(error => console.warn('[REASONING-TRANSLATION] 持久化失败:', error?.message))
  }, [controller, durableMessageId, message, raw, revision, sourceHash, streaming])

  if (persistedTranslation) {
    return {
      raw,
      streaming,
      segments: [{
        id: `persisted-${sourceHash}`,
        start: 0,
        end: raw.length,
        raw,
        status: 'done',
        translation: persistedTranslation,
        revealedChars: Array.from(persistedTranslation).length,
      }],
    }
  }

  if (!controller) return { ...EMPTY_SNAPSHOT, raw, streaming }
  const snapshot = controller.snapshot()
  // Effects run after paint. If a new raw delta is already in the message
  // object, never let an older translated snapshot briefly hide that delta.
  return snapshot.raw === raw ? snapshot : { ...EMPTY_SNAPSHOT, raw, streaming }
}
