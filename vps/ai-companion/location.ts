export function validCoordinates(value: any): value is { latitude: number; longitude: number } {
  return !!value && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90
    && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180
}

export type LocationResolution = { address: string; reason: string | null }

function isTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const name = (error as { name?: unknown }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

// Same AMap Web Service provider as the check-in worker. Key stays on server.
// Convert browser GPS coordinates before reverse geocoding; preserve original
// WGS84 coordinates in the chat message, never label converted coordinates GPS.
export async function resolveLocationAddress(
  location: { latitude: number; longitude: number },
  key: string,
  fetcher = fetch,
  signal: AbortSignal = AbortSignal.timeout(7000),
): Promise<LocationResolution> {
  if (!key.trim()) return { address: '', reason: 'not_configured' }
  const request = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://restapi.amap.com/v3/${path}`)
    url.search = new URLSearchParams({ ...params, key: key.trim() }).toString()
    const response = await fetcher(url, { signal })
    if (!response.ok) throw new Error('map_unavailable')
    const data = await response.json()
    if (data.status !== '1') throw new Error('map_unavailable')
    return data
  }
  const converted = await request('assistant/coordinate/convert', {
    locations: `${location.longitude},${location.latitude}`, coordsys: 'gps',
  })
  const amapLocation = typeof converted.locations === 'string' ? converted.locations.split(';')[0].trim() : ''
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(amapLocation)) throw new Error('map_unavailable')
  const result = await request('geocode/regeo', { location: amapLocation, extensions: 'base', radius: '200' })
  const address = typeof result.regeocode?.formatted_address === 'string' ? result.regeocode.formatted_address.trim().slice(0, 300) : ''
  return { address, reason: address ? null : 'no_address' }
}

export async function fetchLocationMap(
  location: { latitude: number; longitude: number },
  key: string,
  fetcher = fetch,
) {
  if (!key.trim()) throw new Error('map_not_configured')
  const signal = AbortSignal.timeout(9000)
  const request = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://restapi.amap.com/v3/${path}`)
    url.search = new URLSearchParams({ ...params, key: key.trim() }).toString()
    const response = await fetcher(url, { signal })
    if (!response.ok) throw new Error('map_unavailable')
    const data = await response.json()
    if (data.status !== '1') throw new Error('map_unavailable')
    return data
  }
  const converted = await request('assistant/coordinate/convert', {
    locations: `${location.longitude},${location.latitude}`, coordsys: 'gps',
  })
  const amapLocation = typeof converted.locations === 'string' ? converted.locations.split(';')[0].trim() : ''
  if (!/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(amapLocation)) throw new Error('map_unavailable')
  const url = new URL('https://restapi.amap.com/v3/staticmap')
  url.search = new URLSearchParams({
    location: amapLocation,
    zoom: '16',
    size: '720*400',
    scale: '2',
    traffic: '0',
    markers: `large,0x19C37D,我:${amapLocation}`,
    key: key.trim(),
  }).toString()
  const response = await fetcher(url, { signal })
  if (!response.ok) throw new Error('map_unavailable')
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.startsWith('image/')) throw new Error('map_unavailable')
  return { body: await response.arrayBuffer(), contentType }
}

// The VPS uses this only when it cannot read the Worker-owned AMap secret.
// The Worker endpoint is independently authenticated and returns the same
// small browser-facing result, so the AMap key never crosses to the VPS.
export async function resolveLocationAddressViaProxy(
  location: { latitude: number; longitude: number },
  endpoint: string,
  token: string,
  fetcher = fetch,
  signal: AbortSignal = AbortSignal.timeout(10000),
): Promise<LocationResolution> {
  if (!endpoint.trim() || !token.trim()) return { address: '', reason: 'not_configured' }
  try {
    const response = await fetcher(endpoint.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token.trim()}`,
      },
      body: JSON.stringify({ latitude: location.latitude, longitude: location.longitude }),
      signal,
    })
    const data = await response.json().catch(() => null) as any
    if (!response.ok) return { address: '', reason: 'unavailable' }
    const address = typeof data?.address === 'string' ? data.address.trim().slice(0, 300) : ''
    const reason = address
      ? null
      : typeof data?.reason === 'string' && data.reason.trim()
        ? data.reason.trim().slice(0, 80)
        : 'unavailable'
    return { address, reason }
  } catch (error) {
    return { address: '', reason: isTimeoutError(error) ? 'timeout' : 'unavailable' }
  }
}
