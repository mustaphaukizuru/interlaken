import type { BadgeVariant } from './importRow';

/** Cafetería label/variant maps (mirror the backend TextChoices). */
export const TX_TYPE: Record<string, { label: string; variant: BadgeVariant }> = {
  purchase: { label: 'Compra', variant: 'neutral' },
  topup: { label: 'Recarga', variant: 'success' },
  refund: { label: 'Devolución', variant: 'info' },
  adjustment: { label: 'Ajuste', variant: 'warning' },
};

export const TOPUP_STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  pending: { label: 'Pendiente', variant: 'warning' },
  paid: { label: 'Pagada · por aplicar', variant: 'info' },
  completed: { label: 'Completado', variant: 'success' },
  failed: { label: 'Fallido', variant: 'error' },
  refunded: { label: 'Devuelta sin aplicar', variant: 'neutral' },
};

export const TOPUP_METHOD: Record<string, string> = {
  office: 'Caja Escolar',
  online: 'Pago en Línea',
};

export const CUSTOMER_KIND: Record<string, { label: string; variant: BadgeVariant }> = {
  student: { label: 'Alumno', variant: 'success' },
  staff: { label: 'Personal', variant: 'info' },
  test: { label: 'Prueba', variant: 'warning' },
  other: { label: 'Otro', variant: 'neutral' },
};

/**
 * The sign a ledger row had on the balance (QA 2026-11-24: a «Descontar»
 * adjustment read like a credit). Purchases debit and top-ups credit; an
 * adjustment or a refund goes either way and its sign lives on its audit row:
 * `adjustment_amount` when the API sends it, else that row in the loaded
 * trail (`trail`: transaction id → signed amount), else the move from the
 * next older row's balance when it equals the amount. null = not known.
 */
export function movementSign(
  t: { id: number; transaction_type: string; amount: string; adjustment_amount?: string | null; balance_after?: string | null },
  hints: { trail?: ReadonlyMap<number, string>; olderBalance?: string | null } = {},
): 1 | -1 | null {
  if (t.transaction_type === 'purchase') return -1;
  if (t.transaction_type === 'topup') return 1;
  const signOf = (v: string | null | undefined): 1 | -1 | null => {
    const n = v == null || v === '' ? NaN : parseFloat(v);
    if (!Number.isFinite(n) || n === 0) return null;
    return n < 0 ? -1 : 1;
  };
  const audited = signOf(t.adjustment_amount) ?? signOf(hints.trail?.get(t.id));
  if (audited) return audited;
  const after = parseFloat(t.balance_after ?? '');
  const before = parseFloat(hints.olderBalance ?? '');
  const amount = Math.abs(parseFloat(t.amount));
  if (Number.isFinite(after) && Number.isFinite(before) && Number.isFinite(amount)
    && after !== before && Math.abs(Math.abs(after - before) - amount) < 0.005) {
    return after < before ? -1 : 1;
  }
  return null;
}

/** A top-up paid with a card (ledger row `topup-payment-<id>`). */
export const isCardTopUp = (t: { transaction_type: string; loyverse_receipt_id?: string | null }) =>
  t.transaction_type === 'topup' && /^topup-payment-\d+$/.test(t.loyverse_receipt_id ?? '');

export const options = (map: Record<string, { label: string } | string>) =>
  Object.entries(map).map(([value, m]) => ({ value, label: typeof m === 'string' ? m : m.label }));
