let audioContext = null
let armed = false

function getContext() {
  if (audioContext && audioContext.state !== 'closed') return audioContext
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass) return null
  audioContext = new AudioContextClass()
  return audioContext
}

// Call inside a real tap/click (start, resume, or any interaction on the
// Focus screen). iOS requires this once before a later timer callback may
// make sound; the silent oscillator is deliberately inaudible.
export function armFocusAlarm() {
  try {
    const ctx = getContext()
    if (!ctx) return false
    ctx.resume().catch(() => {})
    const gain = ctx.createGain()
    gain.gain.value = 0
    const oscillator = ctx.createOscillator()
    oscillator.connect(gain).connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.02)
    armed = true
    return true
  } catch {
    return false
  }
}

export function playFocusAlarm() {
  try {
    const ctx = getContext()
    if (!ctx || !armed) return false
    ctx.resume().catch(() => {})
    const start = ctx.currentTime + 0.03
    const notes = [
      [0, 659.25], [0.28, 783.99], [0.56, 987.77],
      [1.02, 783.99], [1.30, 987.77], [1.58, 1318.51],
    ]
    for (const [offset, frequency] of notes) {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, start + offset)
      gain.gain.exponentialRampToValueAtTime(0.22, start + offset + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.24)
      oscillator.connect(gain).connect(ctx.destination)
      oscillator.start(start + offset)
      oscillator.stop(start + offset + 0.26)
    }
    return true
  } catch {
    return false
  }
}
