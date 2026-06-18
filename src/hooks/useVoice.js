import { useState, useRef, useCallback } from 'react'
import { saveBlob, getBlob } from '../store'

export function useVoice() {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)

  const startRecording = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.start(100)
    mediaRecorderRef.current = mr
    setIsRecording(true)
    setRecordingSeconds(0)
    timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000)
  }, [])

  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current
      if (!mr) return resolve(null)
      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const id = 'voice_' + Date.now()
        await saveBlob(id, blob)
        const url = URL.createObjectURL(blob)
        resolve({ id, url, duration: recordingSeconds })
        mr.stream.getTracks().forEach(t => t.stop())
      }
      mr.stop()
      clearInterval(timerRef.current)
      setIsRecording(false)
    })
  }, [recordingSeconds])

  const cancelRecording = useCallback(() => {
    const mr = mediaRecorderRef.current
    if (mr) {
      mr.stream.getTracks().forEach(t => t.stop())
      mr.stop()
    }
    clearInterval(timerRef.current)
    setIsRecording(false)
    setRecordingSeconds(0)
  }, [])

  return { isRecording, recordingSeconds, startRecording, stopRecording, cancelRecording }
}
