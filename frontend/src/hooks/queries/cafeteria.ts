import { useQuery, keepPreviousData, type UseQueryOptions } from '@tanstack/react-query';
import { cafeteriaAdminApi, type AdminTransaction, type CustomerPage, type ReconcilePage } from '@/services/cafeteriaAdmin';
import type { ListParams } from '@/services/dataOps';
import type { BalanceAdjustment, CafeteriaBalance, TopUpLogEntry } from '@/types';
import { createListHook, useBulk, useExport } from './dataOpsHooks';
import { adminKeys } from './keys';

/**
 * Admin Cafetería hooks (Data Ops Phase 6). One entity per list so a bulk
 * action or an import refreshes exactly the views it touched; money moves
 * (ajuste masivo, apply, reconcile fix) also refresh the balances views.
 */
export const CAF_BALANCES = 'cafeteria-balances';
export const CAF_TRANSACTIONS = 'cafeteria-transactions';
export const CAF_ADJUSTMENTS = 'cafeteria-adjustments';
export const CAF_TOPUPS = 'cafeteria-topups';
export const CAF_LOW_BALANCE = 'cafeteria-low-balance';
export const CAF_CUSTOMERS = 'cafeteria-customers';
export const CAF_RECONCILE = 'cafeteria-reconcile';

/** Everything that shows a wallet amount: refresh after any money move. */
export const CAF_MONEY_VIEWS = [CAF_BALANCES, CAF_LOW_BALANCE, CAF_TRANSACTIONS, CAF_ADJUSTMENTS, CAF_RECONCILE];

/** Ordering keys the backend whitelists (apps/cafeteria/admin_data.py; test_data_ops pins them). */
export const BALANCE_ORDERING_KEYS = ['student', 'grade', 'balance', 'last_synced', 'threshold'] as const;
export const TRANSACTION_ORDERING_KEYS = ['date', 'amount', 'type', 'balance', 'student'] as const;
export const TOPUP_ORDERING_KEYS = ['created_at', 'amount', 'status', 'method', 'student'] as const;
export const CUSTOMER_ORDERING_KEYS = ['name', 'code', 'kind', 'points', 'visits', 'spent', 'last_visit'] as const;
export const RECONCILE_ORDERING_KEYS = ['student', 'matricula', 'grade', 'local_balance'] as const;

export const useBalancesList = createListHook<CafeteriaBalance, ListParams>(CAF_BALANCES, cafeteriaAdminApi.balances);
export const useTransactionsList = createListHook<AdminTransaction, ListParams>(CAF_TRANSACTIONS, cafeteriaAdminApi.transactions);
export const useAdjustmentsList = createListHook<BalanceAdjustment, ListParams>(CAF_ADJUSTMENTS, cafeteriaAdminApi.adjustments);
export const useTopUpsList = createListHook<TopUpLogEntry, ListParams>(CAF_TOPUPS, cafeteriaAdminApi.topups);
export const useLowBalanceList = createListHook<CafeteriaBalance, ListParams>(CAF_LOW_BALANCE, cafeteriaAdminApi.lowBalance);

/** Customers keep their `summary` next to the page, so they bypass `toPaged`. */
export function useCustomersList(params: ListParams, options: Omit<UseQueryOptions<CustomerPage, unknown, CustomerPage, readonly unknown[]>, 'queryKey' | 'queryFn'> = {}) {
  return useQuery<CustomerPage, unknown, CustomerPage, readonly unknown[]>({
    queryKey: adminKeys.list(CAF_CUSTOMERS, params),
    queryFn: async () => (await cafeteriaAdminApi.customers(params)).data,
    placeholderData: keepPreviousData,
    ...options,
  });
}

/** Reconciliation reads Loyverse live per row: only when the person asks (`enabled`). */
export function useReconcileList(params: ListParams, enabled: boolean) {
  return useQuery<ReconcilePage, unknown, ReconcilePage, readonly unknown[]>({
    queryKey: adminKeys.list(CAF_RECONCILE, params),
    queryFn: async () => (await cafeteriaAdminApi.reconcile(params)).data,
    placeholderData: keepPreviousData,
    enabled,
    staleTime: 60_000,
  });
}

export const useBalancesExport = () => useExport(CAF_BALANCES, cafeteriaAdminApi.exportBalances);
export const useTransactionsExport = () => useExport(CAF_TRANSACTIONS, cafeteriaAdminApi.exportTransactions);
export const useTopUpsExport = () => useExport(CAF_TOPUPS, cafeteriaAdminApi.exportTopups);
export const useLowBalanceExport = () => useExport(CAF_LOW_BALANCE, cafeteriaAdminApi.exportLowBalance);
export const useCustomersExport = () => useExport(CAF_CUSTOMERS, cafeteriaAdminApi.exportCustomers);
export const useReconcileExport = () => useExport(CAF_RECONCILE, cafeteriaAdminApi.exportReconcile);

export const useBalancesBulk = () => useBulk(CAF_BALANCES, cafeteriaAdminApi.bulkBalances, [CAF_LOW_BALANCE]);
export const useTopUpsBulk = () => useBulk(CAF_TOPUPS, cafeteriaAdminApi.bulkTopups, CAF_MONEY_VIEWS);
export const useReconcileBulk = () => useBulk(CAF_RECONCILE, cafeteriaAdminApi.bulkReconcile, CAF_MONEY_VIEWS);
