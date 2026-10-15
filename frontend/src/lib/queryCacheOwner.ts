import type { QueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';

/**
 * Cached server data belongs to the user who fetched it.
 *
 * The QueryClient keeps every response for 5 minutes (staleTime) under keys
 * that do not include the user, and nothing cleared it on logout. Logging out
 * and in as someone else in the same tab therefore showed the previous
 * account's balances, history and payment options (a privacy leak on shared
 * computers, and why a test account kept seeing another family's "pago en
 * caja"). Every change of logged-in user (login, logout, idle logout, session
 * expiry, account switch) now empties the cache.
 *
 * Returns the unsubscribe function.
 */
export function bindQueryCacheToUser(queryClient: QueryClient): () => void {
  let owner = useAuthStore.getState().user?.id ?? null;
  return useAuthStore.subscribe((state) => {
    const next = state.user?.id ?? null;
    if (next === owner) return;
    owner = next;
    queryClient.cancelQueries();
    queryClient.clear();
  });
}
