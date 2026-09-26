import { paymentsApi, type AdminPaymentsSummary } from '@/services/api';
import type { Payment } from '@/types';
import { createListHook, useAdminSummary, useExport } from './dataOpsHooks';

export const PAYMENTS_ENTITY = 'payments';

export interface PaymentsListParams {
  page?: number;
  q?: string;
  status?: string;
  gateway?: string;
  type?: string;
  student?: string;
  from?: string;
  to?: string;
  ordering?: string;
}

/** Ordering keys whitelisted by `/payments/admin/`. */
export const PAYMENTS_ORDERING_KEYS = ['date', 'amount', 'status', 'gateway', 'student'] as const;

export const usePaymentsList = createListHook<Payment, PaymentsListParams>(PAYMENTS_ENTITY, paymentsApi.adminList);

export const usePaymentsSummary = (days = 30) =>
  useAdminSummary<AdminPaymentsSummary, number>(PAYMENTS_ENTITY, paymentsApi.adminSummary, days);

/** `GET /payments/admin/export/` honouring q, status, gateway, student, dates, ordering and `ids`. */
export const usePaymentsExport = () => useExport(PAYMENTS_ENTITY, paymentsApi.adminExport);
