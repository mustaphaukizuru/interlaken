import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('web push service worker companion', () => {
  const src = readFileSync(resolve(__dirname, '../../public/push-sw.js'), 'utf8');

  it('registers push and notificationclick handlers', () => {
    expect(src).toMatch(/addEventListener\(\s*['"]push['"]/);
    expect(src).toMatch(/addEventListener\(\s*['"]notificationclick['"]/);
    expect(src).toContain('showNotification');
    expect(src).toContain('openWindow');
  });

  it('is imported by the VitePWA workbox config', () => {
    const vite = readFileSync(resolve(__dirname, '../../vite.config.ts'), 'utf8');
    expect(vite).toContain("importScripts: ['push-sw.js']");
  });
});
