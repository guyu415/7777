import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openDBMock } = vi.hoisted(() => ({ openDBMock: vi.fn() }))

vi.mock('idb', () => ({ openDB: openDBMock }))

describe('message IndexedDB recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    openDBMock.mockReset()
  })

  it('reopens and retries when iOS resumes with an inactive transaction', async () => {
    const inactive = Object.assign(
      new Error('Attempt to get a record from database without an in-progress transaction'),
      { name: 'TransactionInactiveError' },
    )
    const staleDatabase = {
      get: vi.fn().mockRejectedValue(inactive),
      close: vi.fn(),
    }
    const freshDatabase = {
      get: vi.fn().mockResolvedValue({
        id: 'reply-1',
        reasoningTranslation: '保留的翻译',
        reasoningTranslationSourceHash: 'hash-1',
        reasoningTranslationUpdatedAt: 123,
      }),
      put: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    }
    openDBMock.mockResolvedValueOnce(staleDatabase).mockResolvedValueOnce(freshDatabase)

    const { saveMessage } = await import('../index.js')
    await expect(saveMessage({ id: 'reply-1', content: '正文' })).resolves.toBeUndefined()

    expect(staleDatabase.close).toHaveBeenCalledOnce()
    expect(openDBMock).toHaveBeenCalledTimes(2)
    expect(freshDatabase.put).toHaveBeenCalledWith('messages', {
      id: 'reply-1',
      content: '正文',
      reasoningTranslation: '保留的翻译',
      reasoningTranslationSourceHash: 'hash-1',
      reasoningTranslationUpdatedAt: 123,
    })
  })
})
