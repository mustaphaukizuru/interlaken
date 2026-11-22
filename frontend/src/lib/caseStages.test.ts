import { describe, expect, it } from 'vitest';
import { todayLocal } from './caseStages';

describe('todayLocal (payment date default and max)', () => {
  it('is the school date, not the device date, after 18:00 in Mexico City', () => {
    // 18:53 on 21 Nov in Mexico City is already 22 Nov on UTC: the server
    // (timezone.localdate) still says 21, so «today» must say 21 too.
    expect(todayLocal(new Date('2026-11-22T00:53:00Z'))).toBe('2026-11-21');
  });

  it('turns over at midnight in Mexico City', () => {
    expect(todayLocal(new Date('2026-11-22T05:59:00Z'))).toBe('2026-11-21');
    expect(todayLocal(new Date('2026-11-22T06:00:00Z'))).toBe('2026-11-22');
  });
});
