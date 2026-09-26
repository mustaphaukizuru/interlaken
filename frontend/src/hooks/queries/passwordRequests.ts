import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { portalApi, type PasswordRequest } from '@/services/api';
import { toPaged, type Paged } from '@/lib/pagination';
import { useBulk, useExport } from './dataOpsHooks';
import { adminKeys } from './keys';

export const PASSWORD_REQUESTS_ENTITY = 'password-requests';

export interface PasswordRequestsListParams {
  page?: number;
  q?: string;
  ordering?: string;
  status?: string;
  channel?: string;
  from?: string;
  to?: string;
  [key: string]: string | number | undefined;
}

/** Ordering keys `/accounts/admin/password-requests/` whitelists. */
export const PASSWORD_REQUESTS_ORDERING_KEYS = ['created_at', 'status', 'requested_email', 'channel', 'resolved_at'] as const;

/** One page of the inbox plus `open_count` (the "Pendientes" badge travels with the page). */
export function usePasswordRequestsList(params: PasswordRequestsListParams) {
  return useQuery<Paged<PasswordRequest> & { open_count: number }>({
    queryKey: adminKeys.list(PASSWORD_REQUESTS_ENTITY, params),
    queryFn: async () => {
      const { data } = await portalApi.getPasswordRequests(params);
      return { ...toPaged<PasswordRequest>(data), open_count: data?.open_count ?? 0 };
    },
    placeholderData: keepPreviousData,
  });
}
export const usePasswordRequestsBulk = () => useBulk(PASSWORD_REQUESTS_ENTITY, portalApi.passwordRequestsBulk);
export const usePasswordRequestsExport = () => useExport(PASSWORD_REQUESTS_ENTITY, portalApi.exportPasswordRequests);
