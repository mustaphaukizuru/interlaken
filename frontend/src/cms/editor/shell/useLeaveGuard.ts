import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * - `clean`: nothing to save or publish, leave freely;
 * - `pending`: an autosave is queued or running: save first, then leave
 *   (or ask, when `unpublished` says the saved edits are not on the site);
 * - `unsaved`: the last save failed or is paused by a conflict: ask;
 * - `unpublished`: saved, but the site does not show the edits yet: ask
 *   in the app (no browser prompt: nothing would be lost).
 */
export type LeaveState = 'clean' | 'pending' | 'unsaved' | 'unpublished';

export type LeaveReason = 'unsaved' | 'unpublished';

interface Options {
  state: LeaveState;
  flush: () => Promise<boolean>;
  /** Edits made in this visit are saved but not published (asked about after the last save). */
  unpublished?: boolean;
  /** Runs before leaving with unsaved edits (keeps a copy in this browser). */
  beforeLeave?: () => void;
}

/**
 * Warns before leaving the editor with edits that did not reach the server
 * (the browser prompt on reload/close, an in-app dialog for console links;
 * the app uses <BrowserRouter>, which has no navigation blocker), and before
 * leaving edits that reached the server but not the public site.
 */
export function useLeaveGuard({ state, flush, unpublished = false, beforeLeave }: Options) {
  const navigate = useNavigate();
  const [blocked, setBlocked] = useState<{ to: string; reason: LeaveReason } | null>(null);
  const latest = useRef({ state, flush, beforeLeave, unpublished });
  useEffect(() => { latest.current = { state, flush, beforeLeave, unpublished }; });

  useEffect(() => {
    if (state !== 'pending' && state !== 'unsaved') return;
    const onUnload = (e: BeforeUnloadEvent) => {
      latest.current.beforeLeave?.();
      void latest.current.flush();
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [state]);

  useEffect(() => {
    if (state === 'clean') return;
    // Capture phase on document runs before React's root listener, so the
    // router's <Link> never sees a click we hold back.
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      // Links inside the live preview are inert there (a click selects the section).
      if (a.closest('[data-block-id]')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      const to = url.pathname + url.search + url.hash;
      void (async () => {
        const now = latest.current.state;
        if (now === 'pending') {
          if (!(await latest.current.flush())) setBlocked({ to, reason: 'unsaved' });
          else if (latest.current.unpublished) setBlocked({ to, reason: 'unpublished' });
          else navigate(to);
        } else if (now === 'unpublished') setBlocked({ to, reason: 'unpublished' });
        else if (now === 'unsaved') setBlocked({ to, reason: 'unsaved' });
        else navigate(to);
      })();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [state, navigate]);

  return {
    blocked,
    /** The destination held back (kept for callers that only need it). */
    blockedHref: blocked?.to ?? null,
    stay: () => setBlocked(null),
    leave: () => {
      const to = blocked?.to;
      if (blocked?.reason === 'unsaved') latest.current.beforeLeave?.();
      setBlocked(null);
      if (to) navigate(to);
    },
  };
}
