import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LAST_OPENED_TTL_MS, forgetOpened, lastOpenedScope, peekOpened, rememberOpened } from './lastOpened';

describe('lastOpened (back to the same row)', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('keys the memory by pathname and list', () => {
    expect(lastOpenedScope('students', '/admin/alumnos')).toBe('/admin/alumnos#students');
    expect(lastOpenedScope(undefined, '/admin/alumnos')).toBe('/admin/alumnos#tabla');
    rememberOpened(lastOpenedScope('students', '/admin/alumnos'), 5);
    expect(peekOpened(lastOpenedScope('students', '/admin/alumnos'))).toBe('5');
    expect(peekOpened(lastOpenedScope('families', '/admin/alumnos'))).toBeNull();
    expect(peekOpened(lastOpenedScope('students', '/admin/familias'))).toBeNull();
  });

  it('peeking does not clear; forgetting does, and only for the same row when a key is given', () => {
    const scope = lastOpenedScope('cases', '/admin/admisiones');
    rememberOpened(scope, 'a-7');
    expect(peekOpened(scope)).toBe('a-7');
    expect(peekOpened(scope)).toBe('a-7');
    forgetOpened(scope, 'other');
    expect(peekOpened(scope)).toBe('a-7');
    forgetOpened(scope, 'a-7');
    expect(peekOpened(scope)).toBeNull();
    rememberOpened(scope, 3);
    forgetOpened(scope);
    expect(peekOpened(scope)).toBeNull();
  });

  it('ignores a memory older than half an hour', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-22T10:00:00'));
    const scope = lastOpenedScope('staff', '/admin/personal');
    rememberOpened(scope, 9);
    vi.setSystemTime(Date.now() + LAST_OPENED_TTL_MS - 1000);
    expect(peekOpened(scope)).toBe('9');
    vi.setSystemTime(Date.now() + 2000);
    expect(peekOpened(scope)).toBeNull();
  });

  it('does nothing (and never throws) when storage is unavailable or holds junk', () => {
    const scope = lastOpenedScope('payments', '/admin/pagos');
    sessionStorage.setItem(`interlaken:last-opened:${scope}`, '{not json');
    expect(peekOpened(scope)).toBeNull();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(() => rememberOpened(scope, 1)).not.toThrow();
    expect(peekOpened(scope)).toBeNull();
    expect(() => forgetOpened(scope)).not.toThrow();
  });
});
