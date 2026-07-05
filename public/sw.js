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
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
