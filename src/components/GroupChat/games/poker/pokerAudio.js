import { useCallback, useEffect, useState } from 'react'

const MUTE_KEY = 'eunoia.pokerMuted'
let ctx = null
let mediaBridge = null
let bridgeUrl = ''
let musicTimer = null
let recoveryTimer = null
let musicStep = 0
let ownerCount = 0
let audioWanted = false
let userUnlocked = false

// iOS 会把 WebAudio 和普通媒体分到不同的播放通道。来电/锁屏之后，单独的
// AudioContext 很容易永远留在 interrupted/suspended；这段循环静音 PCM 让它
// 同时持有正常媒体播放通道，回到页面后再恢复 WebAudio 就不会出现“来电后只
// 响一下又没声”。它不包含音乐，真正的牌桌音乐仍由下面的合成器生成。
function makeSilentWavUrl() {
  const sampleRate = 8000
  const samples = sampleRate / 4
  const buffer = new ArrayBuffer(44 + samples * 2)
  const view = new DataView(buffer)
  const text = (offset, value) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples * 2, true)
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

function getMediaBridge() {
  if (!mediaBridge) {
    bridgeUrl = makeSilentWavUrl()
    mediaBridge = new Audio(bridgeUrl)
    mediaBridge.loop = true
    mediaBridge.preload = 'auto'
    mediaBridge.volume = 0.01
    mediaBridge.setAttribute('playsinline', '')
    mediaBridge.setAttribute('webkit-playsinline', '')
  }
  return mediaBridge
}

function audioContext() {
  if (!ctx || ctx.state === 'closed') {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext
    if (!AudioContextClass) return null
    ctx = new AudioContextClass()
    ctx.onstatechange = () => {
      if (!audioWanted || ownerCount <= 0) return
      if (ctx.state === 'running') startMusic()
      else {
        stopMusic()
        // iOS 的来电结束通常不会触发 visibilitychange，所以监听状态本身。
        window.clearTimeout(recoveryTimer)
        recoveryTimer = window.setTimeout(() => resumeAudio(false), 250)
      }
    }
  }
  return ctx
}

async function resumeAudio(fromGesture = false) {
  if (!audioWanted || ownerCount <= 0) return false
  if (fromGesture) userUnlocked = true
  if (!userUnlocked) return false
  const ac = audioContext()
  try { await getMediaBridge().play() } catch { /* iOS 会等下一次手势再放行 */ }
  try {
    if (ac && ac.state !== 'running') await ac.resume()
  } catch { /* watchdog/下一次点击会继续恢复 */ }
  if (ac?.state === 'running') {
    startMusic()
    return true
  }
  return false
}

function tone(freq, duration = 0.08, volume = 0.025, type = 'sine', delay = 0) {
  const ac = audioContext()
  if (!ac || ac.state !== 'running') return
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
  if (musicTimer || !audioWanted || !userUnlocked || ownerCount <= 0 || ctx?.state !== 'running') return
  const notes = [261.63, 329.63, 392, 329.63, 293.66, 349.23, 440, 349.23]
  const tick = () => {
    if (ctx?.state !== 'running') return
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

function suspendAudio() {
  audioWanted = false
  stopMusic()
  window.clearTimeout(recoveryTimer)
  mediaBridge?.pause()
}

export function usePokerAudio() {
  const [muted, setMuted] = useState(() => localStorage.getItem(MUTE_KEY) === '1')

  const unlock = useCallback(async () => {
    if (muted) return
    audioWanted = true
    await resumeAudio(true)
  }, [muted])

  useEffect(() => {
    ownerCount += 1
    audioWanted = !muted

    // 首次点击负责取得 iOS 播放授权；之后每次交互都顺手检查一次，处理来电
    // 后浏览器没有正确发出前台事件的情况。
    const recoverFromGesture = () => {
      if (!muted) {
        audioWanted = true
        resumeAudio(true)
      }
    }
    const recoverFromLifecycle = () => {
      if (!muted && document.visibilityState !== 'hidden') {
        audioWanted = true
        resumeAudio(false)
      }
    }
    window.addEventListener('pointerdown', recoverFromGesture, { passive: true })
    window.addEventListener('touchend', recoverFromGesture, { passive: true })
    window.addEventListener('focus', recoverFromLifecycle)
    window.addEventListener('pageshow', recoverFromLifecycle)
    document.addEventListener('visibilitychange', recoverFromLifecycle)

    const watchdog = window.setInterval(() => {
      if (!muted && document.visibilityState !== 'hidden' && ctx?.state !== 'running') resumeAudio(false)
    }, 1500)

    if (!muted) resumeAudio(false)
    return () => {
      ownerCount = Math.max(0, ownerCount - 1)
      window.removeEventListener('pointerdown', recoverFromGesture)
      window.removeEventListener('touchend', recoverFromGesture)
      window.removeEventListener('focus', recoverFromLifecycle)
      window.removeEventListener('pageshow', recoverFromLifecycle)
      document.removeEventListener('visibilitychange', recoverFromLifecycle)
      window.clearInterval(watchdog)
      if (ownerCount <= 0) suspendAudio()
    }
  }, [muted])

  useEffect(() => {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
    if (muted) suspendAudio()
    else {
      audioWanted = true
      resumeAudio(false)
    }
  }, [muted])

  const play = useCallback((kind) => {
    if (muted || !userUnlocked) return
    if (ctx?.state !== 'running') {
      resumeAudio(false)
      return
    }
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
      audioWanted = true
      userUnlocked = true
      setMuted(false)
      resumeAudio(true)
    } else {
      setMuted(true)
    }
  }, [muted])

  return { muted, toggleMuted, play, unlock }
}
