import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
    expect(html).toContain('小鸡毛正在想要怎么回你')
    expect(html).not.toContain('💭 思考过程')
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
})
