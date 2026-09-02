import { streamChat } from './claude'
import { estimateTokensFromChars, validateReadingQuota } from './readingSessions'

const READING_SYSTEM_PROMPT = `你是一个安静的自主阅读者。你正在按正文顺序阅读一本书，用户只观察你的阅读行为，不和你聊天。

本轮只处理“当前段落”，前文只是极少量语境。不要概括整章或整本书，不要输出思维链，不要和用户寒暄。
绝大多数段落只返回 continue。只有句子确实有值得留下的意象、转折或观点时，才返回 highlight 或 annotate；不要为了凑数量做批注。
如果需要停一下，返回 pause。paragraphId 必须原样使用当前段落的 id，quote 必须是当前段落中的连续原文。

只返回一个 JSON 对象，不要 Markdown 代码围栏，不要在 JSON 外写任何文字：
{"action":"continue|highlight|annotate|pause","paragraphId":"当前段落 id","quote":"当前段落中的连续原文，没有需要时为空字符串","annotation":"很短的批注，没有需要时为空字符串","interest":0}

约束：
- annotation 最多 45 个中文字符，只记录可观察的阅读感受，不展示推理过程。
- interest 是 0 到 1 的数字；普通段落保持较低。
- highlight 用于只想留下划线/高亮的句子，annotate 用于同时留下短批注，pause 用于暂时停留。`

function firstSentence(text) {
  const match = String(text || '').match(/^(.+?[。！？；])/)
  return (match?.[1] || String(text || '')).slice(0, 80)
}

function clampInterest(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0.2
  return Math.max(0, Math.min(1, parsed))
}

function makeLocalReadingAction(paragraph, index = 0, signal) {
  const text = paragraph?.text || ''
  const quote = firstSentence(text)
  const notable = /等待|沉默|记得|暂停|停下来|明天|过去|风|照顾好自己|继续/.test(text)
  // The local path is deliberately small and deterministic: it lets the
  // reader remain usable without an API key, while configured sessions use
  // the real model path below. It still makes one structured decision per
  // paragraph and never summarizes the whole book.
  if (notable && index % 5 === 1) {
    return Promise.resolve({
      action: index % 10 === 1 ? 'annotate' : 'highlight',
      paragraphId: paragraph.id,
      quote,
      annotation: index % 10 === 1 ? '这里的停顿，让等待有了具体的形状。' : '',
      interest: 0.62,
      source: 'local',
      signal,
    })
  }
  return Promise.resolve({ action: 'continue', paragraphId: paragraph.id, quote: '', annotation: '', interest: 0, source: 'local', signal })
}

function extractJsonObject(raw) {
  const cleaned = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try { return JSON.parse(cleaned) } catch {}

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(cleaned.slice(start, end + 1)) } catch { return null }
}

export function parseReadingAction(raw, paragraph) {
  const parsed = extractJsonObject(raw) || {}
  const allowed = new Set(['continue', 'highlight', 'annotate', 'pause'])
  const action = allowed.has(parsed.action) ? parsed.action : 'continue'
  const paragraphId = parsed.paragraphId === paragraph?.id ? paragraph.id : paragraph?.id
  const candidateQuote = typeof parsed.quote === 'string' ? parsed.quote.trim() : ''
  const quote = candidateQuote && paragraph?.text?.includes(candidateQuote)
    ? candidateQuote
    : (action === 'highlight' || action === 'annotate' ? firstSentence(paragraph?.text) : '')
  const annotation = typeof parsed.annotation === 'string' ? parsed.annotation.trim().slice(0, 45) : ''

  return {
    action,
    paragraphId,
    quote,
    annotation: action === 'annotate' ? annotation : '',
    interest: clampInterest(parsed.interest),
  }
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new DOMException('Aborted', 'AbortError'))
    }, { once: true })
  })
}

export async function readOneParagraph({ paragraph, previousParagraph, index, config, signal }) {
  const quota = validateReadingQuota(config?.readingQuota)
  if (!quota.ok) {
    const error = new Error(quota.message)
    error.code = quota.code
    error.readingQuota = quota
    throw error
  }
  if (!config?.apiKey) {
    await abortableDelay(260, signal)
    return { ...await makeLocalReadingAction(paragraph, index, signal), usage: { modelCalls: 0, inputChars: 0, outputChars: 0 } }
  }

  const context = {
    current: { paragraphId: paragraph.id, chapter: paragraph.chapterTitle, text: paragraph.text },
    previous: previousParagraph
      ? { paragraphId: previousParagraph.id, text: previousParagraph.text.slice(-240) }
      : null,
  }
  const messages = [{
    role: 'user',
    content: `请阅读下面这一小段，并只返回约定的结构化动作。\n<reading_context>${JSON.stringify(context)}</reading_context>`,
  }]
  let raw = ''
  for await (const chunk of streamChat({
    apiKey: config.apiKey,
    apiBaseUrl: config.apiBaseUrl,
    model: config.model,
    systemPrompt: READING_SYSTEM_PROMPT,
    messages,
    workerUrl: config.workerUrl,
    useWorkerProxy: config.useWorkerProxy,
    readingQuota: config.readingQuota,
    maxTokens: 256,
    signal,
    disableThinking: true,
    providerName: config.providerName || '',
  })) {
    if (chunk?.text) raw += chunk.text
  }
  const inputChars = JSON.stringify({ systemPrompt: READING_SYSTEM_PROMPT, messages }).length
  const outputChars = raw.length
  return {
    ...parseReadingAction(raw, paragraph),
    usage: {
      modelCalls: 1,
      inputChars,
      outputChars,
      estimatedInputTokens: estimateTokensFromChars(inputChars),
      estimatedOutputTokens: estimateTokensFromChars(outputChars),
    },
  }
}

export { READING_SYSTEM_PROMPT }
