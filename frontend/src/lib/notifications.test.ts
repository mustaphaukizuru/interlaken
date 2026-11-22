import { describe, it, expect } from 'vitest';
import { groupNotifs, isLongMessage, notifDestination, pinUrgent, type Notif } from './notifications';

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
  it('opens comunicado notifications themselves (no comunicados page) and links by type', () => {
    expect(notifDestination(base({ id: 5, announcement: 9, notif_type: 'info' }))).toBe('/portal/notificaciones/5');
    expect(notifDestination(base({ notif_type: 'payment' }))).toBe('/portal/cafeteria');
    expect(notifDestination(base({ notif_type: 'cafeteria' }))).toBe('/portal/cafeteria');
  });

  it('falls back to the notification page so no tap is a dead end', () => {
    // An aviso used to return null: the row clamped its message to two lines
    // and then did nothing at all when pressed.
    expect(notifDestination(base({ id: 42, notif_type: 'info' }))).toBe('/portal/notificaciones/42');
  });
});

describe('notifDestination · long messages', () => {
  it('opens a report longer than its preview in full, even when its type has a page', () => {
    const report = 'Recargas pagadas por cargar (total $550.00):\n\n- Ana · $350.00\n- Beto · $200.00\n\nCárguelas en el POS.';
    expect(notifDestination(base({ id: 8, notif_type: 'cafeteria', message: report }))).toBe('/portal/notificaciones/8');
  });

  it('keeps short alerts going straight to the cafetería', () => {
    const alert = 'El saldo de cafetería de Ana es de $12.50, por debajo del mínimo de $20.00.';
    expect(notifDestination(base({ notif_type: 'cafeteria', message: alert }))).toBe('/portal/cafeteria');
    expect(isLongMessage(alert)).toBe(false);
    expect(isLongMessage('Línea uno\nlínea dos')).toBe(false);
    expect(isLongMessage('Uno.\n\nDos.')).toBe(true);
  });
});

describe('pinUrgent / «Urgentes»', () => {
  it('puts unread urgent alerts first, each part in the server order', () => {
    const list = [
      base({ id: 1 }),
      base({ id: 2, notif_type: 'warning' }),
      base({ id: 3, notif_type: 'warning', is_read: true }),
      base({ id: 4, notif_type: 'warning' }),
    ];
    expect(pinUrgent(list).map((n) => n.id)).toEqual([2, 4, 1, 3]);
  });

  it('groups them in «Urgentes» above the date groups; a read alert goes back to its date', () => {
    const now = new Date(2026, 7, 22, 12);
    const iso = (d: Date) => d.toISOString();
    const groups = groupNotifs([
      base({ id: 1, created_at: iso(new Date(2026, 7, 22, 8)) }),
      base({ id: 2, notif_type: 'warning', created_at: iso(new Date(2026, 6, 1)) }),
      base({ id: 3, notif_type: 'warning', is_read: true, created_at: iso(new Date(2026, 7, 22, 9)) }),
    ], now);
    expect(groups.map((g) => [g.label, g.items.map((n) => n.id)])).toEqual([
      ['Urgentes', [2]], ['Hoy', [1, 3]],
    ]);
  });
});
