import { useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Coffee, Maximize2, X, Sun } from 'lucide-react';
import { Barcode } from '@/components/ui/Barcode';
import { Badge } from '@/components/ui/Badge';
import type { CafeteriaCard } from '@/types';
import { BalanceWithPending, PendingProjectionNote } from '@/components/portal/BalanceWithPending';

/**
 * Digital cafetería card — the student's phone becomes their POS card. Shows
 * identity + live balance and the Loyverse customer code as a scannable Code128
 * barcode (what the register reads) plus a QR. "Pantalla completa" opens a big,
 * bright, scan-ready view for the cashier.
 */
export default function StudentCard({ card }: { card: CafeteriaCard }) {
  const [full, setFull] = useState(false);
  const s = card.student;
  // A staff member's own account (tipo «personal») reads as its puesto, with
  // no grade or group: never «Alumno».
  const staff = s.tipo === 'personal';
  // The puesto once the office set one, else «Personal del colegio» (as the
  // account menu does; inline so lib/people stays out of the shared graph).
  const roleLine = staff
    ? (s.puesto && s.puesto !== 'sin_asignar' && s.puesto_label) || 'Personal del colegio'
    : [s.grade, s.group && `Grupo ${s.group}`].filter(Boolean).join(' · ');
  // «Saldo bajo» as on the cafetería page and the dashboard: not while paid
  // top-ups on their way reach the alert level (older APIs: the raw flag).
  const low = card.low_balance_alert ?? card.is_low_balance;

  // Focus management for the full-screen view (same pattern as Modal): move
  // focus to the close button on open, restore it to the opener on close.
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Escape closes the full-screen scan view; body scroll is locked while open.
  useEffect(() => {
    if (!full) return;
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFull(false); return; }
      // Trap Tab inside the overlay: it declares aria-modal, but focus could
      // still walk into the portal behind it, where a screen-reader user has no
      // way of knowing the card is covering the page.
      if (e.key !== 'Tab' || !overlayRef.current) return;
      const focusable = overlayRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
      previouslyFocused.current?.focus?.();
    };
  }, [full]);

  return (
    <>
      {/* Print: black on white with a hairline frame (browsers drop the
          gradient, which would leave white type on white paper). */}
      <div data-testid="credencial-face" className="mx-auto w-full max-w-sm overflow-hidden rounded-md shadow-purple ring-1 ring-black/5 print:ring-black/40">
        {/* Gradient face: the credential's identity (brand, not decoration) */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple via-pink-hot to-pink px-5 pb-5 pt-4 text-white print:bg-none print:[&_*]:!text-black">
          <div className="relative flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-white/85">
              <Coffee size={16} aria-hidden="true" /> Credencial de cafetería
            </span>
            {low && <Badge variant="warning">Saldo bajo</Badge>}
          </div>

          <div className="relative mt-5">
            <p className="font-head text-2xl font-bold leading-tight">{s.name}</p>
            <p className="text-sm text-white/85">{roleLine || 'Alumno'}</p>
          </div>

          {/* flex-wrap: with a paid top-up on its way («$150.00 → $350.00») the
              code moves under the balance on narrow phones instead of squeezing it. */}
          <div className="relative mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
            <BalanceWithPending variant="credential" className="min-w-0" balance={card.balance} pending={card.pending_topups} />
            <div className="ml-auto text-right">
              {/* The code is the Loyverse spelling (ci09932), the same one the POS
                  scans and the office reads on the register: label it as such. */}
              <p className="text-xs font-semibold uppercase tracking-wide text-white/80">Código Loyverse</p>
              <p className="font-head text-base font-bold tracking-wider">{card.code || '—'}</p>
            </div>
          </div>
        </div>

        {/* Scan strip */}
        <div className="bg-white px-5 py-4 text-center">
          {/* The projection's line, on white so it keeps its contrast. */}
          <PendingProjectionNote
            balance={card.balance}
            pending={card.pending_topups}
            className="mb-3 text-sm leading-snug text-muted"
          />
          {card.code ? (
            <>
              <Barcode value={card.code} height={58} className="mx-auto max-w-full" />
              {/* 48 px: students use this view (Phase 6). */}
              <button
                type="button"
                onClick={() => setFull(true)}
                className="mx-auto mt-2 flex min-h-[48px] items-center gap-2 rounded-sm px-4 text-sm font-semibold text-purple transition hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30 print:hidden"
              >
                <Maximize2 size={20} aria-hidden="true" /> Mostrar en pantalla completa
              </button>
            </>
          ) : (
            <p className="py-4 text-sm text-muted">
              {staff
                ? 'Esta cuenta aún no tiene cafetería. Contacte al colegio para activarla.'
                : 'Este alumno aún no tiene cafetería. Contacte al colegio para activarla.'}
            </p>
          )}
        </div>
      </div>

      {/* Full-screen scan view */}
      {full && card.code && (
        <div
          ref={overlayRef}
          className="fixed inset-0 z-overlay flex flex-col items-center justify-center gap-6 bg-white p-[max(1.5rem,env(safe-area-inset-bottom))] print:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Código para escanear en caja"
        >
          {/* Full-size backdrop: tap anywhere to close (a real button = keyboard-accessible). */}
          <button
            type="button"
            onClick={() => setFull(false)}
            aria-label="Cerrar código"
            className="absolute inset-0 cursor-default"
          />
          <button
            ref={closeBtnRef}
            type="button"
            onClick={() => setFull(false)}
            aria-label="Cerrar"
            className="absolute right-4 top-4 z-10 flex h-12 w-12 items-center justify-center rounded-sm text-muted transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
          >
            <X size={24} aria-hidden="true" />
          </button>

          <div className="relative z-10 text-center">
            <p className="font-head text-lg font-bold text-ink">{s.name}</p>
            <p className="text-sm text-muted">{roleLine}</p>
          </div>

          <Barcode value={card.code} height={130} fontSize={22} className="relative z-10 w-full max-w-md" />
          <div className="relative z-10"><QRCodeSVG value={card.code} size={168} level="M" marginSize={2} /></div>

          <p className="relative z-10 flex items-center gap-1.5 text-sm text-muted">
            <Sun size={20} aria-hidden="true" /> Suba el brillo y muestre este código en caja.
          </p>
        </div>
      )}
    </>
  );
}
