import { useCallback, useEffect, useRef, useState } from 'react'

const MUTE_KEY = 'eunoia.pokerMuted'
let ctx = null
let musicTimer = null
let musicStep = 0
let ownerCount = 0

function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)()
  return ctx
}

function tone(freq, duration = 0.08, volume = 0.025, type = 'sine', delay = 0) {
  const ac = audioContext()
  const start = ac.currentTime + delay
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(ac.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

function startMusic() {
  if (musicTimer) return
  const notes = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23]
  const tick = () => {
    const note = notes[musicStep % notes.length]
    tone(note, 0.38, 0.032, 'sine')
    tone(note * 1.5, 0.22, 0.014, 'triangle', 0.1)
    if (musicStep % 4 === 0) tone(note / 2, 0.55, 0.018, 'triangle')
    musicStep += 1
  }
  tick()
  musicTimer = window.setInterval(tick, 540)
}

function stopMusic() {
  if (musicTimer) window.clearInterval(musicTimer)
  musicTimer = null
}

export function usePokerAudio() {
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1')
  const unlocked = useRef(false)

  const unlock = useCallback(async () => {
    if (muted) return
    const ac = audioContext()
    if (ac.state === 'suspended') ac.resume().catch(() => {})
    unlocked.current = true
    startMusic()
  }, [muted])

  useEffect(() => {
    ownerCount += 1
    const firstGesture = () => unlock()
    window.addEventListener('pointerdown', firstGesture, { once: true })
    return () => {
      ownerCount -= 1
      window.removeEventListener('pointerdown', firstGesture)
      if (ownerCount <= 0) stopMusic()
    }
  }, [unlock])

  useEffect(() => {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    if (muted) stopMusic()
    else if (unlocked.current) startMusic()
  }, [muted])

  const play = useCallback((kind) => {
    if (muted || !unlocked.current) return
    const map = {
      select: [520, .045], play: [330, .075], pass: [190, .07], bid: [440, .09],
      deal: [620, .04], bomb: [120, .25], win: [523, .14], lose: [196, .18], chip: [720, .04],
    }
    const [freq, duration] = map[kind] || map.play
    tone(freq, duration, kind === 'bomb' ? .05 : .025, kind === 'bomb' ? 'sawtooth' : 'sine')
    if (kind === 'win') { tone(659, .15, .025, 'sine', .12); tone(784, .2, .025, 'sine', .24) }
  }, [muted])

  const toggleMuted = useCallback(() => {
    if (muted) {
      const ac = audioContext()
      if (ac.state === 'suspended') ac.resume().catch(() => {})
      unlocked.current = true
      setMuted(false)
      startMusic()
    } else {
      setMuted(true)
    }
  }, [muted])

  return { muted, toggleMuted, play, unlock }
}
