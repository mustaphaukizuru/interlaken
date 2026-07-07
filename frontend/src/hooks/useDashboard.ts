import { useQuery } from '@tanstack/react-query';
import { portalApi } from '@/services/api';
import type { DashboardData } from '@/types';

export function useDashboard() {
  return useQuery<DashboardData>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const { data } = await portalApi.getDashboard();
      return data;
    },
    staleTime: 1000 * 60 * 2,
  });
}
