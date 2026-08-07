import { useState } from 'react';
import { BellRing } from 'lucide-react';
import toast from 'react-hot-toast';
import { enablePush, isPushSupported, pushPermission } from '@/services/push';

/**
 * One-tap web-push opt-in. Renders nothing when the browser doesn't support
 * push, no VAPID key is configured, or the user already denied permission —
 * so it never nags. Disappears after a successful subscription.
 */
export function PushOptIn() {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (done || !isPushSupported() || pushPermission() === 'denied') return null;

  const onClick = async () => {
    setBusy(true);
    try {
      const ok = await enablePush();
      if (ok) {
        toast.success('Notificaciones activadas en este dispositivo.');
        setDone(true);
      } else {
        toast('Permiso no otorgado — puede activarlo después.', { icon: '🔕' });
      }
    } catch {
      toast.error('No se pudieron activar las notificaciones.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="flex min-h-[44px] w-full items-center gap-2 rounded-xl2 border border-green/30 bg-green/5 px-4 py-2.5 text-left text-sm text-ink hover:bg-green/10 disabled:opacity-60"
    >
      <BellRing size={16} className="shrink-0 text-green-dark" aria-hidden="true" />
      <span>
        <span className="font-medium">Active las notificaciones</span>{' '}
        — reciba avisos de cafetería, pagos y comunicados en este dispositivo.
      </span>
    </button>
  );
}
