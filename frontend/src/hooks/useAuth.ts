import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/services/api';

export function useCurrentUser() {
  const { isAuthenticated, setUser } = useAuthStore();

  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const { data } = await authApi.me();
      setUser(data);
      return data;
    },
    enabled: isAuthenticated,
    staleTime: 1000 * 60 * 10, // 10 min
  });
}
