import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
vi.mock('../../../services/companion', () => ({ fetchCurrentLocationMap: vi.fn() }))
import MessageBubble from '../MessageBubble'

describe('location chat card', () => {
  it('shows the compact map card while keeping AI context text out of the visible bubble', () => {
    const hiddenContext = '纬度 29.833510，经度 103.825879（WGS84）\n定位精度：约 5 米'
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'location-1', conversationId: 'cc', role: 'user', type: 'text',
          content: hiddenContext, timestamp: 1_000,
          locationCard: {
            address: '四川省眉山市青神县青竹街道兰店儿',
            location: { latitude: 29.83351, longitude: 103.825879 },
            distanceMeters: 11092600,
          },
        }}
        theme={{ primary: '#5bcaa4' }}
      />,
    )

    expect(html).toContain('四川省眉山市青神县青竹街道兰店儿')
    expect(html).toContain('打开定位详情')
    expect(html).not.toContain('纬度 29.833510')
    expect(html).not.toContain('定位精度')
  })

  it('rebuilds the card from companion history text after a reload', () => {
    const html = renderToStaticMarkup(
      <MessageBubble
        message={{
          id: 'location-reloaded', conversationId: 'cc', role: 'user', type: 'text', timestamp: 1_000,
          content: [
            '📍 我现在的位置',
            '四川省眉山市青神县青竹街道兰店儿',
            '纬度 29.833510，经度 103.825879（WGS84）',
            '定位精度：约 5 米',
            '目的地：500 Howard Street, San Francisco, CA 94105, USA',
          ].join('\n'),
        }}
        theme={{ primary: '#5bcaa4' }}
      />,
    )

    expect(html).toContain('四川省眉山市青神县青竹街道兰店儿')
    expect(html).toContain('打开定位详情')
    expect(html).not.toContain('纬度 29.833510')
    expect(html).not.toContain('定位精度')
  })
})
