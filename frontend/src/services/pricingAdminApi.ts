/**
 * «Costos y precios» console API (backend apps/content/pricing_admin.py).
 * Admin only. A save sends whole tables; the import only reads a workbook.
 */
import { api } from './api';

export type PricingTableKey = 'inscripcion' | 'colegiaturas' | 'seguros' | 'extraescolares' | 'estancia' | 'politicas';

/** One row as the API sends it: amounts are strings with 2 decimals, or null. */
export type PricingRowData = { id: number | null; is_active: boolean } & Record<string, string | number | boolean | null>;

export interface PricingTablePayload { key: PricingTableKey; label: string; rows: PricingRowData[]; version: string }
export interface PricingRowError { row: number; field: string; label: string; message: string; line?: number }

export interface PricingSaveResult {
  tables: Partial<Record<PricingTableKey, PricingTablePayload>>;
  counts: Partial<Record<PricingTableKey, { created: number; updated: number; deleted: number }>>;
}

export interface PricingImportResult {
  tables: Partial<Record<PricingTableKey, { sheet: string; rows: PricingRowData[]; errors: PricingRowError[] }>>;
  ignored_sheets: string[];
}

export const pricingAdminApi = {
  list: () => api.get<{ tables: Record<PricingTableKey, PricingTablePayload> }>('/content/admin/pricing/'),
  save: (tables: Partial<Record<PricingTableKey, { rows: PricingRowData[]; version: string }>>, source: 'editor' | 'import' = 'editor') =>
    api.put<PricingSaveResult>('/content/admin/pricing/', { tables, source }),
  exportXlsx: () => api.get<Blob>('/content/admin/pricing/export/', { responseType: 'blob' }),
  importXlsx: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api.post<PricingImportResult>('/content/admin/pricing/import/', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
};
