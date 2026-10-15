import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Clock, Coffee, CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';

/**
 * Portal → Pagos (bitácora 14/10/2026, punto 10): online payments are not open
 * yet, so the page says «Próximamente» and points to where families pay today.
 * The full payments history (PaymentsPage) returns when online payments go live.
 */
export default function PagosProximamentePage() {
  return (
    <div>
      <PageHeader title="Pagos" />
      <div className="card mx-auto max-w-2xl px-6 py-10 text-center">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-purple/10 text-purple">
          <Clock className="h-7 w-7" aria-hidden="true" />
        </span>
        <span className="mt-4 inline-flex rounded-full bg-amber/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-amber">
          Próximamente
        </span>
        <h2 className="mt-3 font-head text-xl font-bold text-ink">Pagos en línea desde el portal</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">
          Muy pronto podrá realizar y consultar sus pagos aquí. Mientras tanto:
        </p>
        <div className="mx-auto mt-6 grid max-w-md gap-3 text-left">
          <a
            href="https://interlaken.servoescolar.mx/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-[44px] items-center gap-3 rounded-xl2 border border-line bg-white px-4 py-3 transition-colors hover:border-purple/40"
          >
            <CreditCard className="h-5 w-5 shrink-0 text-green-dark" aria-hidden="true" />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-ink">Colegiaturas y boletas</span>
              <span className="block text-xs text-muted">interlaken.servoescolar.mx</span>
            </span>
            <ArrowUpRight className="h-4 w-4 text-muted" aria-hidden="true" />
            <span className="sr-only"> (se abre en otra pestaña)</span>
          </a>
          <Link
            to="/portal/cafeteria"
            className="flex min-h-[44px] items-center gap-3 rounded-xl2 border border-line bg-white px-4 py-3 transition-colors hover:border-purple/40"
          >
            <Coffee className="h-5 w-5 shrink-0 text-green-dark" aria-hidden="true" />
            <span className="flex-1">
              <span className="block text-sm font-semibold text-ink">Cafetería</span>
              <span className="block text-xs text-muted">Saldo, recargas y movimientos</span>
            </span>
            <ArrowRight className="h-4 w-4 text-muted" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </div>
  );
}
