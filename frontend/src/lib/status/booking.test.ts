import { describe, it, expect } from 'vitest';
import { BOOKING_TRANSITIONS, bookingStatusMeta, canMove, needsNote, visitStarted } from './booking';

describe('booking status vocabulary', () => {
  it('mirrors backend/apps/core/transitions.py for bookings.booking', () => {
    expect(BOOKING_TRANSITIONS).toEqual({
      pending: ['confirmed', 'cancelled', 'no_show', 'attended'],
      confirmed: ['attended', 'no_show', 'cancelled'],
      cancelled: ['pending', 'confirmed'],
      attended: ['no_show', 'confirmed'],
      no_show: ['attended', 'confirmed'],
    });
  });

  it('a cancelled booking returns to «Confirmada» only as «Deshacer cancelación», no note needed (owner 2026-11-26)', () => {
    // The table allows it; the row offers it as its own action (never «Confirmar»),
    // and the server sends it through `uncancel` while the visit is still to come.
    expect(canMove('cancelled', 'confirmed')).toBe(true);
    expect(needsNote('cancelled', 'confirmed')).toBe(false);
    expect(canMove('pending', 'confirmed')).toBe(true);
    expect(canMove('unknown', 'confirmed')).toBe(false);
  });

  it('reverse moves need a note', () => {
    expect(needsNote('cancelled', 'pending')).toBe(true);
    expect(needsNote('attended', 'no_show')).toBe(true);
    expect(needsNote('no_show', 'attended')).toBe(true);
    expect(needsNote('pending', 'attended')).toBe(false);
    expect(needsNote('attended', 'confirmed')).toBe(true);
    expect(needsNote('no_show', 'confirmed')).toBe(true);
  });

  it('a visit has started from its start time in Mexico City, whatever the device zone (QA 2026-11-24)', () => {
    // 15:00 UTC is 09:00 in Mexico City (UTC-6).
    expect(visitStarted('2026-11-26', '09:00:00', new Date('2026-11-26T14:59:00Z'))).toBe(false);
    expect(visitStarted('2026-11-26', '09:00:00', new Date('2026-11-26T15:00:00Z'))).toBe(true);
    expect(visitStarted('2026-11-26', '09:00', new Date('2026-11-27T01:00:00Z'))).toBe(true);
    expect(visitStarted('2026-11-27', '09:00', new Date('2026-11-26T20:00:00Z'))).toBe(false);
    expect(visitStarted(null, '09:00')).toBe(true);
  });

  it('falls back to the raw status for an unknown value', () => {
    expect(bookingStatusMeta('confirmed').label).toBe('Confirmada');
    expect(bookingStatusMeta('weird')).toMatchObject({ label: 'weird', variant: 'neutral' });
  });
});
