import { useCallback, useEffect, useRef, useState } from 'react'
import { POKE_DOUBLE_TAP_MS } from '../../utils/poke'

function isIosWebKit() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua)
    || (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints) > 1)
}

// iOS does not implement navigator.vibrate(). Safari 18+ does, however,
// provide a system haptic when the user's finger directly toggles a native
// `input[switch]`. Arm this transparent native target after tap one so tap two
// both completes the existing double-tap detector and produces one real tick.
export function usePokeHapticArm() {
  const [armed, setArmed] = useState(false)
  const timerRef = useRef(null)

  const disarm = useCallback(() => {
    clearTimeout(timerRef.current)
    timerRef.current = null
    setArmed(false)
  }, [])

  const arm = useCallback(() => {
    if (!isIosWebKit()) return
    clearTimeout(timerRef.current)
    setArmed(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setArmed(false)
    }, POKE_DOUBLE_TAP_MS)
  }, [])

  useEffect(() => () => clearTimeout(timerRef.current), [])
  return { armed, arm, disarm }
}

export default function PokeHapticTarget({ armed }) {
  if (!armed) return null
  return (
    <input
      type="checkbox"
      switch=""
      tabIndex={-1}
      aria-hidden="true"
      defaultChecked={false}
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        width: '100%', height: '100%', margin: 0,
        opacity: 0.001, cursor: 'pointer',
        clipPath: 'circle(50% at 50% 50%)',
      }}
    />
  )
}
