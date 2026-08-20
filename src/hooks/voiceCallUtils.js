function normalizeSpeech(text) {
  return String(text || '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]/gu, '')
}

// iPhone speaker output can linger after TTS playback has ended. Reject only
// a near-immediate recognition that is a meaningful fragment of the line we
// just played, without imposing a long microphone cooldown on real replies.
export function isLikelyPlaybackEcho(candidate, playbackText, elapsedMs, maxAgeMs = 5000) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0 || elapsedMs > maxAgeMs) return false
  const heard = normalizeSpeech(candidate)
  const played = normalizeSpeech(playbackText)
  if (heard.length < 2 || played.length < 2) return false
  if (heard === played) return true
  // Two- or three-character replies frequently repeat natural words from the
  // other person (e.g. “还好”). Only treat partial matches as echo once the
  // recognized fragment is distinctive enough.
  if (Math.min(heard.length, played.length) < 4) return false
  return heard.includes(played) || played.includes(heard)
}
