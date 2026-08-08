/**
 * push.ts — Web Push opt-in for portal notifications.
 *
 * Inert until VITE_VAPID_PUBLIC_KEY is set. Relies on the vite-plugin-pwa
 * service worker (which imports public/push-sw.js for push + notificationclick).
 * enablePush() persists the subscription via portalApi.subscribePush.
 */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** True when the browser supports Web Push and a VAPID key is configured. */
export function isPushSupported(): boolean {
  return (
    !!VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

/** Current notification permission, or 'unsupported'. */
export function pushPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

function urlBase64ToUint8Array(base64: string): BufferSource {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Request permission and subscribe to Web Push. Returns the subscription or
 * null if unsupported/denied. Call from a click handler only.
 */
export async function subscribeToPush(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const registration = await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!),
  });
}

/** Remove the current push subscription, if any. */
export async function unsubscribeFromPush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  return sub ? sub.unsubscribe() : false;
}

/**
 * Full opt-in: browser subscription + persist on the backend so
 * portal notifications (cafetería, pagos, avisos) reach this device.
 */
export async function enablePush(): Promise<boolean> {
  const sub = await subscribeToPush();
  if (!sub) return false;
  const { portalApi } = await import('@/services/api');
  await portalApi.subscribePush(sub.toJSON() as {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  });
  return true;
}

/** Full opt-out: remove on the backend first, then locally. */
export async function disablePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return false;
  const registration = await navigator.serviceWorker.ready;
  const sub = await registration.pushManager.getSubscription();
  if (!sub) return false;
  const { portalApi } = await import('@/services/api');
  await portalApi.unsubscribePush(sub.endpoint).catch(() => {});
  return sub.unsubscribe();
}
