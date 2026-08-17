// Eunoia Service Worker — 只负责推送通知，不做任何请求缓存
// （避免缓存旧版 JS 导致"改了代码但手机上还是旧行为"的坑）

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || '小满 🌸'
  const options = {
    body: data.body || '给你发了一条消息～',
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: data.tag || 'eunoia-msg',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  const targetUrl = new URL(url, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const client = list.find((item) => item.visibilityState === 'visible') || list[0]
      if (client) {
        // Reuse the already-running app whenever possible. Full navigation
        // reboots React, IndexedDB and the companion socket, then makes the
        // user wait through the startup splash before the target chat opens.
        client.postMessage({ type: 'eunoia-notification-open', url: targetUrl })
        return client.focus()
      }
      return self.clients.openWindow(targetUrl)
    })
  )
})
