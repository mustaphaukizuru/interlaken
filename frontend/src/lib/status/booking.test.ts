import { describe, it, expect } from 'vitest';
import { BOOKING_TRANSITIONS, bookingStatusMeta, canMove, needsNote } from './booking';

describe('booking status vocabulary', () => {
  it('mirrors backend/apps/core/transitions.py for bookings.booking', () => {
    expect(BOOKING_TRANSITIONS).toEqual({
      pending: ['confirmed', 'cancelled', 'no_show', 'attended'],
      confirmed: ['attended', 'no_show', 'cancelled'],
      cancelled: ['pending'],
      attended: ['no_show'],
      no_show: ['attended'],
    });
  });

  it('never re-confirms a cancelled or no-show booking', () => {
    expect(canMove('cancelled', 'confirmed')).toBe(false);
    expect(canMove('no_show', 'confirmed')).toBe(false);
    expect(canMove('pending', 'confirmed')).toBe(true);
    expect(canMove('unknown', 'confirmed')).toBe(false);
  });

  it('reverse moves need a note', () => {
    expect(needsNote('cancelled', 'pending')).toBe(true);
    expect(needsNote('attended', 'no_show')).toBe(true);
    expect(needsNote('no_show', 'attended')).toBe(true);
    expect(needsNote('pending', 'attended')).toBe(false);
  });

  it('falls back to the raw status for an unknown value', () => {
    expect(bookingStatusMeta('confirmed').label).toBe('Confirmada');
    expect(bookingStatusMeta('weird')).toMatchObject({ label: 'weird', variant: 'neutral' });
  });
});
