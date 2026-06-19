const VALID_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function detectMediaType(base64data) {
  try {
    const raw = atob(base64data.slice(0, 16))
    const b = (i) => raw.charCodeAt(i)
    if (b(0) === 0xFF && b(1) === 0xD8) return 'image/jpeg'
    if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'image/png'
    if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46) return 'image/gif'
    if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(8) === 0x57) return 'image/webp'
  } catch {}
  return 'image/jpeg'
}

const MODELS = {
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-opus-4-8': 'claude-opus-4-8',
  'claude-haiku-4-5-20251001': 'claude-haiku-4-5-20251001',
}

export const MODEL_LABELS = {
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-8': 'Opus 4.8',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
}

function buildMessages(messages) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.type === 'text') {
        return { role: m.role, content: m.content }
      }
      if (m.type === 'image') {
        const media_type = VALID_MEDIA_TYPES.has(m.imageType)
          ? m.imageType
          : detectMediaType(m.imageData)
        return {
          role: m.role,
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type, data: m.imageData }
            },
            ...(m.content ? [{ type: 'text', text: m.content }] : [])
          ]
        }
      }
      if (m.type === 'voice') {
        return { role: m.role, content: m.transcript ? `[语音消息] ${m.transcript}` : '[语音消息]' }
      }
      return null
    })
    .filter(Boolean)
}

export async function fetchModels({ baseUrl, apiKey }) {
  const base = (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')
  const isAnthropic = base.includes('anthropic.com')
  const headers = isAnthropic
    ? {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      }
    : {
        'Authorization': `Bearer ${apiKey}`,
      }
  const response = await fetch(`${base}/v1/models`, { headers })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API Error ${response.status}`)
  }
  const data = await response.json()
  const list = data.data || data.models || []
  return list.map(m => m.id || m).filter(Boolean)
}

export async function* streamChat({ apiKey, apiBaseUrl = 'https://api.anthropic.com', model, systemPrompt, messages }) {
  const base = apiBaseUrl.replace(/\/$/, '')
  const response = await fetch(`${base}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODELS[model] || model,
      max_tokens: 4096,
      system: systemPrompt,
      stream: true,
      messages: buildMessages(messages),
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API Error ${response.status}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') return

      try {
        const event = JSON.parse(data)
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield event.delta.text
        }
      } catch {
        // ignore parse errors
      }
    }
  }
}
