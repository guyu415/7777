import React, { useCallback, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import OpeningSplash from './components/OpeningSplash'
import './styles/globals.css'

// 注册 Service Worker（推送通知需要；sw.js 不做请求缓存）
if ('serviceWorker' in navigator) {
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
  const [splashDone, setSplashDone] = useState(false)
  const finishSplash = useCallback(() => setSplashDone(true), [])

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
