export function validCoordinates(value: any): value is { latitude: number; longitude: number } {
  return !!value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
}

// Same AMap Web Service provider as the check-in worker. Key stays on server.
// Convert browser GPS coordinates before reverse geocoding; preserve original
// WGS84 coordinates in the chat message, never label converted coordinates GPS.
async function amapRequest(path: string, params: Record<string, string>, key: string, fetcher: typeof fetch, signal: AbortSignal) {
  const url = new URL(`https://restapi.amap.com/v3/${path}`)
  url.search = new URLSearchParams({ ...params, key }).toString()
  return fetcher(url, { signal })
}

export async function convertGpsCoordinates(location: { latitude: number; longitude: number }, key: string, fetcher = fetch, signal = AbortSignal.timeout(7000)) {
  const response = await amapRequest('assistant/coordinate/convert', {
    locations: `${location.longitude},${location.latitude}`, coordsys: 'gps',
  }, key, fetcher, signal)
  if (!response.ok) throw new Error('map_unavailable')
  const converted = await response.json() as any
  if (converted.status !== '1' || typeof converted.locations !== 'string' || !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(converted.locations)) {
    throw new Error('map_unavailable')
  }
  return converted.locations
}

export async function resolveLocationAddress(location: { latitude: number; longitude: number }, key: string, fetcher = fetch) {
  if (!key) return { address: '', reason: 'not_configured' }
  const signal = AbortSignal.timeout(7000)
  const coordinates = await convertGpsCoordinates(location, key, fetcher, signal)
  const response = await amapRequest('geocode/regeo', { location: coordinates, extensions: 'base', radius: '200' }, key, fetcher, signal)
  if (!response.ok) throw new Error('map_unavailable')
  const result = await response.json() as any
  if (result.status !== '1') throw new Error('map_unavailable')
  const address = typeof result.regeocode?.formatted_address === 'string' ? result.regeocode.formatted_address.trim().slice(0, 300) : ''
  return { address, reason: address ? null : 'no_address' }
}

export async function fetchLocationMap(location: { latitude: number; longitude: number }, key: string, fetcher = fetch) {
  if (!key) throw new Error('map_not_configured')
  const signal = AbortSignal.timeout(9000)
  const coordinates = await convertGpsCoordinates(location, key, fetcher, signal)
  const response = await amapRequest('staticmap', {
    location: coordinates,
    zoom: '16',
    size: '720*400',
    scale: '2',
    traffic: '0',
    markers: `large,0x19C37D,我:${coordinates}`,
  }, key, fetcher, signal)
  if (!response.ok) throw new Error('map_unavailable')
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) throw new Error('map_unavailable')
  return { body: await response.arrayBuffer(), contentType }
}
