import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * Unsaved changes ask before leaving: closing or reloading the tab gets the
 * browser's own warning, and a click on a link inside the app is held until
 * the person confirms (`pending` is where they wanted to go). The app uses a
 * plain BrowserRouter (no route blocker), so the back button is not covered.
 */
export function useLeaveGuard(active: boolean) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const onBeforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(url.pathname + url.search + url.hash);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [active]);

  return {
    pending,
    stay: () => setPending(null),
    leave: () => { const to = pending; setPending(null); if (to) navigate(to); },
  };
}
