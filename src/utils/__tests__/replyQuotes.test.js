import { describe, expect, it } from 'vitest'
import { buildQuotedReplyContent, buildReplyQuotePrefix, parseReplyQuotes } from '../replyQuotes'

describe('reply quotes', () => {
  it('round-trips several quoted messages in one send', () => {
    const prefix = buildReplyQuotePrefix([
      { label: '我', preview: '第一条消息' },
      { label: '小满', preview: '第二条消息' },
    ])
    expect(parseReplyQuotes(`${prefix}一起回复`)).toEqual({
      quotes: [
        { label: '我', preview: '第一条消息' },
        { label: '小满', preview: '第二条消息' },
      ],
      body: '一起回复',
    })
  })

  it('still parses the previous single-quote format', () => {
    expect(parseReplyQuotes('> 回复 小满：旧消息\n\n收到')).toEqual({
      quotes: [{ label: '小满', preview: '旧消息' }],
      body: '收到',
    })
  })

  it('normalizes line breaks so quote metadata cannot overflow the format', () => {
    expect(buildReplyQuotePrefix([{ label: '小\n满', preview: '很长\n的消息' }]))
      .toBe('> 回复 小 满：很长 的消息\n\n')
  })

  it('keeps every queued response segment inside the same quoted reply', () => {
    const content = buildQuotedReplyContent(
      [{ label: '小满', preview: '引用内容' }],
      ['第一段回复', '第二段回复'],
    )
    expect(parseReplyQuotes(content)).toEqual({
      quotes: [{ label: '小满', preview: '引用内容' }],
      body: '第一段回复\n第二段回复',
    })
  })
})
