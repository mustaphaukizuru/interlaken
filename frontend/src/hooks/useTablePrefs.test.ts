import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { migrateLegacyRosterPrefs, prefsKey, readTablePrefs, useTablePrefs } from './useTablePrefs';

describe('useTablePrefs', () => {
  it('starts from the defaults and persists changes under interlaken:table:<id>', () => {
    const { result } = renderHook(() => useTablePrefs('payments', { defaultHidden: ['reference'] }));
    expect(result.current.hidden).toEqual(['reference']);
    expect(result.current.density).toBe('normal');
    expect(result.current.dirty).toBe(false);
    expect(result.current.persisted).toBe(true);

    act(() => result.current.toggleColumn('gateway'));
    act(() => result.current.toggleDensity());
    act(() => result.current.setWidth('date', 140.6));

    const stored = JSON.parse(localStorage.getItem(prefsKey('payments')) || 'null');
    expect(stored).toEqual({ hidden: ['reference', 'gateway'], density: 'dense', widths: { date: 141 } });
    expect(result.current.dirty).toBe(true);
    expect(result.current.isHidden('gateway')).toBe(true);
  });

  it('rehydrates on the next mount and ignores junk in storage', () => {
    localStorage.setItem(prefsKey('audit'), JSON.stringify({ hidden: ['detail', 3], density: 'weird', widths: { a: 'x', b: 90 } }));
    const { result } = renderHook(() => useTablePrefs('audit'));
    expect(result.current.hidden).toEqual(['detail']);
    expect(result.current.density).toBe('normal');
    expect(result.current.widths).toEqual({ b: 90 });

    localStorage.setItem(prefsKey('broken'), '{not json');
    expect(readTablePrefs('broken', { hidden: [], density: 'normal', widths: {} })).toEqual({ hidden: [], density: 'normal', widths: {} });
  });

  it('reset restores defaults and forgets the stored entry', () => {
    const { result } = renderHook(() => useTablePrefs('t', { defaultHidden: ['x'] }));
    act(() => result.current.toggleColumn('x'));
    act(() => result.current.setDensity('dense'));
    expect(localStorage.getItem(prefsKey('t'))).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.hidden).toEqual(['x']);
    expect(result.current.density).toBe('normal');
    expect(localStorage.getItem(prefsKey('t'))).toBeNull();
  });

  it('works in memory without a tableId', () => {
    const { result } = renderHook(() => useTablePrefs(undefined));
    act(() => result.current.toggleColumn('a'));
    expect(result.current.hidden).toEqual(['a']);
    expect(result.current.persisted).toBe(false);
    expect(Object.keys(localStorage).filter((k) => k.startsWith('interlaken:table:'))).toEqual([]);
  });

  it('migrates the roster prefs once into interlaken:table:students', () => {
    localStorage.setItem('interlaken:roster-prefs', JSON.stringify({ hidden: ['email'], dense: true }));
    expect(migrateLegacyRosterPrefs()).toBe(true);
    expect(JSON.parse(localStorage.getItem(prefsKey('students')) || 'null')).toEqual({ hidden: ['email'], density: 'dense', widths: {} });
    // Second run is a no-op: the new key wins from now on.
    localStorage.setItem('interlaken:roster-prefs', JSON.stringify({ hidden: [], dense: false }));
    expect(migrateLegacyRosterPrefs()).toBe(false);
    const { result } = renderHook(() => useTablePrefs('students'));
    expect(result.current.hidden).toEqual(['email']);
    expect(result.current.density).toBe('dense');
  });
});
