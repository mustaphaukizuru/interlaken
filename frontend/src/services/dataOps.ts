/**
 * dataOps.ts — the API contracts of the Data Operations round (C1–C5),
 * typed once so every admin list, export, import and bulk action in the
 * console codes against the same shapes. Re-exported from `services/api.ts`.
 *
 * Backend counterparts: apps/core/listing.py (lists), exporting.py (exports),
 * importing.py (imports), bulk.py (bulk actions).
 */
import type { AxiosResponse } from 'axios';
import type { LucideIcon } from 'lucide-react';

// ── C1: list contract ─────────────────────────────────────────────────────

/** Params every admin list accepts, plus entity filters. */
export interface ListParams {
  q?: string;
  ordering?: string;
  page?: number;
  page_size?: number;
  [filter: string]: string | number | boolean | undefined;
}

/** DRF PageNumberPagination envelope. */
export interface ListResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

// ── C3: export contract ───────────────────────────────────────────────────

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';

export const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  csv: 'CSV',
  xlsx: 'Excel',
  pdf: 'PDF',
};

export const EXPORT_FORMAT_EXT: Record<ExportFormat, string> = {
  csv: 'csv',
  xlsx: 'xlsx',
  pdf: 'pdf',
};

/** `GET .../export/?fmt=&ids=&…same filters, q and ordering as the list`. */
export interface ExportParams extends Omit<ListParams, 'page' | 'page_size'> {
  fmt: ExportFormat;
  /** Selected rows only (≤500), sent as a comma-separated list. */
  ids?: string;
}

/** Comma-join selected keys for `?ids=`; undefined when nothing is selected. */
export function idsParam(ids: Iterable<string | number> | undefined): string | undefined {
  if (!ids) return undefined;
  const list = Array.from(ids);
  return list.length ? list.join(',') : undefined;
}

/** `{prefix}_{YYYY-MM-DD}.{ext}` (local date, so an evening export is stamped with today). */
export function exportFilename(prefix: string, fmt: ExportFormat, now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${prefix}_${y}-${m}-${d}.${EXPORT_FORMAT_EXT[fmt]}`;
}

export type ExportFetcher = (params: ExportParams) => Promise<AxiosResponse<Blob>>;

// ── C4: import contract ───────────────────────────────────────────────────

export type ImportFormat = 'csv' | 'xlsx';

export type ImportRowAction = 'crear' | 'actualizar' | 'omitir' | 'error';

export interface ImportRow {
  /** 1-based line in the uploaded file (header is line 1). */
  line: number;
  /** The dedupe key the server matched on (matrícula, correo, …). */
  key: string;
  action: ImportRowAction;
  errors: string[];
  warnings: string[];
  /** Parsed row as the server understood it. */
  data: Record<string, unknown>;
}

export interface ImportCounts {
  crear: number;
  actualizar: number;
  omitir: number;
  error: number;
}

export interface ImportReport {
  dry_run: boolean;
  total_rows: number;
  counts: ImportCounts;
  rows: ImportRow[];
  /** Present on a commit: the audit summary entry, when the server reports it. */
  audit_id?: number | null;
}

export interface ImportUploadOptions {
  dryRun: boolean;
  /** Ask for the annotated file instead of JSON (stateless error report). */
  report?: ImportFormat;
  /** Commit only rows whose dry-run action is not `error`. */
  validOnly?: boolean;
}

/** The two endpoints an importable entity exposes (C4). */
export interface ImportApi {
  template: (fmt: ImportFormat) => Promise<AxiosResponse<Blob>>;
  upload: (file: File, opts: ImportUploadOptions) => Promise<AxiosResponse<ImportReport | Blob>>;
}

/** Build the multipart body every import endpoint expects. */
export function importFormData(file: File, opts: ImportUploadOptions): FormData {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('dry_run', opts.dryRun ? '1' : '0');
  if (opts.report) fd.append('report', opts.report);
  if (opts.validOnly) fd.append('valid_only', '1');
  return fd;
}

/** Client-side cap, mirrors `ImportSpec.max_bytes` (5 MB). */
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_ACCEPT = '.csv,.xlsx';

export function importFormatOf(file: File): ImportFormat | null {
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.xlsx')) return 'xlsx';
  return null;
}

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1).replace('.0', '');

/** Client-side gate before any upload: extension and size (mirrors the server caps). */
export function validateImportFile(file: File): string | null {
  if (!importFormatOf(file)) return 'Formato no admitido: use un archivo .csv o .xlsx.';
  if (file.size > IMPORT_MAX_BYTES) return `El archivo pesa ${mb(file.size)} MB; el límite es ${mb(IMPORT_MAX_BYTES)} MB.`;
  if (file.size === 0) return 'El archivo está vacío.';
  return null;
}

// ── C5: bulk contract ─────────────────────────────────────────────────────

export interface BulkRequest {
  action: string;
  ids: Array<string | number>;
  all_matching?: boolean;
  filters?: Record<string, string | number | boolean | undefined>;
  payload?: Record<string, unknown>;
  dry_run?: boolean;
}

export interface BulkFailure { id: string | number; error: string }
export interface BulkSkip { id: string | number; reason: string }

/** A row the action will process but the person should know about (e.g. a
 *  student withdrawn while the wallet still holds money). Dry run only. */
export interface BulkWarning { id: string | number; message: string }

export interface BulkResult {
  action: string;
  requested: number;
  ok: number;
  failed: BulkFailure[];
  skipped: BulkSkip[];
  dry_run: boolean;
  warnings?: BulkWarning[];
}

export type BulkFetcher = (body: BulkRequest) => Promise<AxiosResponse<BulkResult>>;

/** Hard caps shared with the backend (bulk.py). */
export const BULK_MAX_IDS = 500;
export const BULK_MAX_MATCHING = 2000;

/** A bulk action as the UI describes it (label, guards, options). */
export interface BulkActionDef {
  name: string;
  label: string;
  /** Coral button + confirmation copy in the danger register. */
  danger?: boolean;
  /** Reverse transitions need a note (audited with it). */
  requiresNote?: boolean;
  /** Show the "Notificar a las familias" checkbox (sent as payload.notify). */
  notifyOption?: boolean;
  /** es-MX verb phrase for the plan: "Se confirmarán", "Se cancelarán". */
  planVerb?: string;
  icon?: LucideIcon;
}
