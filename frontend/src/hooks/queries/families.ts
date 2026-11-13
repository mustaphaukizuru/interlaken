import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  familiesApi,
  type FamiliesListParams,
  type FamilyLinkBody,
  type FamilyPlan,
  type FamilyRow,
  type SuggestionsParams,
} from '@/services/familiesApi';
import type { BulkRequest, BulkResult } from '@/services/dataOps';
import { createListHook, useAdminSummary, useBulk, useExport } from './dataOpsHooks';
import { adminKeys, invalidateEntity } from './keys';
import { STUDENTS_ENTITY } from './studentKeys';

/**
 *   ['admin', 'families', 'list', <params>]              the Familias table
 *   ['admin', 'families', 'summary', <params>]           suggestions
 *   ['admin', 'families', 'detail', 'student:<id>']     a student file's Familia tab
 *
 * A change to a family also refreshes the roster and every open student file
 * (their Historial records it, the roster shows the family).
 */
export const FAMILIES_ENTITY = 'families';
const RELATED = [STUDENTS_ENTITY];

export const studentFamilyKey = (studentId: number) => adminKeys.detail(FAMILIES_ENTITY, `student:${studentId}`);

export const useFamiliesList = createListHook<FamilyRow, FamiliesListParams>(FAMILIES_ENTITY, familiesApi.list);
export const useFamiliesExport = () => useExport(FAMILIES_ENTITY, familiesApi.export);
export const useFamiliesBulk = () => useBulk(FAMILIES_ENTITY, familiesApi.bulk, RELATED);

export const useFamilySuggestions = (params: SuggestionsParams, enabled = true) =>
  useAdminSummary(FAMILIES_ENTITY, familiesApi.suggestions, params, { enabled });

export function useStudentFamily(studentId: number) {
  return useQuery({
    queryKey: studentFamilyKey(studentId),
    queryFn: async () => (await familiesApi.studentFamily(studentId)).data,
  });
}

export function useInvalidateFamilies() {
  const qc = useQueryClient();
  return () => invalidateEntity(qc, FAMILIES_ENTITY, RELATED);
}

/** Link / add / merge. A dry run (`dry_run: true`) changes nothing and refreshes nothing. */
export function useFamilyLink() {
  const invalidate = useInvalidateFamilies();
  return useMutation<FamilyPlan, unknown, FamilyLinkBody>({
    mutationFn: async (body) => (await familiesApi.link(body)).data,
    onSuccess: (_plan, body) => {
      if (!body.dry_run) void invalidate();
    },
  });
}

export function useFamilyRemoveStudent() {
  const invalidate = useInvalidateFamilies();
  return useMutation<{ dissolved: boolean }, unknown, { familyId: number; studentId: number }>({
    mutationFn: async ({ familyId, studentId }) => (await familiesApi.removeStudent(familyId, studentId)).data,
    onSuccess: () => void invalidate(),
  });
}

export function useFamilyUpdate() {
  const invalidate = useInvalidateFamilies();
  return useMutation({
    mutationFn: async ({ id, ...body }: { id: number; name?: string; notes?: string }) =>
      (await familiesApi.update(id, body)).data,
    onSuccess: () => void invalidate(),
  });
}

export function useFamilyDissolve() {
  const invalidate = useInvalidateFamilies();
  return useMutation({
    mutationFn: async (id: number) => (await familiesApi.dissolve(id)).data,
    onSuccess: () => void invalidate(),
  });
}

/** Accept or dismiss suggestions with the BulkConfirmDialog contract. */
export function useSuggestionsBulk() {
  const invalidate = useInvalidateFamilies();
  return useMutation<BulkResult, unknown, BulkRequest>({
    mutationFn: async (body) => (await familiesApi.suggestionsBulk(body)).data,
    onSuccess: (_r, body) => {
      if (!body.dry_run) void invalidate();
    },
  });
}

/** One family (the Familias page's detail dialog). */
export function useFamily(id: number | null) {
  return useQuery({
    queryKey: adminKeys.detail(FAMILIES_ENTITY, id ?? 0),
    queryFn: async () => (await familiesApi.get(id as number)).data,
    enabled: id != null,
  });
}
