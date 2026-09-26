import { api, portalApi } from '@/services/api';
import type { StudentProfile } from '@/types';
import { createListHook, importApiFor, useBulk, useExport } from './dataOpsHooks';

/** Entity name for query keys and invalidation. */
export const STUDENTS_ENTITY = 'students';

/** Roster row: the profile plus the wallet balance the admin list annotates. */
export type RosterStudent = StudentProfile & { balance?: string | null };

export interface StudentsListParams {
  page?: number;
  page_size?: number;
  q?: string;
  ordering?: string;
  status?: string;
  access?: string;
  level?: string;
  grade?: string;
  group?: string;
  linked?: string;
  enrolled_from?: string;
  enrolled_to?: string;
  [key: string]: string | number | undefined;
}

/** Ordering keys `/accounts/students/` whitelists (docs/API-LISTING.md). */
export const STUDENTS_ORDERING_KEYS = ['name', 'student_id', 'grade', 'group', 'status', 'last_login', 'enrollment_date', 'balance'] as const;

export const useStudentsList = createListHook<RosterStudent, StudentsListParams>(STUDENTS_ENTITY, portalApi.getStudents);

/** Bulk mutations refresh the roster and every cafetería view (status and sync touch wallets). */
export const useStudentsBulk = () => useBulk(STUDENTS_ENTITY, portalApi.studentsBulk, ['cafeteria']);

export const useStudentsExport = () => useExport(STUDENTS_ENTITY, portalApi.exportStudents);

/** C4 endpoints: `/accounts/admin/students/import/` and `.../import/template/`. */
export const studentsImportApi = importApiFor(
  (url, body, cfg) => api.post(url, body, cfg),
  (url, cfg) => api.get<Blob>(url, cfg),
  '/accounts/admin/students',
);
