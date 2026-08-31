import React, { useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './store/messageTimelineGuard'
import App from './App'
import OpeningSplash from './components/OpeningSplash'
import { PUSH_NAVIGATION_EVENT, isPushNavigationUrl } from './utils/notificationNavigation'
import './styles/globals.css'

// 注册 Service Worker（推送通知需要；sw.js 不做请求缓存）
if ('serviceWorker' in navigator) {
  // A notification tap on an already-open app is delivered by sw.js as a
  // message, rather than forcing a full page navigation. Retain the target
  // until App mounts in case the splash screen is still on top.
  navigator.serviceWorker.addEventListener('message', (event) => {
    const { type, url } = event.data || {}
    if (type !== 'eunoia-notification-open' || typeof url !== 'string') return
    window.__eunoiaPendingPushNavigation = url
    window.dispatchEvent(new CustomEvent(PUSH_NAVIGATION_EVENT, { detail: { url } }))
  })

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => {
      console.warn('[SW] 注册失败:', e.message)
    })
  })
}

// iOS Safari 的双指缩放走私有 gesture 事件，viewport meta 拦不全，这里兜底；
// 双击放大由 CSS touch-action: manipulation 处理，不额外拦 touchend（会误伤快速连点）
for (const evt of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(evt, e => e.preventDefault(), { passive: false })
}

function AppBoot() {
  // Push links should lead straight to their message. Apart from saving the
  // 3.2s animation, this starts the companion connection immediately when a
  // notification opens a fresh PWA window.
  const [splashDone, setSplashDone] = useState(() => isPushNavigationUrl(window.location.href, window.location.origin))
  const finishSplash = useCallback(() => setSplashDone(true), [])

  useEffect(() => {
    const skipSplashForPush = () => setSplashDone(true)
    window.addEventListener(PUSH_NAVIGATION_EVENT, skipSplashForPush)
    return () => window.removeEventListener(PUSH_NAVIGATION_EVENT, skipSplashForPush)
  }, [])

  // Do not start settings hydration, IndexedDB reads, WebSockets and the
  // full app compositor underneath the animated splash.  Running both at
  // once was especially expensive in iOS WebKit's memory-limited process.
  return splashDone ? <App /> : <OpeningSplash onComplete={finishSplash} />
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppBoot />
  </React.StrictMode>
)
