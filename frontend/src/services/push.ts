/**
 * push.ts — opt-in Web Push scaffolding for future portal notifications.
 *
 * This is intentionally inert until:
 *   1. VITE_VAPID_PUBLIC_KEY is configured, and
 *   2. the user explicitly opts in (call subscribeToPush from a UI control).
 *
 * It relies on the service worker registered by vite-plugin-pwa. The resulting
 * PushSubscription should be POSTed to the backend to persist per user — wire
 * that up when the portal notification endpoint exists.
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
 * Request permission and subscribe to Web Push. Returns the subscription (to be
 * sent to the backend) or null if unsupported/denied. Safe to call from a click
 * handler — never runs on its own.
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
 * Full opt-in: browser subscription + persist it on the backend so
 * portal notifications (cafetería, pagos, avisos) reach this device.
 * Call from a click handler. Returns true when the server stored it.
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
