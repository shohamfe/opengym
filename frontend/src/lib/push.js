// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api.js'

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported')
export const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const standalone = () => navigator.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches

// Which Notifications screen to show; first match wins. iPhone only offers web push to Home Screen apps on 16.4+.
export function notifyState({ user, supported, ios, installed, perm, subscribed }) {
  if (!user) return 'guest'
  if (!supported) return !ios ? 'unsupported' : installed ? 'oldIos' : 'install'
  if (perm === 'denied') return 'denied'
  return subscribed ? 'on' : 'off'
}

const urlBase64ToUint8Array = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Push notifications are not supported in this browser')
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') throw new Error('Notifications permission was not granted')
  const reg = await navigator.serviceWorker.ready
  const { key } = await api('/api/push/public-key')
  const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON() }) })
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
}

export const sendTestPush = () => api('/api/push/test', { method: 'POST', body: '{}' })
