import { describe, expect, test } from 'bun:test'
import {
  MAIN_CHAT_THINKING_CONTEXT,
  mainChatThinkingContextLine,
} from '../main-chat-thinking.ts'

describe('ordinary main-chat thinking context', () => {
  test('requires Chinese first-person thinking without turning it into reply text', () => {
    expect(MAIN_CHAT_THINKING_CONTEXT).toContain('思考必须使用简体中文')
    expect(MAIN_CHAT_THINKING_CONTEXT).toContain('第一人称“我”')
    expect(MAIN_CHAT_THINKING_CONTEXT).toContain('只约束本轮 thinking/reasoning')
    expect(MAIN_CHAT_THINKING_CONTEXT).toContain('不要把它写进或复述到 reply')
  })

  test('keeps the reminder on ordinary and queued main-chat turns', () => {
    expect(mainChatThinkingContextLine(false)).toBe(MAIN_CHAT_THINKING_CONTEXT)
    expect(mainChatThinkingContextLine(undefined)).toBe(MAIN_CHAT_THINKING_CONTEXT)
  })

  test('does not apply the long-form thinking style to real-time call mode', () => {
    expect(mainChatThinkingContextLine(true)).toBeUndefined()
  })
})
