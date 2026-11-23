import { describe, expect, it, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { bootstrapSession } from './api';
import { useAuthStore } from '@/store/authStore';

/**
 * Reopening the app with no signal (owner, 2026-11-22: the card must open
 * offline): the saved session stays, so the cached card and pages still show.
 * A real answer from the server (expired or revoked) still logs out.
 */
describe('bootstrapSession offline', () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: true, accessToken: null, user: { id: 1, role: 'parent' } as never });
  });

  it('keeps the saved session when the refresh gets no answer at all', async () => {
    const err = Object.assign(new Error('Network Error'), { isAxiosError: true, response: undefined, toJSON: () => ({}) });
    vi.spyOn(axios, 'post').mockRejectedValueOnce(err);
    expect(await bootstrapSession()).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(true);
  });

  it('logs out when the server refuses the refresh', async () => {
    const err = Object.assign(new Error('401'), { isAxiosError: true, response: { status: 401, data: {} }, toJSON: () => ({}) });
    vi.spyOn(axios, 'post').mockRejectedValueOnce(err);
    expect(await bootstrapSession()).toBe(false);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });
});
