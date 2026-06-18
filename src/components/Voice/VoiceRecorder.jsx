import { useEffect } from 'react'
import { Mic, X, Send } from 'lucide-react'
import { useVoice } from '../../hooks/useVoice'

export default function VoiceRecorder({ onSend, onCancel }) {
  const { isRecording, recordingSeconds, startRecording, stopRecording, cancelRecording } = useVoice()

  useEffect(() => {
    startRecording().catch(err => {
      console.error('麦克风权限被拒绝', err)
      onCancel()
    })
  }, [])

  const handleSend = async () => {
    const result = await stopRecording()
    if (result) onSend(result)
    else onCancel()
  }

  const handleCancel = () => {
    cancelRecording()
    onCancel()
  }

  const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="flex items-center gap-4 px-4 py-3 bg-pink-50 border-t border-pink-100">
      <button onClick={handleCancel} className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-gray-400">
        <X size={18} />
      </button>
      <div className="flex-1 flex flex-col items-center">
        <div className="flex items-end gap-[4px] h-8 mb-1">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="w-[4px] rounded-full bg-pink-400 wave-bar" style={{ animationDelay: `${i * 0.08}s` }} />
          ))}
        </div>
        <span className="text-sm text-pink-500 font-medium">{fmtTime(recordingSeconds)}</span>
      </div>
      <button onClick={handleSend} className="w-10 h-10 rounded-full bg-pink-500 flex items-center justify-center text-white shadow-md">
        <Send size={18} />
      </button>
    </div>
  )
}
