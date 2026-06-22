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
      // 纯文本模型（硅基流动/GLM 等）不接受数组 content；只保留文字说明，丢弃图片数据
      result.push({ role: m.role, content: m.content || '[图片]' })
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

export async function generateSummary({ existingSummary, newMessages, apiKey }) {
  const msgText = newMessages.map(m => {
    const role = m.role === 'user' ? '用户' : 'AI'
    const text = Array.isArray(m.content)
      ? m.content.filter(p => p.type === 'text').map(p => p.text).join('')
      : (m.content || '')
    return `${role}：${text}`
  }).join('\n')

  const parts = ['请将以下对话压缩成简洁的事实/情节摘要，保留对后续对话连贯性重要的信息（关系、约定、正在进行的话题等）。输出纯摘要文本，无需多余说明。']
  if (existingSummary) parts.push(`【上一版摘要（请在此基础上更新并重新输出完整摘要）】\n${existingSummary}`)
  parts.push(`【需要压缩的新对话】\n${msgText}`)

  const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'deepseek-v4-flash',
      max_tokens: 1024,
      stream: false,
      messages: [{ role: 'user', content: parts.join('\n\n') }],
    }),
  })
  if (!resp.ok) throw new Error(`DeepSeek summary error ${resp.status}`)
  const data = await resp.json()
  return data.choices?.[0]?.message?.content?.trim() || ''
}

export async function* streamChat({ apiKey, apiBaseUrl = 'https://api.anthropic.com', model, systemPrompt, messages, workerUrl, useWorkerProxy, signal, disableThinking = false, webSearch = false, providerName = '' }) {
  const base = apiBaseUrl.replace(/\/$/, '')
  const proxyBase = (useWorkerProxy && workerUrl) ? workerUrl.replace(/\/$/, '') : null

  // Build web search tools based on provider
  // Claude via AiHubMix: web search is triggered by appending :surfing to model name, NOT via tools param
  let webSearchTools = null
  if (webSearch) {
    if (providerName === 'glm') {
      webSearchTools = [{ type: 'web_search', web_search: { enable: true, search_result: true } }]
    }
    console.log('[WEB] 联网开关=on | 供应商=', providerName || '(未设置)', '| 注入参数=', JSON.stringify(webSearchTools))
  } else {
    console.log('[WEB] 联网开关=off')
  }

  let response
  let actualUrl
  if (isAnthropicUrl(base)) {
    const targetUrl = `${base}/v1/messages`
    const body = JSON.stringify({
      model: MODELS[model] || model,
      max_tokens: 4096,
      system: systemPrompt,
      stream: true,
      messages: buildAnthropicMessages(messages),
      // Direct Anthropic: web search via built-in tool
      ...(webSearch ? { tools: [{ type: 'web_search_20250305', name: 'web_search' }] } : {}),
    })
    if (proxyBase) {
      actualUrl = `${proxyBase}/chat`
      console.log('[API] 发起fetch (Anthropic via Worker):', actualUrl)
      response = await fetch(actualUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-Target-Url': targetUrl },
        body, signal,
      })
    } else {
      actualUrl = targetUrl
      console.log('[API] 发起fetch (Anthropic 直连):', actualUrl)
      response = await fetch(actualUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body, signal,
      })
    }
  } else {
    const chatUrl = `${base}/chat/completions`
    // Claude via AiHubMix: append :surfing suffix to model name to enable web search
    const effectiveModel = (webSearch && providerName === 'claude') ? `${model}:surfing` : model
    if (webSearch && providerName === 'claude') {
      console.log('[WEB] Claude联网模式: 模型后缀 :surfing →', effectiveModel)
    }
    const body = JSON.stringify({
      model: effectiveModel,
      max_tokens: 4096,
      stream: true,
      messages: buildOpenAIMessages(systemPrompt, messages),
      // disableThinking only applies to GLM reasoning models
      ...(disableThinking && providerName === 'glm' ? { thinking: { type: 'disabled' } } : {}),
      // web search tools if enabled and provider supported
      ...(webSearchTools ? { tools: webSearchTools } : {}),
    })
    if (proxyBase) {
      actualUrl = `${proxyBase}/chat`
      console.log('[API] 发起fetch (OpenAI-compat via Worker):', actualUrl)
      response = await fetch(actualUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey, 'X-Target-Url': chatUrl },
        body, signal,
      })
    } else {
      actualUrl = chatUrl
      console.log('[API] 发起fetch (OpenAI-compat 直连):', actualUrl)
      response = await fetch(actualUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body, signal,
      })
    }
    if (webSearch && providerName === 'claude') {
      console.log('[WEB-RESP] Claude请求端点=', proxyBase ? `${actualUrl} → ${chatUrl}` : chatUrl, '| 最终model字符串=', effectiveModel)
    }
  }

  const proxyNote = proxyBase ? `Worker代理: ${proxyBase}` : '直连'
  console.log(`[API] 请求地址: POST ${actualUrl} (${proxyNote})`)
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    console.log('[WEB-RESP] 上游错误 HTTP', response.status, '| error=', JSON.stringify(err))
    throw new Error(`请求失败: POST ${actualUrl}\n${err?.error?.message || `HTTP ${response.status}`}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const _wr = { finishReasons: new Set() }
  const _logWR = () => console.log(
    '[WEB-RESP] 响应已返回 | 供应商=', providerName || '(未设置)',
    '| finish_reason=', [..._wr.finishReasons].join(',') || '(未见)',
  )

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') { _logWR(); return }

      try {
        const event = JSON.parse(data)
        // Anthropic format — thinking block
        if (event.type === 'content_block_delta' && event.delta?.type === 'thinking_delta') {
          yield { reasoning: event.delta.thinking }
        }
        // Anthropic format — text block
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          yield { text: event.delta.text }
        }
        // OpenAI format
        const delta = event.choices?.[0]?.delta
        // Reasoning chunk (GLM / DeepSeek style)
        if (delta?.reasoning_content) {
          yield { reasoning: delta.reasoning_content }
        }
        // Content chunk
        if (delta?.content) {
          yield { text: delta.content }
        }
        // Web search tool_calls — log for debugging, no round-trip needed (server-side tools)
        if (delta?.tool_calls) {
          console.log('[WEB] tool_calls事件:', JSON.stringify(delta.tool_calls))
        }
        if (event.choices?.[0]?.finish_reason === 'tool_calls') {
          console.log('[WEB] finish_reason=tool_calls — 等待服务端执行搜索并继续生成')
        }
        // Accumulate finish_reason for post-stream [WEB-RESP] summary
        const _fr = event.choices?.[0]?.finish_reason || event.delta?.stop_reason
        if (_fr) _wr.finishReasons.add(_fr)
      } catch {
        // ignore parse errors
      }
    }
  }
  _logWR()
}
