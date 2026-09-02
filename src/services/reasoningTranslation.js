// Display-only Claude thinking translation. This module intentionally has no
// chat-store or browser-storage dependency so the reasoning sheet can be
// rendered in SSR/test environments without initializing the live companion
// WebSocket singleton.

const COMPANION_BASE = 'https://companion.xiaoman.xyz'

export async function translateThinking({ text, context = '', signal } = {}) {
  const response = await fetch(`${COMPANION_BASE}/thinking/translate`, {
    credentials: 'include',
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, context }),
  })
  let body = null
  try {
    body = await response.json()
  } catch {
    // The caller keeps the original English segment for invalid/empty replies.
  }
  if (!response.ok) {
    const error = new Error(body?.error || `companion request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    throw new Error('thinking translation returned no text')
  }
  return body.text
}
