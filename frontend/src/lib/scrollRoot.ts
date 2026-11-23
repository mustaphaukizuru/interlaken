/**
 * Which element scrolls the page. The public site scrolls the window; the
 * portal and the console scroll one content column (PortalLayout registers it),
 * so the sidebar and the top bar stay put. The scroll manager and the «Volver
 * arriba» button read and move whichever one is active.
 */
let root: HTMLElement | null = null;

/** PortalLayout: its content column while mounted, null when it goes away. */
export function setScrollRoot(el: HTMLElement | null): void {
  root = el;
}

/** Unregisters `el` (and only `el`: a newer column may already have taken its place). */
export function releaseScrollRoot(el: HTMLElement | null): void {
  if (root === el) root = null;
}

/** The registered column, or null when the window scrolls. */
export function scrollRoot(): HTMLElement | null {
  return root && root.isConnected ? root : null;
}

/** True for the scroll event of the active scroller (window events target the document). */
export function isRootScroll(target: EventTarget | null): boolean {
  const r = scrollRoot();
  return r ? target === r : target === document || target === document.documentElement;
}

export function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function scrollTop(): number {
  const r = scrollRoot();
  return r ? r.scrollTop : window.scrollY;
}

/** Visible height of the active scroller. */
export function viewHeight(): number {
  const r = scrollRoot();
  return r ? r.clientHeight : window.innerHeight;
}

export function scrollToY(top: number, smooth = false): void {
  const behavior: ScrollBehavior = smooth && !reducedMotion() ? 'smooth' : 'auto';
  const r = scrollRoot();
  if (r) r.scrollTo?.({ top, behavior });
  else window.scrollTo?.({ top, behavior });
}

/** Where `el` sits in the scroller, leaving room for the sticky header (public site) and a small gap. */
export function targetY(el: Element): number {
  const box = el.getBoundingClientRect();
  const r = scrollRoot();
  if (r) return Math.max(0, r.scrollTop + box.top - r.getBoundingClientRect().top - 16);
  const header = document.querySelector('[data-sticky-header]');
  const headerH = header ? header.getBoundingClientRect().height : 0;
  return Math.max(0, window.scrollY + box.top - headerH - 16);
}

/** The element a `#hash` points to (ids may be URL-encoded). */
export function hashTarget(hash: string): HTMLElement | null {
  if (!hash || hash === '#') return null;
  let id = hash.slice(1);
  try { id = decodeURIComponent(id); } catch { /* keep the raw id */ }
  return document.getElementById(id);
}
