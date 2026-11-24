import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { enablePush, isPushSubscribed, isPushSupported, pushPermission } from '@/services/push';

/** «Ahora no», remembered in this browser (QA 2026-11-24: it could not be closed). */
const DISMISS_KEY = 'interlaken-push-optin-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * One-tap web-push opt-in. Renders nothing when the browser doesn't support
 * push, no VAPID key is configured, the user already denied permission, this
 * device is already subscribed, or the family closed it («Ahora no») — so it
 * never nags. Disappears after a successful subscription.
 */
export function PushOptIn() {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(readDismissed);
  // Permission already granted: shown only once we know this device has no
  // subscription (a granted, subscribed device used to keep the banner).
  const granted = isPushSupported() && pushPermission() === 'granted';
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  useEffect(() => {
    if (!granted) return;
    let alive = true;
    void isPushSubscribed().then((s) => { if (alive) setSubscribed(s); });
    return () => { alive = false; };
  }, [granted]);

  if (done || dismissed || !isPushSupported() || pushPermission() === 'denied') return null;
  if (granted && subscribed !== false) return null;

  const onClick = async () => {
    setBusy(true);
    try {
      const ok = await enablePush();
      if (ok) {
        toast.success('Notificaciones activadas en este dispositivo.');
        setDone(true);
      } else {
        toast('Permiso no otorgado: puede activarlo después.', { icon: '🔕' });
      }
    } catch {
      toast.error('No se pudieron activar las notificaciones.');
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode or blocked storage: closed for this visit only */
    }
  };

  return (
    <div className="flex items-stretch rounded-md bg-green-50 print:hidden">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="flex min-h-[44px] flex-1 items-center gap-2 rounded-md px-4 py-2.5 text-left text-sm text-ink transition-colors hover:bg-green-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 disabled:opacity-60"
      >
        <BellRing size={20} className="shrink-0 text-green-dark" aria-hidden="true" />
        <span>
          <span className="font-medium">Active los avisos en este dispositivo</span>{' '}
          <span className="text-muted">(cafetería, pagos y comunicados).</span>
        </span>
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Ahora no"
        title="Ahora no"
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-green-100 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
      >
        <X size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
