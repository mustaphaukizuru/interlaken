/**
 * «Instalar la app» (owner, 2026-11-22): Chrome and Edge fire
 * `beforeinstallprompt` once, early, when the site can be installed. It is
 * kept here (main.tsx starts listening) so the credential page can offer
 * «Instalar» later. The browser's own install bar is left alone (no
 * preventDefault). iPhone Safari has no such event: the page shows the
 * «Compartir → Agregar a inicio» steps instead.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;

export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => { deferred = e as InstallEvent; });
  window.addEventListener('appinstalled', () => { deferred = null; });
}

/** The stored browser prompt, if this browser offered one. */
export function installEvent(): InstallEvent | null {
  return deferred;
}

export function forgetInstallEvent(): void {
  deferred = null;
}

/** Already opened as an installed app (Android/desktop standalone, or iPhone «Agregar a inicio»). */
export function runningInstalled(): boolean {
  const standalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return standalone || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone / iPad Safari (where installing is Compartir → Agregar a inicio). */
export function isIosSafari(ua = navigator.userAgent): boolean {
  const ios = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}
