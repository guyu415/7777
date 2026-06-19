import { useRef, useState, useCallback } from 'react'
import { useStore } from '../store'
import { fetchTTSAudio } from '../services/tts'

export function useTTS() {
  const { ttsApiKey, ttsGroupId, ttsVoiceId, ttsAutoRead } = useStore()
  const audioRef = useRef(null)
  const objectUrlRef = useRef(null)
  const [playingId, setPlayingId] = useState(null)
  const [loadingId, setLoadingId] = useState(null)

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.onended = null
      audioRef.current.onerror = null
      audioRef.current = null
    }
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current)
      objectUrlRef.current = null
    }
    setPlayingId(null)
    setLoadingId(null)
  }, [])

  const play = useCallback(async (msgId, text) => {
    if (playingId === msgId || loadingId === msgId) {
      stop()
      return
    }
    stop()
    if (!ttsApiKey || !ttsGroupId) return

    setLoadingId(msgId)
    try {
      const blob = await fetchTTSAudio(text, {
        apiKey: ttsApiKey,
        groupId: ttsGroupId,
        voiceId: ttsVoiceId || 'English_Trustworthy_Man',
      })
      const url = URL.createObjectURL(blob)
      objectUrlRef.current = url
      const audio = new Audio(url)
      audioRef.current = audio
      setLoadingId(null)
      setPlayingId(msgId)
      audio.onended = () => {
        setPlayingId(null)
        URL.revokeObjectURL(url)
        objectUrlRef.current = null
      }
      audio.onerror = () => {
        setPlayingId(null)
        URL.revokeObjectURL(url)
        objectUrlRef.current = null
      }
      audio.play()
    } catch (e) {
      setLoadingId(null)
      console.error('[TTS]', e.message)
    }
  }, [ttsApiKey, ttsGroupId, ttsVoiceId, playingId, loadingId, stop])

  return {
    play,
    stop,
    playingId,
    loadingId,
    ttsEnabled: !!(ttsApiKey && ttsGroupId),
    ttsAutoRead,
  }
}
