// Web Push 订阅管理。iOS 16.4+ 只有"添加到主屏幕"后从桌面图标打开的
// PWA 才有 Notification/PushManager；普通 Safari 标签页里不可用。

const SYNC_BASE = 'https://chat.xiaoman.xyz'

// VAPID 公钥（公开信息，与 Worker 端 VAPID_PRIVATE_KEY secret 配对）
export const VAPID_PUBLIC_KEY = 'BPKvBZCXuZkfYM2ecirl3U-2bbyeembT9Xzt8Z6LtO7_gAzAPLFhkBMfT0_bw3L_FczUdbzlF-Sst-a5fdpxI_w'

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function pushSupportState() {
  if (!('serviceWorker' in navigator)) return 'unsupported'
  if (!('Notification' in window) || !('PushManager' in window)) {
    // iOS Safari 标签页：需要先安装到主屏幕
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
    return isIOS ? 'need-install' : 'unsupported'
  }
  return 'supported'
}

export async function getCurrentSubscription() {
  if (pushSupportState() !== 'supported') return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

export async function subscribePush(password) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('通知权限被拒绝')
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  })
  const res = await fetch(`${SYNC_BASE}/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, subscription: sub.toJSON() }),
  })
  if (!res.ok) throw new Error(`订阅保存失败 HTTP ${res.status}`)
  return sub
}

export async function unsubscribePush(password) {
  const sub = await getCurrentSubscription()
  if (!sub) return
  const endpoint = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  await fetch(`${SYNC_BASE}/push/unsubscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, endpoint }),
  }).catch(() => {})
}

export async function sendTestPush(password) {
  const res = await fetch(`${SYNC_BASE}/push/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
