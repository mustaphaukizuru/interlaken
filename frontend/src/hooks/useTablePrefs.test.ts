import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { defaultsKey, LEGACY_DEFAULT_HIDDEN, migrateLegacyRosterPrefs, prefsKey, readTablePrefs, useTablePrefs } from './useTablePrefs';

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

describe('useTablePrefs · new default-hidden columns reach saved prefs', () => {
  it('hides a column that became default-hidden after an old (sidecar-less) save', () => {
    // Saved by an older build: payments then hid only «reference» by default.
    localStorage.setItem(prefsKey('payments'), JSON.stringify({ hidden: ['reference'], density: 'dense', widths: { date: 150 } }));
    const { result } = renderHook(() => useTablePrefs('payments', { defaultHidden: ['reference', 'gateway'] }));
    expect(result.current.hidden).toEqual(['reference', 'gateway']);
    // Everything else the person chose is kept.
    expect(result.current.density).toBe('dense');
    expect(result.current.widths).toEqual({ date: 150 });
  });

  it('keeps a column the person had chosen to show, and their own hidden columns', () => {
    // «reference» was default-hidden and they showed it; they hid «payer» themselves.
    localStorage.setItem(prefsKey('payments'), JSON.stringify({ hidden: ['payer'], density: 'normal', widths: {} }));
    const { result } = renderHook(() => useTablePrefs('payments', { defaultHidden: ['reference', 'gateway'] }));
    expect(result.current.isHidden('reference')).toBe(false);
    expect(result.current.isHidden('payer')).toBe(true);
    expect(result.current.isHidden('gateway')).toBe(true);
  });

  it('records the defaults a save was made against, so showing a new default sticks', () => {
    const { result, unmount } = renderHook(() => useTablePrefs('t2', { defaultHidden: ['a', 'b'] }));
    act(() => result.current.toggleColumn('b'));
    expect(JSON.parse(localStorage.getItem(defaultsKey('t2')) || 'null')).toEqual(['a', 'b']);
    unmount();
    const again = renderHook(() => useTablePrefs('t2', { defaultHidden: ['a', 'b'] }));
    expect(again.result.current.isHidden('b')).toBe(false);
    // A later default («c») still reaches this saved entry.
    const later = renderHook(() => useTablePrefs('t2', { defaultHidden: ['a', 'b', 'c'] }));
    expect(later.result.current.hidden).toEqual(['a', 'c']);
  });

  it('never un-hides a column a saved entry hides, even when it stops being a default', () => {
    localStorage.setItem(prefsKey('t3'), JSON.stringify({ hidden: ['x'], density: 'normal', widths: {} }));
    localStorage.setItem(defaultsKey('t3'), JSON.stringify(['x']));
    const { result } = renderHook(() => useTablePrefs('t3', { defaultHidden: [] }));
    expect(result.current.hidden).toEqual(['x']);
  });

  it('reset also forgets the sidecar', () => {
    const { result } = renderHook(() => useTablePrefs('t4', { defaultHidden: ['x'] }));
    act(() => result.current.toggleDensity());
    expect(localStorage.getItem(defaultsKey('t4'))).not.toBeNull();
    act(() => result.current.reset());
    expect(localStorage.getItem(defaultsKey('t4'))).toBeNull();
  });

  it('knows the pre-review defaults of every table whose defaults the review changed', () => {
    expect(LEGACY_DEFAULT_HIDDEN.payments).toEqual(['reference']);
    expect(LEGACY_DEFAULT_HIDDEN.students).toEqual(['loyverse_code', 'email', 'enrollment_date']);
  });
});
