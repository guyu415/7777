import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRecentLettersByCharacter } from '../letters'

afterEach(() => vi.unstubAllGlobals())

describe('mailbox history', () => {
  it('requests a lightweight index for the selected session', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-password' })
    const letters = [{ id: 'old', role: 'ai' }, { id: 'new', role: 'user' }]
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ letters }) })
    vi.stubGlobal('fetch', fetchMock)
    expect(await getRecentLettersByCharacter('session/1', 50, { throwOnError: true })).toEqual(letters)
    const url = new URL(fetchMock.mock.calls[0][0])
    expect(url.pathname).toBe('/diary/list')
    expect(url.searchParams.get('sessionId')).toBe('session/1')
    expect(url.searchParams.get('limit')).toBe('50')
  })

  it('reports selector errors while preserving the existing chat fallback', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-password' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    await expect(getRecentLettersByCharacter('session', 50, { throwOnError: true })).rejects.toThrow('HTTP 503')
    await expect(getRecentLettersByCharacter('session')).resolves.toEqual([])
  })

  it('does not request history without a session', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'test-password' })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(getRecentLettersByCharacter(undefined, 50)).resolves.toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
