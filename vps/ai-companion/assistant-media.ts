import { randomBytes } from 'node:crypto'

const PUBLIC_MEDIA_ID_RE = /^\d{8}-media-[a-f0-9]{32}\.(?:mp4|webm|mov|html|gif)$/

export function newAssistantMediaId(date: string, extension: string): string {
  if (!/^\d{8}$/.test(date)) throw new Error('invalid media date')
  if (!/^\.(?:mp4|webm|mov|html|gif)$/.test(extension)) throw new Error('invalid media extension')
  return `${date}-media-${randomBytes(16).toString('hex')}${extension}`
}

// The URL itself is a 128-bit bearer capability. This lets a media link open
// directly from Safari/PWA/another chat without depending on companion's
// HttpOnly login cookie, while legacy predictable ids remain cookie-gated.
export function isPublicAssistantMediaId(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_MEDIA_ID_RE.test(value)
}
