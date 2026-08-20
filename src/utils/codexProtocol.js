export const DEFAULT_CODEX_SESSION_ID = 'main'

export function normalizeCodexSessionId(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  return raw && raw.length <= 120 ? raw : DEFAULT_CODEX_SESSION_ID
}

export function buildCodexMessagePayload({ id, text, segments, imageUrl, imageSeparate, file, sessionId, prompt, clientTime, voiceEmotion, voiceAcoustics }) {
  return {
    runtime: 'codex',
    id,
    text,
    sessionId: normalizeCodexSessionId(sessionId),
    prompt: typeof prompt === 'string' ? prompt : '',
    clientTime,
    ...(voiceEmotion ? { voiceEmotion } : {}),
    ...(voiceAcoustics ? { voiceAcoustics } : {}),
    ...(Array.isArray(segments) && segments.length ? { segments } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageSeparate ? { imageSeparate: true } : {}),
    ...(file?.path ? { filePath: file.path, fileName: file.name, fileSize: file.size, fileType: file.mimeType } : {}),
  }
}
