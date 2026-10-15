import { describe, it, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bindQueryCacheToUser } from './queryCacheOwner';
import { useAuthStore, type User } from '@/store/authStore';

const user = (id: number) => ({ id, email: `u${id}@x.test`, first_name: 'U', last_name: String(id),
  full_name: `U ${id}`, role: 'parent', avatar: '', whatsapp: '' }) as User;

describe('bindQueryCacheToUser', () => {
  beforeEach(() => useAuthStore.setState({ user: null, accessToken: null, isAuthenticated: false }));

  it('empties the cache when the logged-in user changes, not on a token refresh', () => {
    const qc = new QueryClient();
    useAuthStore.getState().setAuth(user(1), 'a1');
    const unbind = bindQueryCacheToUser(qc);

    qc.setQueryData(['payments-availability'], { online: false });
    useAuthStore.getState().setAccess('a2');               // same user, new token
    expect(qc.getQueryData(['payments-availability'])).toEqual({ online: false });

    useAuthStore.getState().logout();                      // logout
    expect(qc.getQueryData(['payments-availability'])).toBeUndefined();

    qc.setQueryData(['cafeteria-balances'], [{ id: 9 }]);
    useAuthStore.getState().setAuth(user(2), 'b1');        // another family logs in
    expect(qc.getQueryData(['cafeteria-balances'])).toBeUndefined();
    unbind();
  });
});
