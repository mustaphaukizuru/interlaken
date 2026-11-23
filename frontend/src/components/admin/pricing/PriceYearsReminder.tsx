import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { usePendingCounters } from '@/components/admin/PendingList';
import { cycleLabel } from '@/lib/siteMeta';
import { PRICE_GROUPS, priceYearLabel } from '@/lib/priceYears';
import { usePriceYearsAdmin } from './PriceYearsPanel';

const KEY = 'interlaken.priceReminder';

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function seenToday(): boolean {
  try { return localStorage.getItem(KEY) === todayKey(); } catch { return false; }
}
function markSeen() {
  try { localStorage.setItem(KEY, todayKey()); } catch { /* private mode: it asks again next visit */ }
}

const joinEs = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`);

/**
 * Console reminder (owner, 2026-11-22): from a month before the site moves to
 * the next school cycle, until the administration publishes the new prices,
 * the dashboard asks once a day. The «Pendientes» list keeps the row the rest
 * of the time. Only admins get the counter (Costos y precios is admin-only).
 */
export function PriceYearsReminder() {
  const { data: counters } = usePendingCounters();
  const count = counters?.precios ?? 0;
  const [dismissed, setDismissed] = useState(seenToday);
  const open = count > 0 && !dismissed;
  const admin = usePriceYearsAdmin(open);

  const close = () => { markSeen(); setDismissed(true); };
  if (!open) return null;
  const due = admin.data ? admin.due : counters?.precios_anio ?? new Date().getFullYear();
  const labels = admin.missing.map((g) => PRICE_GROUPS.find((x) => x.key === g)?.label ?? g);
  const live = admin.shown >= due;

  return (
    <Modal open onClose={close} title={`Faltan los precios del ciclo ${cycleLabel(due)}`} maxWidth={460}>
      <div className="space-y-4 text-sm text-ink">
        {admin.isLoading ? (
          <div className="skeleton h-16 rounded-sm" aria-hidden="true" />
        ) : (
          <>
            <p>
              {labels.length ? <><strong>{joinEs(labels)}</strong> {labels.length === 1 ? 'todavía no tiene' : 'todavía no tienen'}</> : 'Faltan'} los precios {due}.
            </p>
            <ul className="space-y-1 text-muted">
              {admin.missing.map((g) => (
                <li key={g}>{PRICE_GROUPS.find((x) => x.key === g)?.label}: {admin.years[g] ? priceYearLabel(admin.years[g]!) : 'sin año'}</li>
              ))}
            </ul>
            <p className="text-muted">
              {live
                ? `La página de Costos ya las muestra como «Precios ${due}: pendientes».`
                : `La página de Costos las mostrará como «pendientes» cuando el sitio pase al ciclo ${cycleLabel(due)}.`}
            </p>
          </>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={close}>Recordar mañana</Button>
          <Link to="/admin/costos" onClick={markSeen} className="btn-primary min-h-[44px]">Ir a Costos y precios</Link>
        </div>
      </div>
    </Modal>
  );
}

export default PriceYearsReminder;
