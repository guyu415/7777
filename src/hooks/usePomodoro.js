import { useCallback, useEffect, useRef, useState } from 'react'
import * as core from '../services/pomodoroCore'

// Drives the whole Focus feature off ONE persisted state (pomodoroCore) with
// a 1s render tick — the tick never advances a counter itself, it just
// re-reads `endAt - Date.now()` (via core.remaining), so a backgrounded tab,
// a full page reload, or a phone falling asleep can never cause drift: the
// displayed time is always recomputed from the real end timestamp, never
// carried forward locally. `storage` + a same-tab CustomEvent keep multiple
// mounted instances (e.g. sheet + fullscreen session momentarily overlapping)
// in sync with each other and with whatever's actually in localStorage.
export function usePomodoro() {
  const [state, setState] = useState(() => core.load())
  // One-shot: which phase just finished, so FocusSession can show a
  // completion page exactly once per real completion — cleared by the
  // caller (acknowledgeCompletion) once it's been shown, never re-derived
  // by diffing old/new state (which would misfire on e.g. a tab remount).
  const [justCompleted, setJustCompleted] = useState(null)
  const tickTimer = useRef(null)

  const doTick = useCallback(() => {
    const { state: next, finished } = core.tick()
    setState(next)
    if (finished) setJustCompleted(finished)
  }, [])

  useEffect(() => {
    doTick()
    tickTimer.current = setInterval(doTick, 1000)
    const onExternal = () => doTick()
    window.addEventListener('storage', onExternal)
    window.addEventListener(core.CHANGED_EVENT, onExternal)
    // Catch a completion that happened while the tab was backgrounded (timers
    // can be throttled/suspended) as soon as it becomes visible again.
    document.addEventListener('visibilitychange', onExternal)
    return () => {
      clearInterval(tickTimer.current)
      window.removeEventListener('storage', onExternal)
      window.removeEventListener(core.CHANGED_EVENT, onExternal)
      document.removeEventListener('visibilitychange', onExternal)
    }
  }, [doTick])

  const startFocusSession = useCallback(({ task, minutes, managed }) => {
    setJustCompleted(null)
    setState(core.startFocusSession({ task, minutes, managed }))
  }, [])
  const pauseFocus = useCallback(() => setState(core.pauseFocus()), [])
  const resumeFocus = useCallback(() => setState(core.resumeFocus()), [])
  const endFocus = useCallback(() => { setJustCompleted(null); setState(core.endFocus()) }, [])
  const startBreak = useCallback(() => { setJustCompleted(null); setState(core.startBreak()) }, [])
  const skipBreak = useCallback(() => { setJustCompleted(null); setState(core.skipBreak()) }, [])
  const markGuidedAccessReady = useCallback(() => setState(core.markGuidedAccessReady()), [])
  const acknowledgeCompletion = useCallback(() => setJustCompleted(null), [])

  return {
    state,
    remainingMs: core.remaining(state),
    todayCount: core.completedToday(state),
    justCompleted,
    startFocusSession,
    pauseFocus,
    resumeFocus,
    endFocus,
    startBreak,
    skipBreak,
    markGuidedAccessReady,
    acknowledgeCompletion,
    format: core.format,
  }
}
