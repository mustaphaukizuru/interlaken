import { useQuery } from '@tanstack/react-query';
import { coreApi } from '@/services/api';
import type { BadgeKey } from '@/components/layout/navConfig';

/** Live sidebar/tab-bar counters (BACKLOG P1-E3); polled every minute, never throws. */
export function useBadges(): Partial<Record<BadgeKey, number>> {
  const { data } = useQuery({
    queryKey: ['badges'],
    queryFn: async () => (await coreApi.getBadges()).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
  return data ?? {};
}
