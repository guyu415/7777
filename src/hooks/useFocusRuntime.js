import { useCallback, useEffect, useState } from 'react'
import {
  ensureConnected, reconnectCompanion, getFocusState, onFocusUpdate, onFocusFinished,
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

  const refresh = useCallback(async () => {
    const next = await getFocusState()
    setState(next)
    return next
  }, [])

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

  // Guided Access and other iOS system overlays freeze the page. On return,
  // Safari can leave the old WebSocket looking OPEN even though it can no
  // longer receive focus_update events. Rebuild that socket and immediately
  // re-read the server-authoritative timer. The HTTP refresh also makes the
  // UI usable before the replacement socket finishes its handshake.
  useEffect(() => {
    let wasAway = document.visibilityState === 'hidden'

    const recover = () => {
      if (document.visibilityState === 'hidden') return
      reconnectCompanion()
      refresh().catch(() => {})
      setNow(Date.now())
      wasAway = false
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasAway = true
      } else if (wasAway) {
        recover()
      }
    }
    const onPageHide = () => { wasAway = true }
    const onPageShow = (event) => { if (wasAway || event.persisted) recover() }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', recover)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', recover)
    }
  }, [refresh])

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

  // Focus mutations use HTTP, while their visual updates normally arrive on
  // the WebSocket. Always reconcile from HTTP as well so a temporarily stale
  // socket can never leave pause/resume/send looking like a dead button.
  const mutateAndRefresh = useCallback(async (operation, ...args) => {
    try {
      return await operation(...args)
    } finally {
      await refresh().catch(() => {})
      setNow(Date.now())
    }
  }, [refresh])

  const start = useCallback((opts) => mutateAndRefresh(startFocus, opts), [mutateAndRefresh])
  const interact = useCallback((text) => mutateAndRefresh(focusInteract, text), [mutateAndRefresh])
  const request = useCallback((kind, reason) => mutateAndRefresh(requestFocus, kind, reason), [mutateAndRefresh])
  const resume = useCallback(() => mutateAndRefresh(resumeFocusFromApproval), [mutateAndRefresh])
  const selfPause = useCallback(() => mutateAndRefresh(selfPauseFocus), [mutateAndRefresh])
  const selfResume = useCallback(() => mutateAndRefresh(selfResumeFocus), [mutateAndRefresh])
  const selfEnd = useCallback(() => mutateAndRefresh(selfEndFocus), [mutateAndRefresh])

  return {
    state, loaded, remainingMs, justFinished, acknowledgeFinished,
    todayCount: state?.todayCount ?? 0,
    format: formatFocusMs,
    refresh,
    startFocus: start, focusInteract: interact, requestFocus: request, resumeFocusFromApproval: resume,
    selfPauseFocus: selfPause, selfResumeFocus: selfResume, selfEndFocus: selfEnd,
  }
}
