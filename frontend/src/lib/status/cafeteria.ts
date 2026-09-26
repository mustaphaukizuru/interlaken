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
  completed: { label: 'Completado', variant: 'success' },
  failed: { label: 'Fallido', variant: 'error' },
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

export const options = (map: Record<string, { label: string } | string>) =>
  Object.entries(map).map(([value, m]) => ({ value, label: typeof m === 'string' ? m : m.label }));
