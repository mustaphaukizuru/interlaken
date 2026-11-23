import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSingleFlight } from './useSingleFlight';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useSingleFlight', () => {
  it('ignores calls while the first one is still running', async () => {
    const { result } = renderHook(() => useSingleFlight());
    let resolve: () => void = () => {};
    const run = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    result.current(run);
    result.current(run);
    result.current(run);
    expect(run).toHaveBeenCalledTimes(1);
    resolve();
    await flush();
    result.current(run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('opens again after a failure and does not leak the rejection', async () => {
    const { result } = renderHook(() => useSingleFlight());
    const run = vi.fn(() => Promise.reject(new Error('boom')));
    result.current(run);
    await flush();
    result.current(run);
    expect(run).toHaveBeenCalledTimes(2);
    await flush();
  });

  it('a synchronous throw does not leave it locked', () => {
    const { result } = renderHook(() => useSingleFlight());
    expect(() => result.current(() => { throw new Error('x'); })).toThrow('x');
    const run = vi.fn();
    result.current(run);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
