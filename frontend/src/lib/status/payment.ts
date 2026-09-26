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
