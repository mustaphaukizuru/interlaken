import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { api } from './api';

// Two mock layers: one on the shared `api` instance (business requests) and one
// on the default axios (the standalone refresh call inside the 401 interceptor).
let apiMock: MockAdapter;
let axiosMock: MockAdapter;

describe('api 401 → refresh interceptor', () => {
  beforeEach(() => {
    localStorage.clear();
    apiMock = new MockAdapter(api);
    axiosMock = new MockAdapter(axios);
  });

  afterEach(() => {
    apiMock.restore();
    axiosMock.restore();
  });

  it('refreshes the token on a 401 and retries the original request', async () => {
    localStorage.setItem('access_token', 'stale-token');
    localStorage.setItem('refresh_token', 'refresh-token');

    // First hit 401, then succeed on the retry.
    apiMock.onGet('/accounts/me/').replyOnce(401);
    apiMock.onGet('/accounts/me/').reply(200, { id: 1, role: 'parent' });
    axiosMock.onPost(/\/accounts\/token\/refresh\/$/).reply(200, { access: 'fresh-token' });

    const res = await api.get('/accounts/me/');

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 1, role: 'parent' });
    // The new access token is persisted for subsequent requests.
    expect(localStorage.getItem('access_token')).toBe('fresh-token');
  });

  it('attaches the stored bearer token to outgoing requests', async () => {
    localStorage.setItem('access_token', 'my-token');
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
