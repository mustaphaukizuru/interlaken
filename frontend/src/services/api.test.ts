import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { api } from './api';
import { useAuthStore } from '@/store/authStore';

// Two mock layers: one on the shared `api` instance (business requests) and one
// on the default axios (the standalone cookie-refresh call in the 401 interceptor).
let apiMock: MockAdapter;
let axiosMock: MockAdapter;

function resetAuth(access: string | null) {
  useAuthStore.setState({ user: null, accessToken: access, isAuthenticated: !!access });
}

describe('api 401 → cookie refresh interceptor', () => {
  beforeEach(() => {
    resetAuth(null);
    apiMock = new MockAdapter(api);
    axiosMock = new MockAdapter(axios);
  });

  afterEach(() => {
    apiMock.restore();
    axiosMock.restore();
  });

  it('silently refreshes on a 401 and retries the original request', async () => {
    resetAuth('stale-token');

    // First hit 401, then succeed on the retry.
    apiMock.onGet('/accounts/me/').replyOnce(401);
    apiMock.onGet('/accounts/me/').reply(200, { id: 1, role: 'parent' });
    // Cookie refresh (no body token) returns a fresh access token.
    axiosMock.onPost(/\/accounts\/token\/refresh\/$/).reply(200, { access: 'fresh-token' });

    const res = await api.get('/accounts/me/');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 1, role: 'parent' });
    // The fresh access token is kept in memory (store), never localStorage.
    expect(useAuthStore.getState().accessToken).toBe('fresh-token');
    expect(localStorage.getItem('access_token')).toBeNull();
  });

  it('attaches the in-memory bearer token to outgoing requests', async () => {
    resetAuth('my-token');
    let seenAuth: string | undefined;
    apiMock.onGet('/accounts/me/').reply((config) => {
      seenAuth = config.headers?.Authorization as string | undefined;
      return [200, {}];
    });

    await api.get('/accounts/me/');
    expect(seenAuth).toBe('Bearer my-token');
  });

  it('propagates non-401 errors without attempting a refresh', async () => {
    apiMock.onGet('/accounts/me/').reply(500);
    let refreshCalled = false;
    axiosMock.onPost(/token\/refresh/).reply(() => {
      refreshCalled = true;
      return [200, { access: 'x' }];
    });

    await expect(api.get('/accounts/me/')).rejects.toBeTruthy();
    expect(refreshCalled).toBe(false);
  });
});
