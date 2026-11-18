import { Link } from 'react-router-dom';
import { formatDistanceStrict } from 'date-fns';
import { es } from 'date-fns/locale';
import { ArrowRight, ShieldAlert } from 'lucide-react';
import { formatMXN } from '@/lib/format';

/** «hace 1 día», «hace 3 horas» since the oldest one was paid. */
function waitedFor(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  if (now.getTime() - when.getTime() < 60_000) return 'hace un momento';
  return formatDistanceStrict(when, now, { addSuffix: true, locale: es });
}

/**
 * «Recargas pendientes de verificar» on the admin dashboard: card top-ups the
 * family already paid that cannot reach the wallet until someone matches them
 * in MultiCobros (2026-11-18: two waited a whole morning in Loyverse). Not
 * rendered at all when there are none.
 */
export function TopUpsToVerifyCard({ count, total, oldest }: { count?: number; total?: string; oldest?: string | null }) {
  if (!count) return null;
  const waited = waitedFor(oldest);
  return (
    <section
      aria-labelledby="topups-to-verify-title"
      className="card mb-4 flex flex-col gap-4 border-amber/40 !p-4 sm:flex-row sm:items-center sm:justify-between sm:!px-5"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-amber/10 text-amber">
          <ShieldAlert className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="topups-to-verify-title" className="font-head text-[15px] font-bold text-ink">
            Recargas pendientes de verificar
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Pagadas con tarjeta. No llegan al saldo hasta verificarlas en MultiCobros.
          </p>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink">
            <span><strong className="font-head text-xl">{count}</strong> recarga{count === 1 ? '' : 's'}</span>
            <span>Total <strong>{formatMXN(total ?? 0)}</strong></span>
            {waited && <span className="text-muted">La más antigua: {waited}</span>}
          </p>
        </div>
      </div>
      <Link to="/admin/cafeteria?tab=pos" className="btn-primary min-h-[44px] flex-shrink-0 self-start sm:self-center">
        Verificar ahora <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

export default TopUpsToVerifyCard;
