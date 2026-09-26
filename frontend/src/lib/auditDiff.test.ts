import { describe, expect, it } from 'vitest';
import { auditObjectLink, auditValue, splitChanges } from './auditDiff';

describe('auditDiff', () => {
  it('splits [before, after] pairs from plain details', () => {
    const { diff, details } = splitChanges({ status: ['pending', 'confirmed'], group: ['A', 'A'], reason: 'Pago en caja', bulk: 'confirm' });
    expect(diff).toEqual([
      { field: 'status', before: 'pending', after: 'confirmed', changed: true },
      { field: 'group', before: 'A', after: 'A', changed: false },
    ]);
    expect(details).toEqual([
      { field: 'reason', value: 'Pago en caja' },
      { field: 'bulk', value: 'confirm' },
    ]);
  });

  it('renders empty, boolean and object values', () => {
    expect(auditValue(null)).toBe('—');
    expect(auditValue('')).toBe('—');
    expect(auditValue(true)).toBe('Sí');
    expect(auditValue({ a: 1 })).toBe('{"a":1}');
    expect(splitChanges(null)).toEqual({ diff: [], details: [] });
    expect(splitChanges([1, 2])).toEqual({ diff: [], details: [] });
  });

  it('links known objects to their admin page', () => {
    expect(auditObjectLink('accounts.studentprofile', '12')).toEqual({ to: '/admin/alumnos/12', label: 'Abrir ficha del alumno' });
    expect(auditObjectLink('legal.arcorequest', '3')?.to).toBe('/admin/arco');
    expect(auditObjectLink('export:payments', 'csv')).toBeNull();
  });
});
