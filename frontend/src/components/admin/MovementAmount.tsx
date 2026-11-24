import { formatMXN } from '@/lib/format';

/**
 * A ledger row's amount in the console tables. Purchases and top-ups read as
 * before (their type says the direction); an adjustment or a refund shows
 * its direction, «−$12.50» in the debit colour or «+$12.50», like the
 * «Historial de ajustes» (QA 2026-11-24: a «Descontar» looked like a credit).
 * `sign` comes from `movementSign` (lib/status/cafeteria); null = not known.
 */
export function MovementAmount({ type, amount, sign }: { type: string; amount: string; sign: 1 | -1 | null }) {
  if ((type !== 'adjustment' && type !== 'refund') || !sign) return <>{formatMXN(amount)}</>;
  const abs = formatMXN(Math.abs(parseFloat(amount)));
  return sign < 0
    ? <span className="text-coral-600">−{abs}<span className="sr-only"> (descuento)</span></span>
    : <span className="text-green-700">+{abs}<span className="sr-only"> (abono)</span></span>;
}

export default MovementAmount;
