import { useEffect, useRef, useState, type ReactNode } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Maximize2, ScanLine, SquareUserRound, Sun, X } from 'lucide-react';
import { Barcode } from '@/components/ui/Barcode';
import { Badge } from '@/components/ui/Badge';
import { CredentialFace } from '@/components/portal/CredentialFace';
import type { CafeteriaCard } from '@/types';
import { BalanceWithPending, PendingProjectionNote } from '@/components/portal/BalanceWithPending';

/**
 * Digital cafetería card: the student's phone becomes their POS card. The
 * card is drawn as the school's printed student ID (CredentialFace, with the
 * Loyverse code as its Matrícula and Code128 barcode, what the register
 * reads); the live balance sits in the panel beside it. "Pantalla completa"
 * opens a big, bright, scan-ready view (barcode + QR) for the cashier.
 * `footer` goes under the balance (the page's «Saldo actualizado…» line).
 */
export default function StudentCard({ card, footer }: { card: CafeteriaCard; footer?: ReactNode }) {
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
      {/* The card as printed, with the wallet beside it (under it on phones).
          The card itself stays the printed one: the balance lives in the panel. */}
      <div
        data-testid="credencial-face"
        className="mx-auto grid w-full max-w-4xl items-start gap-5 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] md:gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] xl:gap-8 print:block"
      >
        <div className="mx-auto w-full max-w-[20rem] md:max-w-none print:mx-0 print:w-[54mm]">
          <CredentialFace card={card} className="w-full" />
          {card.code && (
            // 48 px: students use this view (Phase 6).
            <button
              type="button"
              onClick={() => setFull(true)}
              className="btn-primary mt-3 min-h-[48px] w-full text-sm print:hidden"
            >
              <Maximize2 size={18} aria-hidden="true" /> Mostrar en pantalla completa
            </button>
          )}
        </div>

        <div className="rounded-md bg-white p-5 shadow-card print:hidden">
          <div className="flex items-start justify-between gap-3">
            <BalanceWithPending
              className="min-w-0"
              balance={card.balance}
              pending={card.pending_topups}
              low={low}
              note={false}
            />
            {low && <Badge variant="warning">Saldo bajo</Badge>}
          </div>
          <PendingProjectionNote
            balance={card.balance}
            pending={card.pending_topups}
            className="mt-1 text-sm leading-snug text-muted"
          />
          {footer && <div className="mt-3">{footer}</div>}
          {!card.code && (
            <p className="mt-3 text-sm text-muted">
              {staff
                ? 'Esta cuenta aún no tiene cafetería. Contacte al colegio para activarla.'
                : 'Este alumno aún no tiene cafetería. Contacte al colegio para activarla.'}
            </p>
          )}
          <ul className="mt-4 space-y-2.5 border-t border-line pt-4 text-[13px] leading-snug text-muted">
            <li className="flex gap-2">
              <ScanLine size={16} className="mt-px flex-shrink-0 text-subtle" aria-hidden="true" />
              <span>En caja escanean el código de barras de la credencial: con «Pantalla completa» se lee mejor.</span>
            </li>
            {!s.photo && (
              <li className="flex gap-2">
                <SquareUserRound size={16} className="mt-px flex-shrink-0 text-subtle" aria-hidden="true" />
                <span>{staff
                  ? 'Sin foto todavía: aparecerá la de su cuenta de Google cuando inicie sesión con ella.'
                  : 'Sin foto todavía: aparecerá la de la cuenta de Google del alumno cuando inicie sesión con ella.'}</span>
              </li>
            )}
          </ul>
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
