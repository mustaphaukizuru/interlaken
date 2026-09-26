import { api, portalApi, type StaffUser } from '@/services/api';
import { createListHook, importApiFor, useBulk, useExport } from './dataOpsHooks';

export const STAFF_ENTITY = 'staff';

export interface StaffListParams {
  page?: number;
  q?: string;
  ordering?: string;
  role?: string;
  active?: string;
  [key: string]: string | number | undefined;
}

/** Ordering keys `/accounts/admin/staff/` whitelists. */
export const STAFF_ORDERING_KEYS = ['name', 'email', 'role', 'is_active', 'last_login', 'date_joined'] as const;

export const useStaffList = createListHook<StaffUser, StaffListParams>(STAFF_ENTITY, portalApi.listStaff);
export const useStaffBulk = () => useBulk(STAFF_ENTITY, portalApi.staffBulk);
export const useStaffExport = () => useExport(STAFF_ENTITY, portalApi.exportStaff);

export const staffImportApi = importApiFor(
  (url, body, cfg) => api.post(url, body, cfg),
  (url, cfg) => api.get<Blob>(url, cfg),
  '/accounts/admin/staff',
);
