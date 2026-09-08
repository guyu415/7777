import { describe, it, expect, vi } from 'vitest'
import { getCurrentLocation, formatLocationMessage, distanceMeters, formatDistance, LOCATION_DESTINATION, locationMapUrl } from '../location'
import { validCoordinates, resolveLocationAddress, fetchLocationMap } from '../../../vps/ai-companion/location'

describe('one-shot chat location', () => {
  it('measures zero at the fixed destination and includes distance in sent text', () => {
    expect(LOCATION_DESTINATION.longitude).toBe(-122.3968)
    expect(distanceMeters(LOCATION_DESTINATION)).toBe(0)
    const text = formatLocationMessage({ ...LOCATION_DESTINATION, accuracy: 5, timestamp: Date.now() })
    expect(text).toContain('500 Howard Street, San Francisco, CA 94105, USA')
    expect(text).toContain('直线距离：约 0 米')
  })
  it('calculates known spherical distances, including across the date line', () => {
    expect(distanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeCloseTo(111195.08, 1)
    expect(distanceMeters({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 })).toBeCloseTo(222390.16, 1)
    expect(distanceMeters({ latitude: -LOCATION_DESTINATION.latitude, longitude: LOCATION_DESTINATION.longitude + 180 })).toBeCloseTo(Math.PI * 6371008.8, 0)
    expect(formatDistance(12345678)).toBe('约 12,345.7 公里')
  })
  it('previews original GPS coordinates without applying AMap offsets', () => {
    const url = new URL(locationMapUrl(LOCATION_DESTINATION))
    expect(url.searchParams.get('marker')).toBe('37.7876,-122.3968')
    const [west, south, east, north] = url.searchParams.get('bbox').split(',').map(Number)
    expect(west).toBeLessThan(-122.3968)
    expect(east).toBeGreaterThan(-122.3968)
    expect(south).toBeLessThan(37.7876)
    expect(north).toBeGreaterThan(37.7876)
  })
  it('requests fresh GPS and retains capture time and precision', async () => {
    const timestamp = Date.now()
    const geolocation = { getCurrentPosition: vi.fn(success => success({ coords: { latitude: 30, longitude: 104, accuracy: 14.1 }, timestamp })) }
    const result = await getCurrentLocation({ geolocation })
    expect(geolocation.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
    expect(result.timestamp).toBe(timestamp)
    expect(formatLocationMessage(result, '测试地址')).toContain('测试地址\n纬度 30.000000，经度 104.000000（WGS84）\n定位精度：约 15 米')
  })
  it('reports permission denial without sending a stale location', async () => {
    await expect(getCurrentLocation({ geolocation: { getCurrentPosition: (_, reject) => reject({ code: 1 }) } })).rejects.toThrow('定位权限未开启')
  })
  it('cancels when switching conversations and ignores a late GPS callback', async () => {
    const controller = new AbortController()
    let callback
    const promise = getCurrentLocation({ signal: controller.signal, geolocation: { getCurrentPosition: success => { callback = success } } })
    controller.abort()
    callback({ coords: { latitude: 30, longitude: 104, accuracy: 5 }, timestamp: Date.now() })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('rejects a cached fix older than one minute', async () => {
    await expect(getCurrentLocation({ geolocation: { getCurrentPosition: success => success({ coords: { latitude: 30, longitude: 104, accuracy: 5 }, timestamp: Date.now() - 120000 }) } })).rejects.toThrow('未获取到有效')
  })
  it('times out even if the browser never calls back', async () => {
    vi.useFakeTimers()
    try {
      const promise = getCurrentLocation({ geolocation: { getCurrentPosition() {} } })
      const check = expect(promise).rejects.toThrow('定位超时')
      await vi.advanceTimersByTimeAsync(22000)
      await check
    } finally { vi.useRealTimers() }
  })
})

describe('authenticated route address helper', () => {
  it('rejects invalid coordinates, accepts zero', () => {
    expect(validCoordinates({ latitude: 0, longitude: 0 })).toBe(true)
    for (const latitude of [null, '30', NaN, Infinity, 91]) expect(validCoordinates({ latitude, longitude: 104 })).toBe(false)
  })
  it('converts GPS before looking up an AMap address', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: '1', locations: '104.003,30.002' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: '1', regeocode: { formatted_address: '测试地址' } }) })
    expect(await resolveLocationAddress({ latitude: 30, longitude: 104 }, 'test-key', fetcher)).toEqual({ address: '测试地址', reason: null })
    expect(fetcher.mock.calls[0][0].searchParams.get('coordsys')).toBe('gps')
    expect(fetcher.mock.calls[0][0].searchParams.get('locations')).toBe('104,30')
    expect(fetcher.mock.calls[1][0].searchParams.get('location')).toBe('104.003,30.002')
  })
  it('does not call AMap without a configured key', async () => {
    const fetcher = vi.fn()
    expect(await resolveLocationAddress({ latitude: 30, longitude: 104 }, '', fetcher)).toEqual({ address: '', reason: 'not_configured' })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('does not treat an upstream API error as an address', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: '0', info: 'INVALID_USER_KEY' }) })
    await expect(resolveLocationAddress({ latitude: 30, longitude: 104 }, 'test-key', fetcher)).rejects.toThrow('map_unavailable')
  })
  it('converts GPS and proxies a real image response for the map card', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const fetcher = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ status: '1', locations: '104.003,30.002' }) })
      .mockResolvedValueOnce({ ok: true, headers: new Headers({ 'content-type': 'image/png' }), arrayBuffer: async () => bytes })
    const map = await fetchLocationMap({ latitude: 30, longitude: 104 }, 'test-key', fetcher)
    expect(map.contentType).toBe('image/png')
    expect(new Uint8Array(map.body)).toEqual(new Uint8Array([1, 2, 3]))
    const url = fetcher.mock.calls[1][0]
    expect(url.pathname).toBe('/v3/staticmap')
    expect(url.searchParams.get('location')).toBe('104.003,30.002')
    expect(url.searchParams.get('key')).toBe('test-key')
  })
})
