import { describe, expect, test } from 'bun:test'
import {
  THINKING_TRANSLATION_MAX_CHARS,
  THINKING_TRANSLATION_SYSTEM_PROMPT,
  buildThinkingTranslationInstruction,
  extractGeminiTranslation,
  normalizeThinkingTranslationInput,
} from '../reasoning-translation.ts'

describe('thinking translation boundary', () => {
  test('uses the exact display-only instruction and sends the complete segment', () => {
    expect(THINKING_TRANSLATION_SYSTEM_PROMPT).toBe(
      'Translate into natural Simplified Chinese. Preserve meaning, uncertainty, negation, code, identifiers, paths, and numbers exactly. Do not summarize, omit, explain, or add. Output only the translation.',
    )
    const current = 'The answer may be uncertain.\n`src/App.jsx`'
    const instruction = buildThinkingTranslationInstruction(current, 'The previous sentence was only context.')
    expect(instruction).toContain(current)
    expect(instruction).toContain('The previous sentence was only context.')
    expect(instruction).toContain('Translate only the following complete current reasoning segment')
  })

  test('validates input size without mutating or persisting the original', () => {
    const input = { text: '  Keep this exact segment.\n', context: 'prior' }
    expect(normalizeThinkingTranslationInput(input)).toEqual(input)
    expect(normalizeThinkingTranslationInput({ text: 'x'.repeat(THINKING_TRANSLATION_MAX_CHARS + 1) })).toBeNull()
    expect(normalizeThinkingTranslationInput({ text: '   ' })).toBeNull()
  })

  test('returns visible Gemini text and ignores thought parts', () => {
    expect(extractGeminiTranslation({
      candidates: [{ content: { parts: [
        { thought: true, text: 'internal thought' },
        { text: '这是译文。' },
      ] } }],
    })).toBe('这是译文。')
  })
})
