import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import MessageBubble from '../MessageBubble'

describe('MessageBubble reasoning and Claude Code loader integration', () => {
  it('keeps the glass reasoning entry while showing the golden pending animation', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'assistant-1',
          conversationId: 'cc',
          role: 'assistant',
          type: 'text',
          content: '',
          timestamp: 1_000,
          streaming: true,
          reasoning: '正在判断怎么回复。',
          reasoningStreaming: true,
          reasoningStartedAt: 1_000,
        }}
        pendingReplyVariant="golden-retriever"
        theme={{}}
      />,
    )

    expect(html).toContain('reasoning-trigger')
    expect(html).toContain('看看它在想什么')
    expect(html).toContain('/assets/claude-code-golden-loading.gif')
    expect(html).not.toContain('/assets/claude-code-golden-responding.gif')
    expect(html).toContain('小鸡毛正在想要怎么回你')
    expect(html).not.toContain('💭 思考过程')
  })

  it('uses the richer response loop until the first reasoning text arrives', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'assistant-waiting',
          conversationId: 'cc',
          role: 'assistant',
          type: 'text',
          content: '',
          timestamp: 1_000,
          streaming: true,
          reasoning: '',
          reasoningStreaming: true,
        }}
        pendingReplyVariant="golden-retriever"
        theme={{}}
      />,
    )

    expect(html).toContain('/assets/claude-code-golden-responding.gif')
    expect(html).not.toContain('/assets/claude-code-golden-loading.gif')
    expect(html).toContain('小鸡毛正在想要怎么回你')
  })

  it('renders a synced bedtime English card instead of a plain text bubble', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'bedtime-1', conversationId: 'cc', role: 'assistant', type: 'text',
          content: 'Let the day go gently.', timestamp: 1_000, streaming: false,
          bedtimeCard: { english: 'Let the day go gently.', translation: '轻轻放下今天。', date: '2026-09-03' },
        }}
        theme={{}}
      />,
    )

    expect(html).toContain('bedtime-card')
    expect(html).toContain('Let the day go gently.')
    expect(html).toContain('轻轻放下今天。')
    expect(html).toContain('已存入纪念日')
  })

  it('does not add a direct rewind control beside user-message timestamps', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{ id: 'user-1', conversationId: 'cc', role: 'user', type: 'text', content: 'hello', timestamp: 1_000 }}
        theme={{}}
      />,
    )
    expect(html).not.toContain('从这条消息开始撤回')
    expect(html).not.toContain('>撤回<')
  })

  it('offers resident user messages one resay action and removes the ineffective legacy actions', () => {
    const source = readFileSync(new URL('../ChatWindow.jsx', import.meta.url), 'utf8')
    expect(source).toContain('✏️ 重说')
    expect(source).toContain('保存并重说')
    expect(source).not.toContain('存入记忆')
    expect(source).not.toContain('修改文字')
    expect(source).not.toContain('撤回到这里')
  })
})
