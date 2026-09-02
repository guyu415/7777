import { describe, expect, it } from 'vitest'
import { bookFromJson, bookFromPlainText } from '../readingLibrary'

describe('reading library imports', () => {
  it('splits plain text by chapter headings and keeps ordered paragraphs', () => {
    const book = bookFromPlainText('第一章 春天\n\n第一段。\n\n第二段。\n\n第二章 夏天\n\n第三段。', { title: '四季.txt' })
    expect(book.title).toBe('四季')
    expect(book.chapters).toHaveLength(2)
    expect(book.chapters[1].paragraphs[0].text).toBe('第三段。')
  })

  it('normalizes the documented JSON structure', () => {
    const book = bookFromJson({ title: '测试书', chapters: [{ title: '开头', paragraphs: ['正文一', { text: '正文二' }] }] })
    expect(book.chapters[0].paragraphs.map(item => item.text)).toEqual(['正文一', '正文二'])
  })
})
