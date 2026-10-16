import type { QueryClient } from '@tanstack/react-query';
import { adminKeys, invalidateEntity } from './keys';

/**
 * Student query keys, free of API imports so any screen (and its tests) can
 * invalidate the roster without pulling in the list hooks.
 *
 *   ['admin', 'students', 'list', <params>]   the roster
 *   ['admin', 'students', 'detail', <number>] one student file
 */
export const STUDENTS_ENTITY = 'students';

/** Cafetería views a roster change can move (status and Loyverse sync touch
 *  wallets). Same names as CAF_BALANCES / CAF_LOW_BALANCE / CAF_RECONCILE in ./cafeteria. */
export const STUDENTS_RELATED = ['cafeteria-balances', 'cafeteria-low-balance', 'cafeteria-reconcile'];

/** One student file; always keyed by a number (route params arrive as strings). */
export const studentDetailKey = (id: number | string) => adminKeys.detail(STUDENTS_ENTITY, Number(id));

/** Refresh the roster, every open student file and the cafetería views they feed. */
export const invalidateStudents = (qc: QueryClient) => invalidateEntity(qc, STUDENTS_ENTITY, STUDENTS_RELATED);
