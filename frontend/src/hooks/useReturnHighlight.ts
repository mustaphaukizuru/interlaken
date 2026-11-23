import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { RowKey } from '@/hooks/useRowSelection';
import { forgetOpened, lastOpenedScope, peekOpened, rememberOpened } from '@/lib/lastOpened';
import styles from './returnHighlight.module.css';

/** How long the row stays tinted (the CSS fade runs for the same 2 s). */
export const FLASH_MS = 2000;
/** After a click on a row, how long a dialog has to open for it to count as «opened here». */
export const DIALOG_WAIT_MS = 1500;
/** How long a list that comes back waits for the remembered row to load. */
export const PENDING_MS = 10_000;
/** The visibility check waits this long, so the console's Back/Forward scroll
 *  restore lands first and a row it already shows is left where it is. */
export const REVEAL_DELAY_MS = 300;

const DIALOGS = '[role="dialog"],[role="alertdialog"]';
const countDialogs = () => document.querySelectorAll(DIALOGS).length;
/** Overflow values that cut what lies outside the box. */
const CLIPS = /^(auto|scroll|hidden|clip)$/;

/**
 * Scroll `el` into view only when it is not fully visible: inside every
 * clipping ancestor (the table's own scroll box, the console's content column)
 * and the viewport, below a sticky table header. Never smooth, never when the
 * element has no box (a hidden tab, jsdom).
 */
export function revealIfHidden(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return;
  let top = 0;
  let bottom = window.innerHeight || document.documentElement.clientHeight;
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (!CLIPS.test(getComputedStyle(p).overflowY)) continue;
    const pr = p.getBoundingClientRect();
    top = Math.max(top, pr.top);
    bottom = Math.min(bottom, pr.bottom);
  }
  // A header stuck to the top of the table's scroll box covers the rows under it.
  const head = el.closest('table')?.tHead?.getBoundingClientRect();
  if (head && head.height > 0 && head.top <= top + 1 && head.bottom > top) top = head.bottom;
  if (r.top >= top - 1 && r.bottom <= bottom + 1) return;
  el.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: 'auto' });
}

export interface ReturnHighlightOptions {
  /** Which list on the page (DataTable's `tableId`); the memory is per pathname + this. */
  listId?: string;
  /** Keys of the rows on screen now; `undefined` while there is nothing to show. */
  keys: RowKey[] | undefined;
  /** The data has loaded: a remembered row that is not among `keys` will not appear. */
  settled: boolean;
  /** The record shown beside the list (a side panel, not a dialog). When it
   *  goes back to null, the row it showed is pointed at. */
  openKey?: RowKey | null;
  /** Where to look for the highlighted element when checking it is in view. */
  rootRef: RefObject<HTMLElement | null>;
}

export interface ReturnHighlight {
  /** Props for the element of `key`: the tint class and `data-last-opened`, while it shows. */
  flashProps: (key: RowKey) => { className: string; 'data-last-opened': 'true' } | null;
  /** The person opened the record of `key` from this list (a link, a button, the row itself). */
  noteOpen: (key: RowKey) => void;
}

/**
 * «Volver a la misma fila» for one list. When a person opens a record and
 * comes back, the row they opened is tinted for about 2 s (no fade under
 * reduced motion) and scrolled into view only if it is out of sight:
 *
 * - Detail route (`/admin/admisiones/:id`): `noteOpen` remembers the row in
 *   sessionStorage (lib/lastOpened); when the list mounts again (Back,
 *   «Volver», breadcrumb, after saving) it waits for that row to render, even
 *   if the data loads late, points at it once and forgets it.
 * - Dialog or drawer on the same page: when a dialog opens within
 *   DIALOG_WAIT_MS of the click, the row is pointed at as soon as the last
 *   dialog closes. A dialog closed by a link that leaves the page keeps the
 *   memory for the way back instead.
 * - Side panel (not a dialog): the page passes `openKey`.
 *
 * It never restores a scroll position itself (the console's scroll manager
 * does that on Back/Forward); it only nudges a row that is still hidden.
 */
export function useReturnHighlight({ listId, keys, settled, openKey, rootRef }: ReturnHighlightOptions): ReturnHighlight {
  const [flash, setFlash] = useState<{ key: string; n: number } | null>(null);
  const start = useCallback((key: RowKey) => setFlash((f) => ({ key: String(key), n: (f?.n ?? 0) + 1 })), []);

  // What an earlier visit left (opened a detail route, then came back). Read
  // once; the effect below spends it, so it is pointed at once.
  const [initial] = useState(() => {
    const scope = lastOpenedScope(listId);
    return { scope, key: peekOpened(scope) };
  });
  const [pending, setPending] = useState<string | null>(initial.key);
  useEffect(() => {
    if (initial.key !== null) forgetOpened(initial.scope, initial.key);
  }, [initial]);

  // The remembered row is on screen (now, or once the data arrives): point at
  // it. Loaded without it (another page, filtered out, deleted): drop it.
  if (pending !== null && keys) {
    if (keys.some((k) => String(k) === pending)) {
      setPending(null);
      start(pending);
    } else if (settled && keys.length > 0) {
      setPending(null);
    }
  }
  useEffect(() => {
    if (pending === null) return;
    const t = window.setTimeout(() => setPending(null), PENDING_MS);
    return () => window.clearTimeout(t);
  }, [pending]);

  // A side panel closed: point at the row it showed.
  const open = openKey ?? null;
  const [prevOpen, setPrevOpen] = useState<RowKey | null>(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open === null && prevOpen !== null) start(prevOpen);
  }

  // While tinted: bring the row into view if it is hidden, then clear the tint.
  useEffect(() => {
    if (!flash) return;
    const reveal = window.setTimeout(() => {
      const el = rootRef.current?.querySelector<HTMLElement>('[data-last-opened]');
      if (el) revealIfHidden(el);
    }, REVEAL_DELAY_MS);
    const end = window.setTimeout(() => setFlash(null), FLASH_MS);
    return () => {
      window.clearTimeout(reveal);
      window.clearTimeout(end);
    };
  }, [flash, rootRef]);

  // Mounted = still on the list. A list that unmounts after a click on a row
  // was left for the record (a detail route): the memory stays for the way back.
  const mounted = useRef(false);
  // Stops watching the last click for a dialog; a newer click or unmounting calls it.
  const armed = useRef<(() => void) | null>(null);
  useEffect(() => {
    mounted.current = true;
    const box = armed;
    return () => {
      mounted.current = false;
      box.current?.();
    };
  }, []);

  const noteOpen = useCallback((key: RowKey) => {
    armed.current?.();
    const scope = lastOpenedScope(listId);
    const path = window.location.pathname;
    // Still here: mounted, same address (a lazy route can keep the old page up
    // for a moment after the address has already changed).
    const stillHere = () => mounted.current && window.location.pathname === path;
    rememberOpened(scope, key);

    const baseline = countDialogs();
    let inDialog = false;
    let observer: MutationObserver | null = null;
    let giveUp = 0;
    const stop = () => {
      observer?.disconnect();
      window.clearTimeout(giveUp);
      if (armed.current === stop) armed.current = null;
    };

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        const open = countDialogs();
        if (!inDialog) {
          if (open > baseline) {
            inDialog = true;
            window.clearTimeout(giveUp);
          }
          return;
        }
        if (open > baseline) return;
        stop();
        // Decide once React is done: a dialog closed by a link that leaves the
        // page unmounts the list too, and then the memory waits for the way back.
        window.setTimeout(() => {
          if (!stillHere()) return;
          forgetOpened(scope, key);
          start(key);
        }, 0);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    // No dialog opened: it was a navigation (keep the memory) or an action in place (drop it).
    giveUp = window.setTimeout(() => {
      stop();
      if (stillHere()) forgetOpened(scope, key);
    }, DIALOG_WAIT_MS);
    armed.current = stop;
  }, [listId, start]);

  const flashProps = (key: RowKey) =>
    flash && flash.key === String(key)
      ? { className: (flash.n % 2 ? styles.flashA : styles.flashB) ?? '', 'data-last-opened': 'true' as const }
      : null;

  return { flashProps, noteOpen };
}
