import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  MAX_READING_BATCH_PAGES,
  MAX_ROLLING_STATE_CHARS,
  ReadingStore,
} from '../reading-store.ts'

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function makeStore() {
  const root = mkdtempSync(join(tmpdir(), 'eunoia-reading-'))
  roots.push(root)
  return { root, store: new ReadingStore(root) }
}

function makeBook(paragraphs = 220) {
  return {
    id: 'long-book', title: '长书', author: '测试作者',
    chapters: [{
      id: 'chapter-1', title: '第一章',
      paragraphs: Array.from({ length: paragraphs }, (_, index) => ({ id: `p-${index + 1}`, text: `第 ${index + 1} 段正文。${'内容'.repeat(40)}` })),
    }],
  }
}

function rolling(page: number) {
  return {
    plot_state: `覆盖到第 ${page} 页，` + '情节'.repeat(1000),
    important_people: Array.from({ length: 30 }, (_, index) => `人物 ${index} ${'描述'.repeat(100)}`),
    important_events: Array.from({ length: 30 }, (_, index) => `事件 ${index} ${'描述'.repeat(100)}`),
    open_questions: Array.from({ length: 30 }, (_, index) => `问题 ${index}`),
    themes_or_thoughts: Array.from({ length: 30 }, (_, index) => `主题 ${index}`),
    recent_context: '最近'.repeat(2000),
  }
}

describe('persistent reading store', () => {
  test('persists permission requests and the approved page allowance', () => {
    const { root, store } = makeStore()
    store.importBook(makeBook(30))
    const request = store.createReadingRequest('long-book', 9, '想看看后面的情节')
    expect(new ReadingStore(root).listReadingRequests('pending')[0]?.id).toBe(request.id)
    const approved = new ReadingStore(root).approveReadingRequest(request.id, 7)
    expect(approved.session.approvedPages).toBe(7)
    const restarted = new ReadingStore(root)
    expect(restarted.listReadingRequests('approved')[0]?.sessionId).toBe(approved.session.id)
    expect(restarted.getSession(approved.session.id)?.approvedPages).toBe(7)
  })

  test('batches at most three pages and restores after a process restart', () => {
    const { root, store } = makeStore()
    store.importBook(makeBook(20))
    const session = store.startSession('long-book', 5)
    const batch = store.prepareBatch(session.id)
    const batchPath = store.writeBatchFile(batch)
    expect(existsSync(batchPath)).toBe(true)
    expect(batch.endPage - batch.startPage + 1).toBeLessThanOrEqual(MAX_READING_BATCH_PAGES)
    const result = store.commitBatch({
      session_id: session.id,
      batch_id: batch.id,
      end_paragraph_id: batch.blocks.at(-1)!.id,
      rolling_state: rolling(batch.endPage),
      highlights: [{ paragraph_id: batch.blocks[0].id, quote: '第 1 段正文。' }],
    })
    expect(existsSync(batchPath)).toBe(false)
    expect(result.state.recentAnnotationIds).toHaveLength(1)
    const annotationId = result.annotations[0].id
    store.toggleAnnotationLike(annotationId, true)
    store.addAnnotationReply(annotationId, '我也留意到了这里。')
    // The durable state file contains reading facts, never copied正文.
    expect(readFileSync(join(root, 'store.json'), 'utf8')).not.toContain('第 2 段正文。')

    const restarted = new ReadingStore(root)
    expect(restarted.getReadingState('long-book')?.nextParagraphId).toBe(result.state.nextParagraphId)
    expect(restarted.getAnnotations('long-book', 1, 2)).toHaveLength(1)
    expect(restarted.getAnnotation(annotationId)?.liked).toBe(true)
    expect(restarted.getAnnotation(annotationId)?.replies?.[0]?.text).toBe('我也留意到了这里。')
  })

  test('continues past 100 pages without linearly growing recovery context', () => {
    const { root, store } = makeStore()
    store.importBook(makeBook())
    for (let round = 0; round < 5; round++) {
      const session = store.startSession('long-book', 20)
      while (store.getSession(session.id)?.status !== 'completed') {
        const batch = store.prepareBatch(session.id)
        store.commitBatch({
          sessionId: session.id,
          batchId: batch.id,
          endParagraphId: batch.blocks.at(-1)!.id,
          rollingState: rolling(batch.endPage),
          annotations: [], highlights: [],
          sessionSummary: `第 ${batch.startPage} 到 ${batch.endPage} 页的本轮摘要`,
        })
      }
      // Recreate the process between sessions: progress cannot depend on chat memory.
      const recovered = new ReadingStore(root)
      expect(recovered.getReadingState('long-book')?.currentPage).toBeGreaterThanOrEqual((round + 1) * 20)
    }
    const state = new ReadingStore(root).getReadingState('long-book')!
    expect(state.currentPage).toBeGreaterThanOrEqual(100)
    expect(JSON.stringify(state.rollingSummary).length).toBeLessThanOrEqual(MAX_ROLLING_STATE_CHARS)
    expect(JSON.stringify(state).length).toBeLessThan(6500)
  })
})
