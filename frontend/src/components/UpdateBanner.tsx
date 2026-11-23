import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RefreshCw, X } from 'lucide-react';

/**
 * «Hay una versión nueva»: shown when a new version of the app is installed
 * while a page is open. It never reloads by itself; it waits while the person
 * is typing in a field, and «Más tarde» hides it (the next page change loads
 * the new version anyway, see lib/appUpdate). Loaded only when needed.
 */
const FIELD = 'input, textarea, select, [contenteditable="true"]';

export function UpdateBanner({ onReload = () => window.location.reload() }: { onReload?: () => void }) {
  const [typing, setTyping] = useState(() => !!document.activeElement?.matches?.(FIELD));
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const check = () => setTyping(!!document.activeElement?.matches?.(FIELD));
    const later = () => window.setTimeout(check, 0);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', later);
    return () => {
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', later);
    };
  }, []);

  if (closed || typing) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-toast mx-auto flex max-w-md items-center gap-3 rounded-md border border-line bg-white p-3 pl-4 text-sm text-ink shadow-raised md:inset-x-auto md:bottom-6 md:left-6 md:top-auto md:mx-0 print:hidden"
    >
      <RefreshCw className="h-5 w-5 flex-shrink-0 text-purple" aria-hidden="true" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Hay una versión nueva.</span>{' '}
        <span className="text-muted">Actualice para usar la más reciente.</span>
      </p>
      <button type="button" onClick={onReload} className="btn-primary min-h-[40px] px-4 py-2">
        Actualizar
      </button>
      <button
        type="button"
        onClick={() => setClosed(true)}
        aria-label="Más tarde"
        title="Más tarde"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm text-muted hover:bg-cream-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

let mounted = false;

/** Mounts the banner once, in its own root (it needs no router or app state). */
export function showUpdateBanner(): void {
  if (mounted) return;
  mounted = true;
  const host = document.createElement('div');
  host.setAttribute('data-update-banner', '');
  document.body.appendChild(host);
  createRoot(host).render(<UpdateBanner />);
}
