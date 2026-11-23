import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
import { hashTarget, isRootScroll, scrollTop, scrollToY, targetY } from '@/lib/scrollRoot';
import { updateReady } from '@/lib/appUpdate';

/**
 * One scroll rule for the whole app (public site, portal and console):
 *  - a new page starts at the top;
 *  - Back / Forward (and a reload) return to the exact spot the page was left at;
 *  - a link to a section (`/admisiones#estimador`) lands on that section, just
 *    below the sticky header, also when it comes from another page;
 *  - changing only the query (table search, filters, page) keeps the position;
 *  - clicking a link to the page already open scrolls back to its top;
 *  - after a page change the new page's title takes the focus, so screen
 *    readers announce it (never from a field the page focused by itself);
 *  - when a new version of the app is installed, the next page change loads it.
 * Pages load their code and data after the route changes, so restoring and
 * section jumps keep trying for a moment until the content is tall enough,
 * and stop as soon as the person scrolls, taps or types.
 */

type Loc = { pathname: string; search: string; hash: string };
type NavType = 'POP' | 'PUSH' | 'REPLACE';
export type ScrollAction =
  | { kind: 'none' }
  | { kind: 'top' }
  | { kind: 'restore'; y: number }
  | { kind: 'hash'; hash: string; smooth: boolean };

/** What a navigation from `prev` to `next` does to the scroll position (`saved` = where `next` was left). */
export function decideScroll(prev: Loc | null, next: Loc, nav: NavType, saved: number | undefined): ScrollAction {
  if (!prev) {
    if (nav === 'POP' && saved != null) return { kind: 'restore', y: saved };
    return next.hash ? { kind: 'hash', hash: next.hash, smooth: false } : { kind: 'none' };
  }
  if (prev.pathname === next.pathname) {
    return next.hash && next.hash !== prev.hash ? { kind: 'hash', hash: next.hash, smooth: true } : { kind: 'none' };
  }
  if (nav === 'POP' && saved != null) return { kind: 'restore', y: saved };
  return next.hash ? { kind: 'hash', hash: next.hash, smooth: false } : { kind: 'top' };
}

const STORE = 'interlaken.scroll.v1';
const KEEP = 60;
const USER_INPUT = ['wheel', 'touchstart', 'keydown', 'mousedown'] as const;

function readSaved(): Record<string, number> {
  try { return JSON.parse(sessionStorage.getItem(STORE) || '{}') as Record<string, number>; } catch { return {}; }
}
const saved = readSaved();
function remember(key: string, y: number) {
  delete saved[key];
  saved[key] = Math.round(y);
  const keys = Object.keys(saved);
  if (keys.length > KEEP) keys.slice(0, keys.length - KEEP).forEach((k) => delete saved[k]);
  try { sessionStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* private mode: memory only */ }
}

let stopActive: (() => void) | null = null;

/** Re-applies a target while the page grows (lazy code, data), for up to 3 s or until the person takes over. */
function settle(target: () => number | null, { smooth = false, steady = 1 } = {}) {
  stopActive?.();
  let done = false;
  let timer = 0;
  let last: number | null = null;
  let calm = 0;
  const until = Date.now() + 3000;
  const stop = () => {
    done = true;
    window.clearTimeout(timer);
    USER_INPUT.forEach((t) => window.removeEventListener(t, stop, true));
    if (stopActive === stop) stopActive = null;
  };
  stopActive = stop;
  USER_INPUT.forEach((t) => window.addEventListener(t, stop, { capture: true, passive: true }));
  const tick = () => {
    if (done) return;
    const y = target();
    if (y != null) {
      if (y !== last || Math.abs(scrollTop() - y) >= 2) scrollToY(y, smooth);
      calm = y === last && Math.abs(scrollTop() - y) < 2 ? calm + 1 : 0;
      last = y;
      if (smooth || calm >= steady) { stop(); return; }
    }
    if (Date.now() >= until) { stop(); return; }
    timer = window.setTimeout(tick, 50);
  };
  tick();
}

let stopFocus: (() => void) | null = null;
const FIELD = 'input, textarea, select, [contenteditable="true"]';

/** Moves the focus to the new page's <h1> once it renders (keyboard and screen-reader users start there). */
function focusTitle() {
  stopFocus?.();
  let timer = 0;
  const until = Date.now() + 2500;
  const stop = () => { window.clearTimeout(timer); if (stopFocus === stop) stopFocus = null; };
  stopFocus = stop;
  const tick = () => {
    const active = document.activeElement;
    // The page focused a field itself, or a dialog is open: leave the focus there.
    if ((active && active !== document.body && active.matches(FIELD)) || document.querySelector('[aria-modal="true"]')) { stop(); return; }
    const h1 = document.querySelector<HTMLElement>('#contenido h1');
    if (h1) {
      if (!h1.hasAttribute('tabindex')) h1.setAttribute('tabindex', '-1');
      h1.setAttribute('data-route-focus', '');
      h1.focus({ preventScroll: true });
      stop();
      return;
    }
    if (Date.now() < until) timer = window.setTimeout(tick, 50);
    else stop();
  };
  timer = window.setTimeout(tick, 0);
}

function run(action: ScrollAction) {
  if (action.kind === 'top') { stopActive?.(); scrollToY(0); }
  else if (action.kind === 'restore') settle(() => action.y);
  else if (action.kind === 'hash') {
    const { hash, smooth } = action;
    settle(() => { const el = hashTarget(hash); return el ? targetY(el) : null; }, { smooth: smooth && !!hashTarget(hash), steady: 6 });
  }
}

/** Scroll position, section links and focus on navigation. Rendered once inside <BrowserRouter>. */
export function ScrollManager() {
  const location = useLocation();
  const nav = useNavigationType() as NavType;
  const prev = useRef<(Loc & { key: string }) | null>(null);
  // The last position seen and the page it belongs to (the scroll that follows
  // a route change belongs to the next page, so it must not overwrite this one).
  const last = useRef<{ key: string; y: number }>({ key: location.key, y: 0 });

  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    let timer = 0;
    const onScroll = (e: Event) => {
      if (!isRootScroll(e.target)) return;
      last.current = { key: last.current.key, y: scrollTop() };
      if (timer) return;
      const key = last.current.key;
      timer = window.setTimeout(() => {
        timer = 0;
        if (last.current.key === key) remember(key, last.current.y);
      }, 150);
    };
    const onHide = () => remember(last.current.key, scrollTop());
    // A click on a link to the page already open: back to its top (or to the section again).
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      const here = window.location;
      if (url.origin !== here.origin || url.pathname !== here.pathname || url.search !== here.search) return;
      if (!url.hash) window.setTimeout(() => { stopActive?.(); scrollToY(0, true); }, 0);
      else if (url.hash === here.hash) window.setTimeout(() => run({ kind: 'hash', hash: url.hash, smooth: true }), 0);
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    window.addEventListener('pagehide', onHide);
    document.addEventListener('click', onClick, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  useLayoutEffect(() => {
    const before = prev.current;
    if (before && last.current.key === before.key) remember(before.key, last.current.y);
    last.current = { key: location.key, y: last.current.key === location.key ? last.current.y : 0 };
    prev.current = { pathname: location.pathname, search: location.search, hash: location.hash, key: location.key };
    // A new version is installed: this page change loads it (a full load of the address just opened).
    if (before && before.pathname !== location.pathname && updateReady()) { window.location.reload(); return; }
    run(decideScroll(before, location, nav, saved[location.key]));
    if (before && before.pathname !== location.pathname && nav !== 'POP') focusTitle();
    // Only a new history entry moves anything; location.key changes on every one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);

  return null;
}

export default ScrollManager;
