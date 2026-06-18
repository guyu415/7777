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
        return {
          role: m.role,
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: m.imageType || 'image/jpeg',
                data: m.imageData,
              }
            },
            ...(m.content ? [{ type: 'text', text: m.content }] : [])
          ]
        }
      }
      // voice messages: send transcript if available, else skip
      if (m.type === 'voice' && m.transcript) {
        return { role: m.role, content: `[语音消息] ${m.transcript}` }
      }
      return null
    })
    .filter(Boolean)
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
