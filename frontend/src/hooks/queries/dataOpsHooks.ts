import { keepPreviousData, useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import { toPaged, type Paged } from '@/lib/pagination';
import {
  importFormData,
  type BulkFetcher,
  type BulkRequest,
  type BulkResult,
  type ExportFetcher,
  type ExportParams,
  type ImportApi,
  type ImportFormat,
  type ImportReport,
  type ImportUploadOptions,
} from '@/services/dataOps';
import { adminKeys, invalidateEntity, type AdminEntity } from './keys';

/**
 * Generic hook factories for the admin data layer. Each concrete module
 * (`./audit`, `./payments`, …) binds an entity name to its API functions and
 * exports typed hooks; pages never call `useQuery`/`useMutation` for list
 * data themselves.
 */

type ListFetcher<Params> = (params: Params) => Promise<AxiosResponse<unknown>>;

type ListOptions<Row> = Omit<UseQueryOptions<Paged<Row>, unknown, Paged<Row>, readonly unknown[]>, 'queryKey' | 'queryFn'>;

/** One page of an admin list, keyed `['admin', entity, 'list', params]`, previous page kept while the next loads. */
export function useAdminList<Row, Params extends object>(
  entity: AdminEntity,
  fetcher: ListFetcher<Params>,
  params: Params,
  options: ListOptions<Row> = {},
) {
  return useQuery<Paged<Row>, unknown, Paged<Row>, readonly unknown[]>({
    queryKey: adminKeys.list(entity, params),
    queryFn: async () => toPaged<Row>((await fetcher(params)).data),
    placeholderData: keepPreviousData,
    ...options,
  });
}

/** Bind a list fetcher once: `export const useAuditList = createListHook<AuditLogEntry, AuditParams>('audit', coreApi.getAuditLog)`. */
export function createListHook<Row, Params extends object>(entity: AdminEntity, fetcher: ListFetcher<Params>) {
  return (params: Params, options: ListOptions<Row> = {}) => useAdminList<Row, Params>(entity, fetcher, params, options);
}

/** Aggregates next to a list (summary cards, series); same invalidation scope as the list. */
export function useAdminSummary<Data, Params = void>(
  entity: AdminEntity,
  fetcher: (params: Params) => Promise<AxiosResponse<Data>>,
  params: Params,
  options: Omit<UseQueryOptions<Data, unknown, Data, readonly unknown[]>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<Data, unknown, Data, readonly unknown[]>({
    queryKey: adminKeys.summary(entity, params ?? null),
    queryFn: async () => (await fetcher(params)).data,
    ...options,
  });
}

/**
 * Bulk action mutation (C5). A committed run (not `dry_run`) invalidates the
 * entity and its related entities so every open view refreshes.
 */
export function useBulk(entity: AdminEntity, fetcher: BulkFetcher, related: AdminEntity[] = []) {
  const qc = useQueryClient();
  return useMutation<BulkResult, unknown, BulkRequest>({
    mutationFn: async (body) => (await fetcher(body)).data,
    onSuccess: (_result, body) => {
      if (!body.dry_run) void invalidateEntity(qc, entity, related);
    },
  });
}

/** Export mutation (C3): resolves to the blob; the caller names and downloads it. */
export function useExport(entity: AdminEntity, fetcher: ExportFetcher) {
  return useMutation<Blob, unknown, ExportParams>({
    mutationKey: ['admin', entity, 'export'],
    mutationFn: async (params) => (await fetcher(params)).data,
  });
}

export interface ImportRunInput {
  file: File;
  opts: ImportUploadOptions;
}

/**
 * Import mutations (C4): `dryRun`, `commit`, `report` (annotated file) and the
 * template download. A committed import invalidates the entity.
 */
export function useImport(entity: AdminEntity, api: ImportApi, related: AdminEntity[] = []) {
  const qc = useQueryClient();
  const dryRun = useMutation<ImportReport, unknown, File>({
    mutationFn: async (file) => (await api.upload(file, { dryRun: true })).data as ImportReport,
  });
  const commit = useMutation<ImportReport, unknown, { file: File; validOnly: boolean }>({
    mutationFn: async ({ file, validOnly }) => (await api.upload(file, { dryRun: false, validOnly })).data as ImportReport,
    onSuccess: () => {
      void invalidateEntity(qc, entity, related);
    },
  });
  const report = useMutation<Blob, unknown, { file: File; fmt: ImportFormat }>({
    mutationFn: async ({ file, fmt }) => (await api.upload(file, { dryRun: true, report: fmt })).data as Blob,
  });
  const template = useMutation<Blob, unknown, ImportFormat>({
    mutationFn: async (fmt) => (await api.template(fmt)).data,
  });
  return { dryRun, commit, report, template };
}

/** Bind an axios `api` instance to the C4 endpoints of one entity. */
export function importApiFor(
  post: (url: string, body: FormData, cfg: { responseType?: 'blob' | 'json' }) => Promise<AxiosResponse<unknown>>,
  get: (url: string, cfg: { params: { fmt: ImportFormat }; responseType: 'blob' }) => Promise<AxiosResponse<Blob>>,
  base: string,
): ImportApi {
  const root = base.endsWith('/') ? base : `${base}/`;
  return {
    template: (fmt) => get(`${root}import/template/`, { params: { fmt }, responseType: 'blob' }),
    upload: (file, opts) =>
      post(`${root}import/`, importFormData(file, opts), { responseType: opts.report ? 'blob' : 'json' }) as Promise<
        AxiosResponse<ImportReport | Blob>
      >,
  };
}
