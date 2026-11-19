import { useId, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { formatMXN } from '@/lib/format';
import {
  formatCents, projectBalance, projectionSentence, projectionStepLine, projectionSummary,
} from '@/lib/topupApply';
import type { PendingTopUp } from '@/types';

type Pending = ReadonlyArray<Pick<PendingTopUp, 'amount' | 'apply_due_at'>> | null | undefined;

/** Where the balance sits: each place keeps the type it had before. */
export type BalanceVariant = 'card' | 'hero' | 'tile' | 'credential';

const STYLES: Record<BalanceVariant, {
  label: string; figure: string; row: string; projection: string; arrow: string; note: string;
}> = {
  // Cafetería page, one card per child (also «Mi cafetería»).
  card: {
    label: 'text-[11px] font-semibold uppercase tracking-wide text-subtle',
    figure: 'font-head text-2xl font-bold tabular-nums',
    row: '',
    projection: 'font-head text-base font-bold tabular-nums text-green-dark',
    arrow: 'h-4 w-4',
    note: 'mt-1 text-xs leading-snug text-muted',
  },
  // Parent dashboard hero: the selected child's wallet.
  hero: {
    label: 'text-[13px] font-medium text-muted',
    figure: 'font-head text-[clamp(26px,8vw,36px)] font-extrabold leading-[1.1] tracking-[-1px] tabular-nums',
    row: 'mt-1',
    projection: 'font-head text-lg font-bold tabular-nums text-green-dark',
    arrow: 'h-[18px] w-[18px]',
    note: 'mt-1.5 text-[12.5px] leading-snug text-muted',
  },
  // Parent dashboard, one tile per child (families with several).
  tile: {
    label: '',
    figure: 'font-head text-2xl font-extrabold tabular-nums',
    row: 'mt-1',
    projection: 'font-head text-base font-bold tabular-nums text-green-dark',
    arrow: 'h-4 w-4',
    note: 'mt-1 text-xs leading-snug text-muted',
  },
  // The digital credential's gradient face: white type, the projection in a
  // white pill so the success green keeps its contrast (6:1).
  credential: {
    label: 'text-[11px] font-semibold uppercase tracking-wide text-white/70',
    figure: 'font-head text-2xl font-bold leading-none tabular-nums',
    row: '',
    projection: 'rounded-full bg-white px-2 py-0.5 text-sm font-bold tabular-nums text-green-dark',
    arrow: 'h-3.5 w-3.5',
    note: '',
  },
};

const tone = (variant: BalanceVariant, low: boolean) => {
  if (variant === 'credential') return '';
  return low ? 'text-amber' : 'text-ink';
};

/**
 * A wallet balance and, only while paid card top-ups wait for the school's
 * 7:30 load into the POS, where it is heading (owner, 2026-11-19):
 *
 *   SALDO EN CAJA
 *   $150.00 → $350.00
 *   Recarga de $200.00 pagada · disponible mañana a las 7:30 a.m.
 *
 * There is still ONE balance: the hero figure is what the cashier has in
 * Loyverse; the projection is secondary (smaller, success green) and goes
 * away by itself once the top-up is applied, when the figures become one.
 * The arrow is decorative: screen readers get a single sentence instead.
 * With nothing pending the markup is the plain label and figure of before.
 * Display only: no money rule lives here (`projectBalance` only adds).
 */
export function BalanceWithPending({
  balance, pending, variant = 'card', label = 'Saldo', pendingLabel = 'Saldo en caja',
  low = false, note = true, expandable = false, caption, className, now,
}: {
  balance: string | number;
  /** The backend's PAID online top-ups for this student (`pending_topups`). */
  pending?: Pending;
  variant?: BalanceVariant;
  /** Label with nothing pending (null: none, as on the dashboard tiles). */
  label?: string | null;
  /** Label while top-ups are on their way: names the real figure. */
  pendingLabel?: string;
  /** Low-balance colour on the real figure (callers apply the pending rule). */
  low?: boolean;
  /** The short line under the figures; off when the page shows it elsewhere. */
  note?: boolean;
  /** Several load days: a «Ver detalle» toggle lists each one. */
  expandable?: boolean;
  /** Rendered right under the figures (the dashboard's child name). */
  caption?: ReactNode;
  className?: string;
  /** For tests: the clock the date phrases use. */
  now?: Date;
}) {
  const s = STYLES[variant];
  const projection = projectBalance(balance, pending, now);
  const showLabel = label != null && s.label !== '';

  if (!projection) {
    return (
      <div className={className}>
        {showLabel && <p className={s.label}>{label}</p>}
        <p className={`${s.row} ${s.figure} ${tone(variant, low)}`.trim()}>{formatMXN(balance)}</p>
        {caption}
      </div>
    );
  }

  return (
    <div className={className}>
      {showLabel && <p className={s.label} aria-hidden="true">{pendingLabel}</p>}
      <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 ${s.row}`.trim()} aria-hidden="true">
        <span className={`${s.figure} ${tone(variant, low)}`.trim()}>{formatMXN(balance)}</span>
        <span className={`whitespace-nowrap motion-safe:animate-[balance-in_0.18s_ease-out] ${s.projection}`}>
          <ArrowRight className={`mr-1 inline-block align-[-0.15em] ${s.arrow}`} strokeWidth={2.5} aria-hidden="true" />
          {formatCents(projection.total)}
        </span>
      </div>
      <p className="sr-only">{projectionSentence(projection)}</p>
      {caption}
      {note && s.note && (
        <PendingProjectionNote balance={balance} pending={pending} expandable={expandable} className={s.note} now={now} />
      )}
    </div>
  );
}

/**
 * The short muted line of a projection, for pages that place it apart from
 * the figures (the cafetería card puts it full width under the balance row,
 * the credential in its white strip). Nothing when nothing is pending.
 * Without the toggle it repeats the figures' sr-only sentence, so it is
 * hidden from screen readers; with it, the button and the list are read.
 */
export function PendingProjectionNote({ balance, pending, expandable = false, className = 'text-xs leading-snug text-muted', now }: {
  balance: string | number;
  pending?: Pending;
  expandable?: boolean;
  className?: string;
  now?: Date;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const projection = projectBalance(balance, pending, now);
  if (!projection) return null;
  const several = expandable && projection.steps.length > 1;

  return (
    <div className={className}>
      <p aria-hidden="true" className="text-pretty">{projectionSummary(projection)}</p>
      {several && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={listId}
            aria-label={open ? 'Ocultar detalle de las recargas pagadas' : 'Ver detalle de las recargas pagadas'}
            className="-ml-2 inline-flex min-h-[44px] min-w-[44px] items-center gap-1 rounded-lg px-2 text-[12.5px] font-semibold text-purple transition-colors hover:bg-purple/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
          >
            {open ? 'Ocultar detalle' : 'Ver detalle'}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
          <ul id={listId} hidden={!open} className="space-y-1 border-l-2 border-line pl-2.5">
            {projection.steps.map((step) => (
              <li key={step.phrase} className="text-pretty">{projectionStepLine(step)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export default BalanceWithPending;
