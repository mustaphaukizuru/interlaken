import type { BadgeVariant } from './importRow';

/**
 * Visitas status vocabulary (Data Ops C6): one map for the table badges, the
 * status tabs, the bulk dialogs and the row actions. The allowed moves mirror
 * `backend/apps/core/transitions.py` (entity `bookings.booking`), so the UI only
 * offers what the server accepts.
 */
export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'attended' | 'no_show';

export const BOOKING_STATUS_META: Record<BookingStatus, { label: string; tab: string; variant: BadgeVariant }> = {
  pending: { label: 'Pendiente', tab: 'Pendientes', variant: 'warning' },
  confirmed: { label: 'Confirmada', tab: 'Confirmadas', variant: 'success' },
  attended: { label: 'Asistió', tab: 'Asistieron', variant: 'info' },
  no_show: { label: 'No asistió', tab: 'No asistieron', variant: 'error' },
  cancelled: { label: 'Cancelada', tab: 'Canceladas', variant: 'neutral' },
};

export const BOOKING_STATUS_OPTIONS = (Object.keys(BOOKING_STATUS_META) as BookingStatus[]).map((value) => ({
  value,
  label: BOOKING_STATUS_META[value].tab,
}));

export const VISIT_TYPE_LABEL: Record<string, string> = {
  individual: 'Individual',
  open_class: 'Puertas Abiertas',
};

export const VISIT_TYPE_OPTIONS = [
  { value: 'individual', label: 'Visitas individuales' },
  { value: 'open_class', label: 'Puertas Abiertas' },
];

export const BOOKING_SOURCE_OPTIONS = [
  { value: 'web', label: 'Sitio web' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'admin', label: 'Administración' },
];

/** `transitions.py` for `bookings.booking`. */
export const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ['confirmed', 'cancelled', 'no_show', 'attended'],
  confirmed: ['attended', 'no_show', 'cancelled'],
  cancelled: ['pending'],
  attended: ['no_show'],
  no_show: ['attended'],
};

/** Reverse moves need a note (audited with it). */
export function needsNote(from: BookingStatus, to: BookingStatus): boolean {
  return (from === 'cancelled' && to === 'pending')
    || (from === 'attended' && to === 'no_show')
    || (from === 'no_show' && to === 'attended');
}

export function canMove(from: string, to: BookingStatus): boolean {
  return (BOOKING_TRANSITIONS[from as BookingStatus] ?? []).includes(to);
}

export function bookingStatusMeta(status: string) {
  return BOOKING_STATUS_META[status as BookingStatus] ?? { label: status, tab: status, variant: 'neutral' as BadgeVariant };
}
