/**
 * cafeteriaAdmin.ts: the admin Cafetería endpoints on the Data Ops contracts
 * (Phase 6; backend `apps/cafeteria/admin_data.py`, docs/API-LISTING.md).
 *
 * Kept out of `services/api.ts` on purpose: that module is in every public
 * route's entry, and these calls are only ever made from /admin/cafeteria.
 */
import { api } from '@/services/api';
import type { LoyverseCustomer, LoyverseCustomerKind } from '@/services/api';
import { importFormData, type BulkRequest, type BulkResult, type ExportParams, type ImportApi, type ImportReport, type ListParams } from '@/services/dataOps';
import type { BalanceAdjustment, CafeteriaTransaction, ReconcileRow } from '@/types';

const BASE = '/cafeteria/admin';

/** A ledger row as the admin list returns it (student joined). */
export interface AdminTransaction extends Omit<CafeteriaTransaction, 'transaction_type'> {
  transaction_type: 'purchase' | 'topup' | 'refund' | 'adjustment';
  student_name: string;
  student_code: string;
  loyverse_code: string;
  type_display: string;
}

export interface ReconcileRowV2 extends ReconcileRow {
  loyverse_code?: string;
}

/** `/admin/reconcile/`: `total` drives the pager; `count` is the rows returned after `only=drift`. */
export interface ReconcilePage {
  count: number;
  total: number;
  checked: number;
  drift_count: number;
  has_more: boolean;
  offset: number;
  limit: number;
  results: ReconcileRowV2[];
}

export interface CustomerPage {
  count: number;
  summary: Record<LoyverseCustomerKind | 'missing', number>;
  results: LoyverseCustomer[];
}

/** Bulk result of the top-ups `apply` action carries the MXN it credits. */
export interface TopUpBulkResult extends BulkResult {
  total?: string;
}

const blob = (url: string) => (params: ExportParams) => api.get<Blob>(url, { params, responseType: 'blob' });
const bulk = <R extends BulkResult = BulkResult>(url: string) => (body: BulkRequest) => api.post<R>(url, body);

export const cafeteriaAdminApi = {
  // Saldos
  balances: (params: ListParams) => api.get(`${BASE}/balances/`, { params }),
  exportBalances: blob(`${BASE}/balances/export/`),
  bulkBalances: bulk(`${BASE}/balances/bulk/`),

  // Movimientos (every student) + the per-student trail
  transactions: (params: ListParams) => api.get(`${BASE}/transactions/`, { params }),
  exportTransactions: blob(`${BASE}/transactions/export/`),
  adjustments: (params: ListParams) => api.get<{ count: number; results: BalanceAdjustment[] }>(`${BASE}/adjustments/`, { params }),

  // Depósitos + POS queues
  topups: (params: ListParams) => api.get(`${BASE}/topups/`, { params }),
  exportTopups: blob(`${BASE}/topups/export/`),
  bulkTopups: bulk<TopUpBulkResult>(`${BASE}/topups/bulk/`),

  // Saldo bajo, clientes, reconciliación
  lowBalance: (params: ListParams) => api.get(`${BASE}/low-balance/`, { params }),
  exportLowBalance: blob(`${BASE}/low-balance/export/`),
  customers: (params: ListParams) => api.get<CustomerPage>(`${BASE}/customers/`, { params }),
  exportCustomers: blob(`${BASE}/customers/export/`),
  reconcile: (params: ListParams) => api.get<ReconcilePage>(`${BASE}/reconcile/`, { params }),
  exportReconcile: blob(`${BASE}/reconcile/export/`),
  bulkReconcile: bulk(`${BASE}/reconcile/bulk/`),
};

/** Options of the ajuste masivo commit ("Notificar a las familias", "Reflejar en Loyverse"). */
export interface AdjustmentImportFlags {
  notify: boolean;
  mirror: boolean;
}

/** The C4 endpoints of the ajuste masivo, posting the chosen flags with the file. */
export function adjustmentImportApi(flags: AdjustmentImportFlags): ImportApi {
  return {
    template: (fmt) => api.get<Blob>(`${BASE}/balances/import/template/`, { params: { fmt }, responseType: 'blob' }),
    upload: (file, opts) => {
      const body = importFormData(file, opts);
      body.append('notify', flags.notify ? '1' : '0');
      body.append('mirror', flags.mirror ? '1' : '0');
      return api.post<ImportReport | Blob>(`${BASE}/balances/import/`, body, {
        responseType: opts.report ? 'blob' : 'json',
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    },
  };
}
