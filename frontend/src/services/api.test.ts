import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { api, isPasswordChangeRequired } from './api';
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

  it('sends a FormData body as multipart, not serialised to JSON by the instance default', async () => {
    let seen: { data: unknown; type: unknown } | null = null;
    apiMock.onPost('/accounts/admin/students/import/').reply((config) => {
      seen = { data: config.data, type: config.headers?.['Content-Type'] };
      return [200, {}];
    });
    const fd = new FormData();
    fd.append('dry_run', '1');

    await api.post('/accounts/admin/students/import/', fd);
    expect(seen!.data).toBeInstanceOf(FormData);
    expect(String(seen!.type)).not.toContain('application/json');
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

describe('api 403 password_change_required → «Cree su contraseña»', () => {
  const user = { id: 3, email: 'a@x.mx', first_name: 'A', last_name: 'B', full_name: 'A B', role: 'parent' as const, avatar: '', whatsapp: '' };

  beforeEach(() => {
    useAuthStore.setState({ user, accessToken: 't', isAuthenticated: true });
    apiMock = new MockAdapter(api);
  });

  afterEach(() => apiMock.restore());

  it('flags the account and leaves the request pending (no error toast on the way out)', async () => {
    apiMock.onGet('/cafeteria/balance/').reply(403, { detail: 'Antes de continuar, cree su propia contraseña.', code: 'password_change_required' });
    let settled = false;
    api.get('/cafeteria/balance/').then(() => { settled = true; }, () => { settled = true; });
    await vi.waitFor(() => expect(useAuthStore.getState().user?.password_change_required).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toBe(false);
  });

  it('any other 403 still fails normally', async () => {
    apiMock.onGet('/accounts/admin/staff/').reply(403, { detail: 'No tiene permiso.' });
    await expect(api.get('/accounts/admin/staff/')).rejects.toBeTruthy();
    expect(useAuthStore.getState().user?.password_change_required).toBeUndefined();
  });

  it('isPasswordChangeRequired reads the status and the code', () => {
    expect(isPasswordChangeRequired({ response: { status: 403, data: { code: 'password_change_required' } } })).toBe(true);
    expect(isPasswordChangeRequired({ response: { status: 403, data: { code: 'other' } } })).toBe(false);
    expect(isPasswordChangeRequired({ response: { status: 401, data: { code: 'password_change_required' } } })).toBe(false);
    expect(isPasswordChangeRequired(undefined)).toBe(false);
  });
});
