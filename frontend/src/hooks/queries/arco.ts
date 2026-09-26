import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { legalApi, type ArcoListParams, type ArcoListResponse } from '@/services/api';
import type { BulkRequest, BulkResult } from '@/services/dataOps';
import { useBulk, useExport } from './dataOpsHooks';
import { adminKeys, invalidateEntity } from './keys';

/** Entity name for query keys and invalidation. */
export const ARCO_ENTITY = 'arco';

export type { ArcoListParams };

/** Ordering keys whitelisted by `/legal/admin/arco/` (docs/API-LISTING.md). */
export const ARCO_ORDERING_KEYS = ['date', 'deadline', 'status', 'type', 'requester'] as const;

/**
 * One page of the ARCO queue. Unlike the generic list hook this keeps the
 * envelope's `overdue_count`, computed server-side over the whole filtered
 * set, so the "vencidas" banner never undercounts on page 1.
 */
export function useArcoList(params: ArcoListParams) {
  return useQuery<ArcoListResponse>({
    queryKey: adminKeys.list(ARCO_ENTITY, params),
    queryFn: async () => {
      const data = (await legalApi.adminListArco(params)).data;
      return { ...data, results: data.results ?? [], count: data.count ?? 0, overdue_count: data.overdue_count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });
}

export const useArcoExport = () => useExport(ARCO_ENTITY, legalApi.adminExportArco);

function useBadgesRefresh() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['badges'] });
}

/** Bulk `in_review` (C5); a committed run refreshes the list and the sidebar badges. */
export function useArcoBulk() {
  const bulk = useBulk(ARCO_ENTITY, legalApi.adminBulkArco);
  const refreshBadges = useBadgesRefresh();
  const run = async (body: BulkRequest): Promise<BulkResult> => {
    const result = await bulk.mutateAsync(body);
    if (!body.dry_run) refreshBadges();
    return result;
  };
  return { run, isPending: bulk.isPending };
}

/** Single-row status change (transition-guarded and audited server-side). */
export function useSetArcoStatus() {
  const qc = useQueryClient();
  const refreshBadges = useBadgesRefresh();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: string; note: string }) =>
      legalApi.adminSetArcoStatus(id, status, note),
    onSuccess: () => {
      void invalidateEntity(qc, ARCO_ENTITY);
      refreshBadges();
    },
  });
}

/** Refresh the queue after an intake. */
export function useInvalidateArco() {
  const qc = useQueryClient();
  const refreshBadges = useBadgesRefresh();
  return () => {
    void invalidateEntity(qc, ARCO_ENTITY);
    refreshBadges();
  };
}
