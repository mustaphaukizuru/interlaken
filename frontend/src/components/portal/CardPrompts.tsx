import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Share, Smartphone, Wallet, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { formatMXN } from '@/lib/format';
import { forgetInstallEvent, installEvent, isIosSafari, runningInstalled } from '@/lib/installPrompt';
import type { CafeteriaCard } from '@/types';

/*
 * The credential page's two pop-ups (owner, 2026-11-22). Never both at once:
 * the low-balance one wins, the install one waits for another visit.
 */

const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* private mode */ } };

/** «Saldo bajo» once a day per card, while the balance is under the school's alert level. */
export function useLowBalancePrompt(card: CafeteriaCard | undefined) {
  const key = card ? `interlaken.lowBalance.${card.student.id}` : '';
  const [closedFor, setClosedFor] = useState<string[]>([]);
  const low = !!card && (card.low_balance_alert ?? card.is_low_balance) && !!card.code && card.linked;
  const open = low && !closedFor.includes(key) && read(key) !== today();
  const close = () => { write(key, today()); setClosedFor((k) => [...k, key]); };
  return { open, close };
}

export function LowBalancePrompt({ card, mine, onClose }: { card: CafeteriaCard; mine: boolean; onClose: () => void }) {
  const first = card.student.name.split(' ')[0];
  const own = mine || card.student.tipo === 'personal';
  const to = own ? '/portal/mi-cafeteria' : `/portal/cafeteria?hijo=${card.student.id}&recarga=200`;
  return (
    <Modal open onClose={onClose} title={own ? 'Su saldo está bajo' : `Saldo bajo de ${first}`} maxWidth={420}>
      <div className="space-y-4 text-sm text-ink">
        <div className="flex items-center gap-3 rounded-md bg-warning-bg px-4 py-3 text-warning">
          <Wallet className="h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <p>Quedan <strong className="font-head text-base tabular-nums">{formatMXN(card.balance)}</strong> en la cafetería.</p>
        </div>
        <p className="text-muted">
          {own
            ? 'Recargue con tarjeta para seguir comprando en la cafetería sin contratiempos.'
            : `Recargue con tarjeta para que ${first} pueda seguir comprando en la cafetería.`}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>Ahora no</Button>
          <Link to={to} onClick={onClose} className="btn-primary min-h-[44px]">{own ? 'Ir a Mi cafetería' : 'Recargar ahora'}</Link>
        </div>
      </div>
    </Modal>
  );
}

/** Shared with the dashboard's InstallHint card: dismissing one dismisses both. */
const INSTALL_KEY = 'pwa-install-hint-dismissed';

/**
 * «Tenga la credencial a un toque»: on a phone or tablet that has not
 * installed the app, once (until «Ahora no» or the install). Chrome/Edge get
 * an «Instalar» button (their own prompt); iPhone Safari gets the two steps.
 */
export function InstallPrompt({ hold = false }: { hold?: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (hold || read(INSTALL_KEY) === '1' || runningInstalled()) return undefined;
    const touch = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (!touch) return undefined;
    const t = window.setTimeout(() => setShow(true), 1500);
    return () => window.clearTimeout(t);
  }, [hold]);
  if (!show || hold) return null;

  const close = () => { write(INSTALL_KEY, '1'); setShow(false); };
  const event = installEvent();
  const ios = isIosSafari();
  const install = async () => {
    if (!event) return;
    await event.prompt();
    // Installed or not, the offer is spent; never ask again here (same key as the dashboard card).
    await event.userChoice.catch(() => undefined);
    forgetInstallEvent();
    write(INSTALL_KEY, '1');
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="install-title"
      className="fixed inset-x-3 bottom-[calc(76px+env(safe-area-inset-bottom))] z-toast mx-auto max-w-md rounded-md border border-line bg-white p-4 shadow-raised lg:bottom-6 print:hidden"
    >
      <button type="button" onClick={close} aria-label="Ahora no" className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-sm text-muted hover:bg-cream hover:text-ink">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
      <div className="flex gap-3 pr-8">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-sm bg-purple-light text-purple">
          <Smartphone className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 text-sm">
          <p id="install-title" className="font-head text-base font-bold text-ink">Tenga la credencial a un toque</p>
          {event ? (
            <p className="mt-0.5 text-muted">Instale el portal en su pantalla de inicio: abre directo y la credencial se ve aunque falle la señal.</p>
          ) : ios ? (
            <p className="mt-0.5 text-muted">
              Toque <Share className="inline h-4 w-4 align-[-2px]" aria-label="Compartir" /> <strong className="text-ink">Compartir</strong> y luego
              <strong className="text-ink"> «Agregar a pantalla de inicio»</strong>.
            </p>
          ) : (
            <p className="mt-0.5 text-muted">Abra el menú del navegador y elija <strong className="text-ink">«Instalar app»</strong> o <strong className="text-ink">«Agregar a pantalla de inicio»</strong>.</p>
          )}
          <div className="mt-3 flex gap-2">
            {event && (
              <Button size="sm" onClick={() => void install()}>
                <Download size={15} aria-hidden="true" /> Instalar
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={close}>{event ? 'Ahora no' : 'Entendido'}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
