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

function isAnthropicUrl(base) {
  return base.includes('anthropic.com')
}

function buildAnthropicMessages(messages) {
  return messages
    .filter(m => m.role !== 'system')
    .map(m => {
      if (m.type === 'text') return { role: m.role, content: m.content }
      if (m.type === 'image') {
        const media_type = VALID_MEDIA_TYPES.has(m.imageType) ? m.imageType : detectMediaType(m.imageData)
        return {
          role: m.role,
          content: [
            { type: 'image', source: { type: 'base64', media_type, data: m.imageData } },
            ...(m.content ? [{ type: 'text', text: m.content }] : []),
          ],
        }
      }
      if (m.type === 'voice') return { role: m.role, content: m.transcript ? `[语音消息] ${m.transcript}` : '[语音消息]' }
      return null
    })
    .filter(Boolean)
}

function buildOpenAIMessages(systemPrompt, messages) {
  const result = []
  if (systemPrompt) result.push({ role: 'system', content: systemPrompt })
  for (const m of messages) {
    if (m.role === 'system') continue
    if (m.type === 'text') {
      result.push({ role: m.role, content: m.content || '' })
    } else if (m.type === 'image') {
      const media_type = VALID_MEDIA_TYPES.has(m.imageType) ? m.imageType : detectMediaType(m.imageData)
      const parts = [{ type: 'image_url', image_url: { url: `data:${media_type};base64,${m.imageData}` } }]
      if (m.content) parts.push({ type: 'text', text: m.content })
      result.push({ role: m.role, content: parts })
    } else if (m.type === 'voice') {
      result.push({ role: m.role, content: m.transcript ? `[语音消息] ${m.transcript}` : '[语音消息]' })
    }
  }
  return result
}

export async function fetchModels({ baseUrl, apiKey }) {
  const base = (baseUrl || 'https://api.anthropic.com').replace(/\/$/, '')
  const headers = isAnthropicUrl(base)
    ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    : { 'Authorization': `Bearer ${apiKey}` }
  // Anthropic keeps /v1 in path; others include it in base URL
  const modelsUrl = isAnthropicUrl(base) ? `${base}/v1/models` : `${base}/models`
  console.log('[fetchModels] URL:', modelsUrl)
  const response = await fetch(modelsUrl, { headers })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err?.error?.message || `API Error ${response.status}`)
  }
  const data = await response.json()
  return (data.data || data.models || []).map(m => m.id || m).filter(Boolean)
}

export async function* streamChat({ apiKey, apiBaseUrl = 'https://api.anthropic.com', model, systemPrompt, messages }) {
  const base = apiBaseUrl.replace(/\/$/, '')

  let response
  if (isAnthropicUrl(base)) {
    response = await fetch(`${base}/v1/messages`, {
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
        messages: buildAnthropicMessages(messages),
      }),
    })
  } else {
    // base URL already contains the version path (e.g. /v1 or /api/paas/v4)
    const chatUrl = `${base}/chat/completions`
    console.log('[streamChat] URL:', chatUrl, 'model:', model)
    response = await fetch(chatUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        stream: true,
        messages: buildOpenAIMessages(systemPrompt, messages),
      }),
    })
  }

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
        // Anthropic format
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield event.delta.text
        }
        // OpenAI format
        if (event.choices?.[0]?.delta?.content) {
          yield event.choices[0].delta.content
        }
      } catch {
        // ignore parse errors
      }
    }
  }
}
