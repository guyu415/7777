import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/globals.css'

// 注册 Service Worker（推送通知需要；sw.js 不做请求缓存）
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(e => {
      console.warn('[SW] 注册失败:', e.message)
    })
  })
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
