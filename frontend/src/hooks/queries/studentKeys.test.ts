import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { adminKeys } from './keys';
import { invalidateStudents, STUDENTS_ENTITY, studentDetailKey } from './studentKeys';

describe('student query keys', () => {
  it('detail keys are numeric whether the id comes from a route param or a record', () => {
    expect(studentDetailKey('12')).toEqual(studentDetailKey(12));
    expect(studentDetailKey(12)).toEqual(['admin', 'students', 'detail', 12]);
  });

  it('invalidateStudents refreshes the roster list, the student file and the cafetería balances', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await invalidateStudents(qc);
    const keys = spy.mock.calls.map(([f]) => (f as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(adminKeys.entity(STUDENTS_ENTITY));
    expect(keys).toContainEqual(adminKeys.entity('cafeteria-balances'));
    // The entity prefix matches both the list and the detail queries.
    const list = adminKeys.list(STUDENTS_ENTITY, { page: 1 });
    expect(list.slice(0, 2)).toEqual(adminKeys.entity(STUDENTS_ENTITY));
    expect(studentDetailKey(3).slice(0, 2)).toEqual(adminKeys.entity(STUDENTS_ENTITY));
  });
});
