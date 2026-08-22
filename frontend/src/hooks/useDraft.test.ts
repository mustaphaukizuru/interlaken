import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDraft } from './useDraft';

describe('useDraft', () => {
  it('saves (debounced), restores and clears', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useDraft<{ a: string }>('t'));
    act(() => result.current.save({ a: 'x' }));
    expect(localStorage.getItem('draft:t')).toBeNull();
    act(() => { vi.advanceTimersByTime(500); });
    expect(result.current.load()).toEqual({ a: 'x' });
    act(() => result.current.clear());
    expect(result.current.load()).toBeNull();
    vi.useRealTimers();
  });
  it('expires old drafts', () => {
    localStorage.setItem('draft:old', JSON.stringify({ at: Date.now() - 8 * 86_400_000, data: { a: 1 } }));
    const { result } = renderHook(() => useDraft<{ a: number }>('old'));
    expect(result.current.load()).toBeNull();
  });
});
