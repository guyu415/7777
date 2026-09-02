export const THINKING_TRANSLATION_SYSTEM_PROMPT =
  'Translate into natural Simplified Chinese. Preserve meaning, uncertainty, negation, code, identifiers, paths, and numbers exactly. Do not summarize, omit, explain, or add. Output only the translation.'

export const THINKING_TRANSLATION_MAX_CHARS = 2_000

export function normalizeThinkingTranslationInput(body: unknown): { text: string; context: string } | null {
  const value = body as { text?: unknown; context?: unknown } | null
  const text = typeof value?.text === 'string' ? value.text : ''
  const context = typeof value?.context === 'string' ? value.context : ''
  if (!text.trim() || text.length > THINKING_TRANSLATION_MAX_CHARS) return null
  return { text, context: context.slice(-1_600) }
}
export function buildThinkingTranslationInstruction(text: string, context = ''): string {
  const contextBlock = context.trim()
    ? `For understanding only, these are the previous one or two completed reasoning sentences. Do not translate or repeat them:\n<context>\n${context}\n</context>\n\n`
    : ''
  return `${contextBlock}Translate only the following complete current reasoning segment. Return only its Simplified Chinese translation; do not include the markers.\n<current_segment>\n${text}\n</current_segment>`
}

export function extractGeminiTranslation(payload: any): string {
  return (payload?.candidates?.[0]?.content?.parts || [])
    .filter((part: any) => part?.thought !== true)
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .join('')
    .trim()
}
