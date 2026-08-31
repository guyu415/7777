import { describe, expect, it } from 'vitest'
import { buildNeteaseDeepLink, buildNeteaseWebUrl, createNeteasePhoneAction, parseLrc } from '../music'

describe('NetEase phone handoff', () => {
  it('builds an autoplay app deep link and a safe web fallback', () => {
    expect(buildNeteaseDeepLink(1855080368)).toBe('orpheus://song/1855080368/?autoplay=1')
    expect(buildNeteaseWebUrl('1855080368')).toBe('https://music.163.com/song?id=1855080368')
  })

  it('rejects anything except a numeric song id', () => {
    expect(() => buildNeteaseDeepLink('1?x=bad')).toThrow('无效的网易云歌曲 ID')
  })

  it('creates a serializable chat-card action', () => {
    expect(createNeteasePhoneAction({ id: 42, name: '晴天', artists: '周杰伦' })).toEqual({
      provider: 'netease', songId: '42', name: '晴天', artists: '周杰伦', album: '', cover: '',
      deepLink: 'orpheus://song/42/?autoplay=1', webUrl: 'https://music.163.com/song?id=42',
    })
  })

  it('parses timed and translated lyrics with offsets', () => {
    expect(parseLrc('[offset:100]\n[00:01.50]第一句\n[00:03.000][00:05.00]副歌', '[00:01.60]First line')).toEqual([
      { timeMs: 1600, text: '第一句', translation: 'First line' },
      { timeMs: 3100, text: '副歌', translation: '' },
      { timeMs: 5100, text: '副歌', translation: '' },
    ])
  })
})
