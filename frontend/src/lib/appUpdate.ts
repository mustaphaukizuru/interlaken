/**
 * A new version of the app is installed (service worker). The page keeps the
 * code it has until the person moves to another page (ScrollManager reloads
 * there, so the switch is invisible) or presses «Actualizar» in the banner.
 * Before this, the PWA plugin reloaded the page by itself, even mid-form.
 */
let ready = false;

export function markUpdateReady(): void {
  ready = true;
}

export function updateReady(): boolean {
  return ready;
}

/** «Reload now» is safe in the first seconds after the page opened, before the person has started anything. */
export function freshPageLoad(now = performance.now()): boolean {
  const active = document.activeElement;
  const typing = !!active && active !== document.body && active.matches('input, textarea, select, [contenteditable="true"]');
  return now < 8000 && !typing;
}
