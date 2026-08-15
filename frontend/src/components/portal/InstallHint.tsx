import { useEffect, useState } from 'react';
import { Share, Smartphone, X } from 'lucide-react';

/**
 * Dismissible "Agregar a pantalla de inicio" card for the parent portal.
 *
 * Shows from the 2nd portal visit onward (localStorage counter, one count per
 * browser session), never again after dismissal or install, and never inside
 * an already-installed app (display-mode: standalone). On Chromium it defers
 * the captured `beforeinstallprompt` and triggers the native prompt on tap;
 * on iOS (no install prompt API) it shows brief Safari share-sheet
 * instructions under the same visit/dismissal rules.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa-install-hint-dismissed';
const VISITS_KEY = 'pwa-portal-visits';
const SESSION_KEY = 'pwa-portal-visit-counted';
const MIN_VISITS = 2;

// `beforeinstallprompt` usually fires before React mounts the portal — capture
// it at module scope so the card can still offer the native prompt later.
let capturedPrompt: BeforeInstallPromptEvent | null = null;
const subscribers = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    capturedPrompt = e as BeforeInstallPromptEvent;
    subscribers.forEach((fn) => fn());
  });
}

/** Test-only: clear the captured prompt + per-session visit flag. */
export function resetInstallHintStateForTests() {
  capturedPrompt = null;
  sessionStorage.removeItem(SESSION_KEY);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports as MacIntel but is touch-capable.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** One count per browser session; returns the updated total. */
function countVisit(): number {
  const current = parseInt(localStorage.getItem(VISITS_KEY) ?? '0', 10) || 0;
  if (sessionStorage.getItem(SESSION_KEY)) return current;
  sessionStorage.setItem(SESSION_KEY, '1');
  const next = current + 1;
  localStorage.setItem(VISITS_KEY, String(next));
  return next;
}

export function InstallHint() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1',
  );
  // The count `countVisit()` will report, read (not written) up front: stored
  // total plus this session's visit if it hasn't been counted yet. The write
  // itself stays in the mount effect below.
  const [visits] = useState(() => {
    const current = parseInt(localStorage.getItem(VISITS_KEY) ?? '0', 10) || 0;
    return sessionStorage.getItem(SESSION_KEY) ? current : current + 1;
  });
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(capturedPrompt);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    countVisit();
    const sync = () => setPrompt(capturedPrompt);
    subscribers.add(sync);
    const onInstalled = () => {
      localStorage.setItem(DISMISS_KEY, '1');
      setDismissed(true);
    };
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      subscribers.delete(sync);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismissForever = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  if (dismissed || visits < MIN_VISITS || isStandalone()) return null;
  const ios = isIOS();
  if (!ios && !prompt) return null; // Chromium: nothing to offer without the event

  const onInstall = async () => {
    if (!prompt) return;
    setBusy(true);
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      if (outcome === 'accepted') {
        dismissForever(); // `appinstalled` also fires, but don't rely on it
      } else {
        capturedPrompt = null; // the event is spent — hide until it re-fires
        setPrompt(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label="Instalar la aplicación del portal"
      className="relative rounded-xl2 border border-purple/20 bg-purple-light/50 px-4 py-3 text-sm text-ink"
    >
      <button
        type="button"
        onClick={dismissForever}
        aria-label="No volver a mostrar esta sugerencia"
        className="absolute right-1.5 top-1.5 rounded-lg p-2 text-subtle hover:bg-white hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
      >
        <X size={16} aria-hidden="true" />
      </button>
      <div className="flex items-start gap-2 pr-8">
        <Smartphone size={16} className="mt-0.5 shrink-0 text-purple" aria-hidden="true" />
        <div>
          <p className="font-medium">Lleve el portal en su pantalla de inicio</p>
          {ios ? (
            <p className="mt-1 text-muted">
              En Safari: toque{' '}
              <Share size={13} className="-mt-0.5 inline" aria-hidden="true" />{' '}
              <span className="font-medium text-ink">Compartir</span> y elija{' '}
              <span className="font-medium text-ink">“Agregar a pantalla de inicio”</span>.
            </p>
          ) : (
            <>
              <p className="mt-1 text-muted">
                Abra el portal con un toque y a pantalla completa, sin buscarlo en el
                navegador.
              </p>
              <button
                type="button"
                onClick={onInstall}
                disabled={busy}
                className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-xl2 bg-purple px-4 py-2 text-sm font-semibold text-white hover:bg-purple-mid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-60"
              >
                Agregar a pantalla de inicio
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
