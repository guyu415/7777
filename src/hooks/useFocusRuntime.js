import { useCallback, useEffect, useState } from 'react'
import {
  ensureConnected, getFocusState, onFocusUpdate, onFocusFinished,
  startFocus, focusInteract, requestFocus, resumeFocusFromApproval,
  selfPauseFocus, selfResumeFocus, selfEndFocus,
} from '../services/companion'

export function formatFocusMs(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
}

// The ONE global Focus task, server-authoritative (see channel-server.ts's
// own Focus section) — not local/per-browser like the old preview build's
// pomodoroCore.js. Initial state comes from a real GET (mirrors
// useCodexChat.js's own refresh() pattern) rather than the WS 'history'
// snapshot, which has a known pre-existing gap for this and codexHistory
// alike (see companion.js's onFocusUpdate comment) — live updates after
// that come from real focus_update/focus_finished pushes, and the 1s tick
// here only ever RE-READS state.endAt (never decrements a local counter),
// so a backgrounded tab or full reload can never drift.
export function useFocusRuntime() {
  const [state, setState] = useState(null)
  const [loaded, setLoaded] = useState(false)
  const [justFinished, setJustFinished] = useState(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    ensureConnected()
    let cancelled = false
    getFocusState()
      .then((s) => { if (!cancelled) setState(s) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoaded(true) })
    const unsubUpdate = onFocusUpdate((s) => setState(s))
    const unsubFinished = onFocusFinished((payload) => setJustFinished(payload))
    return () => { cancelled = true; unsubUpdate(); unsubFinished() }
  }, [])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const remainingMs = (() => {
    if (!state || !state.active) return 0
    if (state.status === 'running' && state.endAt) return Math.max(0, state.endAt - now)
    return Math.max(0, state.remainingMs)
  })()

  const acknowledgeFinished = useCallback(() => setJustFinished(null), [])

  return {
    state, loaded, remainingMs, justFinished, acknowledgeFinished,
    todayCount: state?.todayCount ?? 0,
    format: formatFocusMs,
    startFocus, focusInteract, requestFocus, resumeFocusFromApproval,
    selfPauseFocus, selfResumeFocus, selfEndFocus,
  }
}
