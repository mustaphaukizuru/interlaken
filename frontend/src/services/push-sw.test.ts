import { describe, it, expect } from 'vitest';
// Vite raw import — avoids node:fs so tsc --noEmit stays happy.
import pushSw from '../../public/push-sw.js?raw';
import viteConfig from '../../vite.config.ts?raw';

describe('web push service worker companion', () => {
  it('registers push and notificationclick handlers', () => {
    expect(pushSw).toMatch(/addEventListener\(\s*['"]push['"]/);
    expect(pushSw).toMatch(/addEventListener\(\s*['"]notificationclick['"]/);
    expect(pushSw).toContain('showNotification');
    expect(pushSw).toContain('openWindow');
  });

  it('is imported by the VitePWA workbox config', () => {
    expect(viteConfig).toContain("importScripts: ['push-sw.js']");
  });
});
