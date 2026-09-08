export function validCoordinates(value: any): value is { latitude: number; longitude: number } {
  return !!value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
}

// Same AMap Web Service provider as the check-in worker. Key stays on server.
// Convert browser GPS coordinates before reverse geocoding; preserve original
// WGS84 coordinates in the chat message, never label converted coordinates GPS.
export async function resolveLocationAddress(location: { latitude: number; longitude: number }, key: string, fetcher = fetch) {
  if (!key) return { address: '', reason: 'not_configured' }
  const signal = AbortSignal.timeout(7000)
  const request = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://restapi.amap.com/v3/${path}`)
    url.search = new URLSearchParams({ ...params, key }).toString()
    const response = await fetcher(url, { signal })
    if (!response.ok) throw new Error('map_unavailable')
    const data = await response.json()
    if (data.status !== '1') throw new Error('map_unavailable')
    return data
  }
  const converted = await request('assistant/coordinate/convert', {
    locations: `${location.longitude},${location.latitude}`, coordsys: 'gps',
  })
  if (typeof converted.locations !== 'string' || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(converted.locations)) throw new Error('map_unavailable')
  const result = await request('geocode/regeo', { location: converted.locations, extensions: 'base', radius: '200' })
  const address = typeof result.regeocode?.formatted_address === 'string' ? result.regeocode.formatted_address.trim().slice(0, 300) : ''
  return { address, reason: address ? null : 'no_address' }
}
