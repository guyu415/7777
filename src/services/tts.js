export async function fetchTTSAudio(text, { apiKey, groupId, voiceId = 'English_Trustworthy_Man', speed = 1.0, vol = 1.0, model = 'speech-2.6-hd' }) {
  const res = await fetch(`https://api.minimaxi.com/v1/t2a_v2?GroupId=${groupId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      text,
      voice_setting: { voice_id: voiceId, speed, vol },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err?.base_resp?.status_msg || `TTS Error ${res.status}`)
  }
  const data = await res.json()
  const hex = data?.data?.audio
  if (!hex) throw new Error('TTS: no audio in response')
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
  return new Blob([bytes], { type: 'audio/mp3' })
}
