import type { BadgeVariant } from './importRow';

/**
 * Payment status vocabulary (Data Ops C6): one label/variant map for the admin
 * Pagos console and the family Pagos page. Keys MUST match the backend
 * `Payment.Status` values (`backend/apps/payments/models.py`).
 */
export const PAYMENT_STATUS_META: Record<string, { label: string; variant: BadgeVariant }> = {
  success: { label: 'Completado', variant: 'success' },
  pending: { label: 'Pendiente', variant: 'warning' },
  processing: { label: 'Procesando', variant: 'info' },
  failed: { label: 'Fallido', variant: 'error' },
  refunded: { label: 'Reembolsado', variant: 'neutral' },
};

export const PAYMENT_STATUS_OPTIONS = Object.entries(PAYMENT_STATUS_META).map(([value, m]) => ({ value, label: m.label }));

/**
 * Why a failed payment failed (backend `FAILURE_LABELS`, `failure_reason` on
 * the API): never a bare "Fallido". `family` is the label and help line the
 * family portal shows, phrased for the parent (who never sees MultiCobros).
 */
export const PAYMENT_FAILURE: Record<string, { label: string; variant: BadgeVariant; family: string; help: string }> = {
  cancelled: {
    label: 'Cancelado por el usuario', variant: 'neutral', family: 'Cancelado',
    help: 'Se canceló el pago en la ventana de Banorte antes de completarlo; no se hizo ningún cargo.',
  },
  expired: {
    label: 'Expirado', variant: 'warning', family: 'Expirado',
    help: 'La ventana de pago se cerró sin respuesta de Banorte. Si ve el cargo en su estado de cuenta, avise al colegio: lo revisamos con el banco.',
  },
  superseded: {
    label: 'Reemplazado por otro intento', variant: 'neutral', family: 'Reemplazado por otro intento',
    help: 'Se abrió un nuevo intento de pago y este quedó sin usar. Si ve dos cargos, avise al colegio.',
  },
  declined: {
    label: 'Rechazado por el banco', variant: 'error', family: 'Rechazado por el banco',
    help: 'El banco rechazó el cargo. Puede intentar con otra tarjeta desde Cafetería.',
  },
  card_not_accepted: {
    label: 'Tarjeta no aceptada (American Express)', variant: 'error', family: 'Tarjeta no aceptada',
    help: 'El colegio solo acepta tarjetas Visa y Mastercard; American Express no se acepta. Intente con otra tarjeta desde Cafetería; no se hizo ningún cargo.',
  },
  bank_timeout: {
    label: 'Sin respuesta del banco', variant: 'warning', family: 'Sin respuesta del banco',
    help: 'El banco emisor no respondió a tiempo. Si ve el cargo en su estado de cuenta, avise al colegio: lo revisamos con Banorte.',
  },
  config_error: {
    label: 'Error de configuración', variant: 'error', family: 'Error de configuración',
    help: 'El pago en línea tuvo un problema técnico del colegio; no se hizo ningún cargo. Intente más tarde o recargue en efectivo en la caja de cafetería.',
  },
  not_found: {
    label: 'No aparece en MultiCobros', variant: 'neutral', family: 'No completado',
    help: 'El colegio revisó la operación con el banco y no encontró ningún cargo. Puede intentar de nuevo desde Cafetería.',
  },
};

/** Status label of a payment row: the failure cause when it failed. */
export function paymentStatusMeta(p: { status: string; failure_reason?: string }, audience: 'staff' | 'family' = 'staff') {
  const failure = p.status === 'failed' && p.failure_reason ? PAYMENT_FAILURE[p.failure_reason] : undefined;
  if (failure) return { label: audience === 'family' ? failure.family : failure.label, variant: failure.variant };
  return PAYMENT_STATUS_META[p.status] ?? { label: p.status, variant: 'neutral' as BadgeVariant };
}

/** Gateway labels: Banorte is the only gateway; Global Payments survives on legacy rows. */
export const GATEWAY_LABELS: Record<string, string> = {
  banorte: 'Banorte',
  global_payments: 'Global Payments (retirado)',
};

export const gatewayLabel = (gateway?: string | null) => (gateway ? GATEWAY_LABELS[gateway] ?? gateway : '');
