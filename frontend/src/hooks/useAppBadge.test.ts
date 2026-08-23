import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAppBadge } from './useAppBadge';

describe('useAppBadge', () => {
  it('sets and clears the app badge when the API exists', () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { setAppBadge: set, clearAppBadge: clear });
    const { rerender } = renderHook(({ n }) => useAppBadge(n), { initialProps: { n: 3 } });
    expect(set).toHaveBeenCalledWith(3);
    rerender({ n: 0 });
    expect(clear).toHaveBeenCalled();
  });
});
