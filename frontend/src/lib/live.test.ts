import { describe, it, expect } from 'vitest';
import { LIVE, agoLabel } from './live';

describe('LIVE query profile', () => {
  it('polls only while the tab is visible and treats data as fresh briefly', () => {
    expect(LIVE.refetchInterval).toBe(30_000);
    expect(LIVE.refetchIntervalInBackground).toBe(false);
    expect(LIVE.staleTime).toBeLessThanOrEqual(15_000);
    expect(LIVE.refetchOnWindowFocus).toBe(true);
  });
});

describe('agoLabel', () => {
  const now = 1_000_000_000;

  it('is empty until the first successful fetch', () => {
    expect(agoLabel(undefined, now)).toBe('');
    expect(agoLabel(0, now)).toBe('');
  });

  it('rounds the way people read it', () => {
    expect(agoLabel(now - 5_000, now)).toBe('hace un momento');
    expect(agoLabel(now - 44_000, now)).toBe('hace un momento');
    expect(agoLabel(now - 3 * 60_000, now)).toBe('hace 3 min');
    expect(agoLabel(now - 59 * 60_000, now)).toBe('hace 59 min');
    expect(agoLabel(now - 2 * 3_600_000, now)).toBe('hace 2 h');
  });

  it('never goes negative on a clock skew', () => {
    expect(agoLabel(now + 10_000, now)).toBe('hace un momento');
  });
});
