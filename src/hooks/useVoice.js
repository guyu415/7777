import { useState, useRef, useCallback } from 'react'
import { saveBlob } from '../store'

const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition
export const supportsSTT = !!SpeechRecognitionAPI

export function useVoice() {
  const [isRecording, setIsRecording] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const mediaRecorderRef = useRef(null)
  const chunksRef = useRef([])
  const timerRef = useRef(null)
  const recognitionRef = useRef(null)
  const transcriptRef = useRef('')

  const startRecording = useCallback(async () => {
    transcriptRef.current = ''
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    chunksRef.current = []
    mr.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    mr.start(100)
    mediaRecorderRef.current = mr

    if (SpeechRecognitionAPI) {
      const recognition = new SpeechRecognitionAPI()
      recognition.lang = 'zh-CN'
      recognition.continuous = true
      recognition.interimResults = false
      recognition.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) {
            transcriptRef.current += e.results[i][0].transcript
          }
        }
      }
      recognition.onerror = () => {}
      recognition.start()
      recognitionRef.current = recognition
    }

    setIsRecording(true)
    setRecordingSeconds(0)
    timerRef.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000)
  }, [])

  const stopRecording = useCallback(() => {
    return new Promise((resolve) => {
      const mr = mediaRecorderRef.current
      if (!mr) return resolve(null)

      clearInterval(timerRef.current)
      setIsRecording(false)

      const recognition = recognitionRef.current
      recognitionRef.current = null

      let mrDone = false
      let sttDone = !recognition
      let mrResult = null

      const tryResolve = () => {
        if (mrDone && sttDone) {
          resolve({ ...mrResult, transcript: transcriptRef.current.trim() })
        }
      }

      if (recognition) {
        recognition.onend = () => { sttDone = true; tryResolve() }
        // 1s fallback in case onend never fires
        setTimeout(() => { if (!sttDone) { sttDone = true; tryResolve() } }, 1000)
        recognition.stop()
      }

      mr.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        const id = 'voice_' + Date.now()
        await saveBlob(id, blob)
        const url = URL.createObjectURL(blob)
        mrResult = { id, url, duration: recordingSeconds }
        mr.stream.getTracks().forEach(t => t.stop())
        mrDone = true
        tryResolve()
      }
      mr.stop()
    })
  }, [recordingSeconds])

  const cancelRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
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
