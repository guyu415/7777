import { describe, expect, it } from 'vitest'
import { extractVpsReplyTokens, markVpsReplyChunks } from './vpsReplyChunks'

describe('VPS reply wire boundaries', () => {
  it('splits internal blank-line paragraphs without losing any content', () => {
    const entries = [{ wireId: 'wire-1', text: '第一段\n\n第二段\n第三行' }]
    const tokens = extractVpsReplyTokens(markVpsReplyChunks(entries), entries)

    expect(tokens.map(token => [token.content, token.wireId, token.serverWireId])).toEqual([
      ['第一段', 'wire-1::part:0', 'wire-1'],
      ['第二段\n第三行', 'wire-1::part:1', 'wire-1'],
    ])
  })

  it('keeps multiple reply calls as distinct bubbles with distinct wire ids', () => {
    const entries = [
      { wireId: 'wire-1', text: '第一条\n\n仍然属于第一条' },
      { wireId: 'wire-2', text: '第二条' },
    ]
    const tokens = extractVpsReplyTokens(markVpsReplyChunks(entries), entries)

    expect(tokens.map(token => [token.wireId, token.serverWireId, token.content])).toEqual([
      ['wire-1::part:0', 'wire-1', '第一条'],
      ['wire-1::part:1', 'wire-1', '仍然属于第一条'],
      ['wire-2', 'wire-2', '第二条'],
    ])
  })

  it('survives structured-tag removal without losing message boundaries', () => {
    const entries = [
      { wireId: 'wire-1', text: '开头[AC:on,26,cool,auto]' },
      { wireId: 'wire-2', text: '[VOICE]结尾[/VOICE]' },
    ]
    const processed = markVpsReplyChunks(entries).replace(/\[AC:[^\]]+\]/, '')
    const tokens = extractVpsReplyTokens(processed, entries)

    expect(tokens.map(token => [token.wireId, token.content])).toEqual([
      ['wire-1', '开头'],
      ['wire-2', '结尾'],
    ])
  })
})
