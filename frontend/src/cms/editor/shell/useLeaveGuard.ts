import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * - `clean`: nothing to save, leave freely;
 * - `pending`: an autosave is queued or running: save first, then leave;
 * - `unsaved`: the last save failed or is paused by a conflict: ask.
 */
export type LeaveState = 'clean' | 'pending' | 'unsaved';

interface Options {
  state: LeaveState;
  flush: () => Promise<boolean>;
  /** Runs before leaving with unsaved edits (keeps a copy in this browser). */
  beforeLeave?: () => void;
}

/**
 * Warns before leaving the editor with edits that did not reach the server:
 * the browser prompt on reload/close, and an in-app dialog for console links
 * (the app uses <BrowserRouter>, which has no navigation blocker).
 */
export function useLeaveGuard({ state, flush, beforeLeave }: Options) {
  const navigate = useNavigate();
  const [blockedHref, setBlockedHref] = useState<string | null>(null);
  const latest = useRef({ state, flush, beforeLeave });
  useEffect(() => { latest.current = { state, flush, beforeLeave }; });

  useEffect(() => {
    if (state === 'clean') return;
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
        if (latest.current.state === 'pending' && (await latest.current.flush())) navigate(to);
        else setBlockedHref(to);
      })();
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [state, navigate]);

  return {
    blockedHref,
    stay: () => setBlockedHref(null),
    leave: () => {
      const to = blockedHref;
      latest.current.beforeLeave?.();
      setBlockedHref(null);
      if (to) navigate(to);
    },
  };
}
