import { useEffect, useMemo, useState } from 'react'
import { translateThinking } from '../services/reasoningTranslation'
import { getReasoningTranslationController } from '../utils/reasoningTranslation'

const EMPTY_SNAPSHOT = { raw: '', streaming: false, segments: [] }

/**
 * Connects a rendered Claude Code reasoning bubble to the ephemeral display
 * queue. The message object is intentionally read-only here; all updates are
 * local to the controller and disappear with the page.
 */
export function useReasoningTranslation(message, enabled) {
  const messageId = enabled ? String(message?.id || '') : ''
  const controller = useMemo(
    () => messageId ? getReasoningTranslationController(messageId, translateThinking) : null,
    [messageId],
  )
  const [, setRevision] = useState(0)
  const raw = typeof message?.reasoning === 'string' ? message.reasoning : ''
  const streaming = Boolean(message?.reasoningStreaming)

  useEffect(() => {
    if (!controller) return undefined
    return controller.subscribe(() => setRevision((revision) => revision + 1))
  }, [controller])

  useEffect(() => {
    controller?.update(raw, streaming)
  }, [controller, raw, streaming])

  if (!controller) return { ...EMPTY_SNAPSHOT, raw, streaming }
  const snapshot = controller.snapshot()
  // Effects run after paint. If a new raw delta is already in the message
  // object, never let an older translated snapshot briefly hide that delta.
  return snapshot.raw === raw ? snapshot : { ...EMPTY_SNAPSHOT, raw, streaming }
}
