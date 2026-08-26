import { describe, it, expect } from 'vitest';
import { groupNotifs, notifDestination, type Notif } from './notifications';

const base = (over: Partial<Notif>): Notif => ({
  id: 1, notif_type: 'info', title: 't', message: 'm', is_read: false, created_at: '', ...over,
});

describe('groupNotifs', () => {
  it('buckets by today / this week / older and drops empty groups', () => {
    const now = new Date(2026, 7, 22, 12);
    const iso = (d: Date) => d.toISOString();
    const list = [
      base({ id: 1, created_at: iso(new Date(2026, 7, 22, 8)) }),
      base({ id: 2, created_at: iso(new Date(2026, 7, 19)) }),
      base({ id: 3, created_at: iso(new Date(2026, 6, 1)) }),
    ];
    const groups = groupNotifs(list, now);
    expect(groups.map((g) => [g.label, g.items.map((n) => n.id)])).toEqual([
      ['Hoy', [1]], ['Esta semana', [2]], ['Anteriores', [3]],
    ]);
    expect(groupNotifs([list[0]], now).map((g) => g.label)).toEqual(['Hoy']);
  });
});

describe('notifDestination', () => {
  it('deep-links comunicados first, then by type', () => {
    expect(notifDestination(base({ announcement: 9, notif_type: 'payment' }))).toBe('/portal/comunicados/9');
    expect(notifDestination(base({ notif_type: 'cafeteria' }))).toBe('/portal/cafeteria');
  });

  it('falls back to the notification page so no tap is a dead end', () => {
    // An aviso used to return null: the row clamped its message to two lines
    // and then did nothing at all when pressed.
    expect(notifDestination(base({ id: 42, notif_type: 'info' }))).toBe('/portal/notificaciones/42');
  });
});
