/**
 * ingresos.ts: «Ingresos de cafetería», money that came in by channel and day
 * (owner 2026-11-27, Caja Part 2; backend `apps/cafeteria/ingresos.py`).
 */
import { api } from '@/services/api';

const BASE = '/cafeteria/admin/ingresos';

export type IngresosChannel = 'portal' | 'desk_cash' | 'desk_card' | 'desk_link' | 'pos';

export interface IngresosRow extends Record<IngresosChannel, string> {
  day: string;
  total: string;
  count: number;
  pending_load: string;
  to_verify: string;
}

export interface IngresosReport {
  start: string;
  end: string;
  channels: { key: IngresosChannel; label: string }[];
  rows: IngresosRow[];
  totals: Omit<IngresosRow, 'day'>;
}

/** `{ month: 'YYYY-MM' }` or `{ from, to }` (YYYY-MM-DD). */
export type IngresosParams = { month: string } | { from: string; to: string };

export const ingresosApi = {
  report: (params: IngresosParams) => api.get<IngresosReport>(`${BASE}/`, { params }),
  export: (params: IngresosParams & { fmt: string }) =>
    api.get<Blob>(`${BASE}/export/`, { params, responseType: 'blob' }),
};
