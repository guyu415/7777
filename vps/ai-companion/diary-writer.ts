export type DiaryLetterInput = {
  content: string
  mood?: string
  weather?: string
  date?: string
  sessionId?: string
}

export type DiaryWriteResult = { ok: boolean; id?: string; error?: string }

export async function writeDiaryLetter(
  workerUrl: string,
  vpsServiceKey: string,
  letter: DiaryLetterInput,
  fetchImpl: typeof fetch = fetch,
): Promise<DiaryWriteResult> {
  if (!vpsServiceKey) return { ok: false, error: 'vps_service_key_missing' }
  try {
    const res = await fetchImpl(workerUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-VPS-Key': vpsServiceKey },
      body: JSON.stringify(letter),
    })
    const data = await res.json().catch(() => null) as any
    if (!res.ok) return { ok: false, error: data?.error || `HTTP ${res.status}` }
    return { ok: true, id: typeof data?.letter?.id === 'string' ? data.letter.id : undefined }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}
