import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Coffee, Maximize2, X, Sun } from 'lucide-react';
import { Barcode } from '@/components/ui/Barcode';
import type { CafeteriaCard } from '@/types';

const money = (v: string | number) =>
  Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Digital cafetería card — the student's phone becomes their POS card. Shows
 * identity + live balance and the Loyverse customer code as a scannable Code128
 * barcode (what the register reads) plus a QR. "Pantalla completa" opens a big,
 * bright, scan-ready view for the cashier.
 */
export default function StudentCard({ card }: { card: CafeteriaCard }) {
  const [full, setFull] = useState(false);
  const s = card.student;
  const gradeLine = [s.grade, s.group && `Grupo ${s.group}`].filter(Boolean).join(' · ');

  // Escape closes the full-screen scan view.
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  return (
    <>
      <div className="mx-auto w-full max-w-sm overflow-hidden rounded-xl3 shadow-purple ring-1 ring-black/5">
        {/* Gradient face */}
        <div className="relative overflow-hidden bg-gradient-to-br from-purple via-[#7a1f8f] to-pink px-5 pb-5 pt-4 text-white">
          <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10 blur-xl" />
          <div className="pointer-events-none absolute -bottom-12 -left-6 h-28 w-28 rounded-full bg-white/10 blur-xl" />

          <div className="relative flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-white/85">
              <Coffee className="h-3.5 w-3.5" /> Credencial de cafetería
            </span>
            {card.is_low_balance && (
              <span className="rounded-full bg-amber-300/90 px-2 py-0.5 text-[10.5px] font-bold text-amber-900">
                Saldo bajo
              </span>
            )}
          </div>

          <div className="relative mt-5">
            <p className="font-head text-xl font-bold leading-tight">{s.name}</p>
            <p className="text-[13px] text-white/80">{gradeLine || 'Alumno'}</p>
          </div>

          <div className="relative mt-5 flex items-end justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Saldo</p>
              <p className="font-head text-2xl font-bold leading-none">{money(card.balance)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Matrícula</p>
              <p className="font-head text-base font-bold tracking-wider">{card.code || '—'}</p>
            </div>
          </div>
        </div>

        {/* Scan strip */}
        <div className="bg-white px-5 py-4 text-center">
          {card.code ? (
            <>
              <Barcode value={card.code} height={58} className="mx-auto max-w-full" />
              <button
                type="button"
                onClick={() => setFull(true)}
                className="mx-auto mt-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold text-purple transition hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
              >
                <Maximize2 className="h-3.5 w-3.5" /> Mostrar en pantalla completa
              </button>
            </>
          ) : (
            <p className="py-4 text-[12.5px] text-muted">
              Este alumno aún no está vinculado a cafetería. Contacta al colegio para activarlo.
            </p>
          )}
        </div>
      </div>

      {/* Full-screen scan view */}
      {full && card.code && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-white p-6"
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
            type="button"
            onClick={() => setFull(false)}
            aria-label="Cerrar"
            className="absolute right-4 top-4 z-10 rounded-full p-2 text-ink/60 transition hover:bg-cream focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/30"
          >
            <X className="h-6 w-6" />
          </button>

          <div className="relative z-10 text-center">
            <p className="font-head text-lg font-bold text-ink">{s.name}</p>
            <p className="text-sm text-muted">{gradeLine}</p>
          </div>

          <Barcode value={card.code} height={130} fontSize={22} className="relative z-10 w-full max-w-md" />
          <div className="relative z-10"><QRCodeSVG value={card.code} size={168} level="M" marginSize={2} /></div>

          <p className="relative z-10 flex items-center gap-1.5 text-[12.5px] text-subtle">
            <Sun className="h-4 w-4" /> Sube el brillo y muestra este código en caja.
          </p>
        </div>
      )}
    </>
  );
}
