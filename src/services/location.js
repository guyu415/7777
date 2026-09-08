export const LOCATION_DESTINATION = Object.freeze({
  address: '500 Howard Street, San Francisco, CA 94105, USA',
  latitude: 37.7876,
  longitude: -122.3968,
})

// Great-circle distance on the mean-radius Earth; both inputs use WGS84.
export function distanceMeters(from, to = LOCATION_DESTINATION) {
  const radians = degrees => degrees * Math.PI / 180
  const a = Math.sin(radians(to.latitude - from.latitude) / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude))
    * Math.sin(radians(to.longitude - from.longitude) / 2) ** 2
  return 6371008.8 * 2 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))))
}

export function formatDistance(meters) {
  return meters < 1000 ? `约 ${Math.round(meters)} 米` : `约 ${(meters / 1000).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 公里`
}

export function locationMapUrl(location) {
  const lat = Math.max(-85, Math.min(85, location.latitude))
  const lng = location.longitude
  const params = new URLSearchParams({
    bbox: `${Math.max(-180, lng - 0.008)},${lat - 0.005},${Math.min(180, lng + 0.008)},${lat + 0.005}`,
    layer: 'mapnik', marker: `${location.latitude},${lng}`,
  })
  return `https://www.openstreetmap.org/export/embed.html?${params}`
}

// Each preview obtains a fresh, one-shot fix. Never substitute check-in history.
export function getCurrentLocation({ signal, geolocation = globalThis.navigator?.geolocation } = {}) {
  return new Promise((resolve, reject) => {
    if (!geolocation) return reject(new Error('当前浏览器不支持定位，请使用 HTTPS 页面或 Safari'))
    let finished = false
    let timer
    const finish = (error, value) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      error ? reject(error) : resolve(value)
    }
    const abort = () => finish(new DOMException('定位已取消', 'AbortError'))
    if (signal?.aborted) return abort()
    signal?.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(new Error('定位超时，请到信号较好的地方重试')), 22000)
    geolocation.getCurrentPosition(position => {
      const { latitude, longitude, accuracy } = position.coords
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(position.timestamp) || Math.abs(Date.now() - position.timestamp) > 60000) {
        return finish(new Error('未获取到有效的当前位置，请重试'))
      }
      finish(null, { latitude, longitude, accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null, timestamp: position.timestamp })
    }, error => finish(new Error({
      1: '定位权限未开启，请在浏览器设置中允许此网站访问位置',
      2: '暂时无法获取位置，请检查手机定位服务后重试',
      3: '定位超时，请到信号较好的地方重试',
    }[error.code] || '定位失败，请重试')), { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 })
  })
}

export function formatLocationMessage(location, address = '') {
  return [
    '📍 我现在的位置',
    address || '地址暂未解析，以下为本次实时定位坐标',
    `纬度 ${location.latitude.toFixed(6)}，经度 ${location.longitude.toFixed(6)}（WGS84）`,
    location.accuracy !== null ? `定位精度：约 ${Math.ceil(location.accuracy)} 米` : '',
    `定位时间：${new Date(location.timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（UTC+8）`,
    `目的地：${LOCATION_DESTINATION.address}`,
    `目的地参考坐标：37.7876°N, 122.3968°W`,
    `直线距离：${formatDistance(distanceMeters(location))}（按给定坐标的球面估算）`,
  ].filter(Boolean).join('\n')
}

// Companion history stores the text that was actually sent to CC. Rebuild the
// visual card from that canonical text after reload/reconnect so card metadata
// does not have to enter CC's message protocol or leak into the visible bubble.
export function parseLocationMessage(content) {
  if (typeof content !== 'string' || !content.startsWith('📍 我现在的位置\n')) return null
  const lines = content.split('\n')
  const coordinateLine = lines.find(line => line.startsWith('纬度 ')) || ''
  const coordinates = coordinateLine.match(/^纬度 (-?\d+(?:\.\d+)?)，经度 (-?\d+(?:\.\d+)?)（WGS84）$/)
  if (!coordinates) return null
  const latitude = Number(coordinates[1])
  const longitude = Number(coordinates[2])
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) return null

  const address = (lines[1] || '').trim()
  return {
    address: address && !address.startsWith('地址暂未解析') ? address.slice(0, 300) : '我的位置',
    location: { latitude, longitude },
    distanceMeters: distanceMeters({ latitude, longitude }),
  }
}
