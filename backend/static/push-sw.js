/**
 * Companion handlers imported by the Workbox-generated service worker
 * (see vite.config.ts → workbox.importScripts). Shows OS notifications for
 * payloads from apps.portal.push.send_web_push: { title, body, url }.
 */
/* eslint-disable no-restricted-globals */

self.addEventListener('push', (event) => {
  let data = { title: 'Colegio Interlaken', body: '', url: '/portal' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = {
        title: parsed.title || data.title,
        body: parsed.body || '',
        url: parsed.url || '/portal',
      };
    }
  } catch {
    try {
      if (event.data) data.body = event.data.text() || '';
    } catch {
      /* ignore malformed payloads */
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = (event.notification.data && event.notification.data.url) || '/portal';
  const url = typeof raw === 'string' && raw.startsWith('/') ? raw : '/portal';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          if ('navigate' in client) {
            return client.navigate(url).then((c) => (c && 'focus' in c ? c.focus() : client.focus()));
          }
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
