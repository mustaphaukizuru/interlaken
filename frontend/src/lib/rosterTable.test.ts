import { describe, expect, it } from 'vitest';
import { nextOrdering, readPrefs, sortIndicator, writePrefs } from './rosterTable';

describe('rosterTable helpers', () => {
  it('cycles ordering none → asc → desc → none', () => {
    expect(nextOrdering('', 'grade')).toBe('grade');
    expect(nextOrdering('grade', 'grade')).toBe('-grade');
    expect(nextOrdering('-grade', 'grade')).toBeNull();
    expect(sortIndicator('-grade', 'grade')).toBe('desc');
    expect(sortIndicator('name', 'grade')).toBeNull();
  });
  it('persists column/density prefs with a safe default', () => {
    localStorage.removeItem('interlaken:roster-prefs');
    expect(readPrefs()).toEqual({ hidden: ['email'], dense: false });
    writePrefs({ hidden: [], dense: true });
    expect(readPrefs()).toEqual({ hidden: [], dense: true });
  });
});
