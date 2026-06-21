export async function fetchTTSAudio(text, { apiKey, groupId, voiceId = 'English_Trustworthy_Man', speed = 1.0, vol = 1.0, model = 'speech-2.6-hd' }) {
  console.log('[VOICE] 合成配置 apiKey长度=', apiKey?.length ?? 0, 'groupId=', groupId || '(空)', 'voice=', voiceId, 'model=', model)

  const ttsUrl = `https://api.minimaxi.com/v1/t2a_v2?GroupId=${groupId}`
  const body = { model, text, voice_setting: { voice_id: voiceId, speed, vol } }
  console.log('[VOICE] 即将fetch TTS url=', ttsUrl, 'bodyLen=', JSON.stringify(body).length)

  let res
  try {
    res = await fetch(ttsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })
  } catch (fetchErr) {
    console.error('[VOICE] fetch本身抛出异常 name=', fetchErr?.name, 'message=', fetchErr?.message)
    throw fetchErr
  }

  console.log('[VOICE] TTS响应 status=', res.status)
  const rawText = await res.text()
  console.log('[VOICE] TTS响应体=', rawText.slice(0, 500))

  if (!res.ok) {
    let statusMsg = `TTS Error ${res.status}`
    try { statusMsg = JSON.parse(rawText)?.base_resp?.status_msg || statusMsg } catch {}
    throw new Error(statusMsg)
  }

  let data
  try { data = JSON.parse(rawText) } catch (e) {
    throw new Error('TTS: 响应不是合法JSON')
  }
  const hex = data?.data?.audio
  if (!hex) throw new Error('TTS: no audio in response')
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)))
  console.log('[VOICE] 音频hex长度=', hex.length, '，Blob bytes=', bytes.length)
  return new Blob([bytes], { type: 'audio/mp3' })
}
