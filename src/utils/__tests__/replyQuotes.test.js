import { describe, expect, it } from 'vitest'
import { buildQuotedReplyContent, buildReplyMessage, buildReplyMessageBatch, buildReplyQuotePrefix, formatReplyMessageBatchForModel, parseReplyQuotes } from '../replyQuotes'

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

  it('binds a quote only to its matching reply and keeps normal messages normal', () => {
    const firstReply = buildReplyMessage('摸摸你', [{ label: 'cc', preview: '被你赖在怀里差点一起睡过去了' }])
    const secondReply = buildReplyMessage('第二个单独回复', [{ label: 'cc', preview: '另一条消息' }])
    const batch = buildReplyMessageBatch(
      [firstReply, '是前端页面出问题了', '老是退出重进', secondReply],
      '',
      [],
    )

    expect(parseReplyQuotes(batch[0])?.body).toBe('摸摸你')
    expect(parseReplyQuotes(batch[1])).toBeNull()
    expect(parseReplyQuotes(batch[2])).toBeNull()
    expect(parseReplyQuotes(batch[3])?.body).toBe('第二个单独回复')
  })

  it('supports several selected quotes but keeps exactly one reply body', () => {
    const message = buildReplyMessage('一起回答', [
      { label: 'cc', preview: '第一条' },
      { label: 'cc', preview: '第二条' },
    ])
    expect(parseReplyQuotes(message)).toEqual({
      quotes: [
        { label: 'cc', preview: '第一条' },
        { label: 'cc', preview: '第二条' },
      ],
      body: '一起回答',
    })
  })

  it('preserves a later quoted reply as a distinct model-side message', () => {
    const laterReply = buildReplyMessage('第二条回复', [{ label: 'cc', preview: '被引用原文' }])
    expect(formatReplyMessageBatchForModel(['第一条普通消息', laterReply])).toBe(
      '【同一轮分条消息 1/2】\n第一条普通消息\n\n' +
      '【同一轮分条消息 2/2】\n> 回复 cc：被引用原文\n\n第二条回复',
    )
  })

  it('uses the same explicit boundaries when the quoted reply comes first', () => {
    const firstReply = buildReplyMessage('第一条回复', [{ label: 'cc', preview: '被引用原文' }])
    const rendered = formatReplyMessageBatchForModel([firstReply, '第二条普通消息'])
    expect(rendered).toContain('【同一轮分条消息 1/2】\n> 回复 cc：被引用原文\n\n第一条回复')
    expect(rendered).toContain('【同一轮分条消息 2/2】\n第二条普通消息')
  })
})
