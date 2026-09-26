import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  bookingsApi,
  type AdminBookingsParams,
  type AdminSlot,
  type AdminSlotsParams,
  type BookingAction,
} from '@/services/api';
import { importFormData, type ImportApi } from '@/services/dataOps';
import type { Booking } from '@/types';
import { createListHook, useBulk, useExport } from './dataOpsHooks';
import { invalidateEntity } from './keys';

/** Query-key entities: a booking move changes slot occupancy and vice versa. */
export const BOOKINGS_ENTITY = 'bookings';
export const SLOTS_ENTITY = 'slots';

/** Ordering keys whitelisted by `/bookings/admin/bookings/` (docs/API-LISTING.md). */
export const BOOKINGS_ORDERING_KEYS = ['date', 'status', 'parent', 'child', 'created_at', 'attendees'] as const;
/** Ordering keys whitelisted by `/bookings/admin/slots/`. */
export const SLOTS_ORDERING_KEYS = ['date', 'start', 'type', 'capacity', 'booked'] as const;

export const useBookingsList = createListHook<Booking, AdminBookingsParams>(BOOKINGS_ENTITY, bookingsApi.getAdminBookings);
export const useSlotsList = createListHook<AdminSlot, AdminSlotsParams>(SLOTS_ENTITY, bookingsApi.getAdminSlots);

export const useBookingsExport = () => useExport(BOOKINGS_ENTITY, bookingsApi.exportBookings);
export const useSlotsExport = () => useExport(SLOTS_ENTITY, bookingsApi.exportSlots);

export const useBookingsBulk = () => useBulk(BOOKINGS_ENTITY, bookingsApi.bulkBookings, [SLOTS_ENTITY]);
export const useSlotsBulk = () => useBulk(SLOTS_ENTITY, bookingsApi.bulkSlots, [BOOKINGS_ENTITY]);

/** One row's status move through the same guard as the bulk endpoint. */
export function useBookingAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, act, note, notify }: { id: number; act: BookingAction; note?: string; notify?: boolean }) =>
      bookingsApi.bookingAction(id, act, { ...(note ? { note } : {}), ...(notify === false ? { notify: false } : {}) }),
    onSuccess: () => invalidateEntity(qc, BOOKINGS_ENTITY, [SLOTS_ENTITY]),
  });
}

/** C4 endpoints of the slot import, for `ImportDialog`. */
export const slotsImportApi: ImportApi = {
  template: (fmt) => bookingsApi.slotsImportTemplate(fmt),
  upload: (file, opts) =>
    bookingsApi.slotsImportUpload(importFormData(file, opts), opts.report ? 'blob' : 'json') as ReturnType<ImportApi['upload']>,
};

/** Toggle `is_active` on one slot (PATCH). */
export function useSlotUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, is_active }: { id: number; is_active: boolean }) => bookingsApi.updateSlot(id, { is_active }),
    onSuccess: () => invalidateEntity(qc, SLOTS_ENTITY),
  });
}

/** Delete one slot; the server refuses a slot with bookings (400 with the reason). */
export function useSlotDelete() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => bookingsApi.deleteSlot(id),
    onSuccess: () => invalidateEntity(qc, SLOTS_ENTITY),
  });
}
