/**
 * caja.ts: «Caja», money taken at the front desk (owner 2026-11-27; backend
 * `apps/cafeteria/caja_views.py`). Kept out of `services/api.ts`: only the
 * console's /admin/caja uses it.
 */
import { api } from '@/services/api';

const BASE = '/cafeteria/admin/caja';

export type DeskMethod = 'cash' | 'card' | 'link';

export interface CajaAccount {
  id: number;
  name: string;
  tipo: 'alumno' | 'personal';
  grade: string;
  group: string;
  puesto_label: string;
  student_id: string;
  code: string;
  photo: string;
  balance: string | null;
  linked: boolean;
}

/** `pushed`: in Loyverse and in the wallet; `waiting`: the app retries;
 *  `failed`: the staff were told; `skipped`: the automatic load is off. */
export type CajaState = 'pushed' | 'applied' | 'found' | 'waiting' | 'failed' | 'skipped' | 'voided';

export interface CajaTopUp {
  id: number;
  folio: string;
  student: { id: number; name: string; grade: string; group: string; tipo: string };
  amount: string;
  desk_method: DeskMethod;
  desk_method_label: string;
  reference: string;
  note: string;
  received_by: string;
  created_at: string;
  status: string;
  state: CajaState;
  push_note: string;
  balance: string | null;
  voided_at: string | null;
  voided_by: string;
  void_reason: string;
  needs_verification: boolean;
  verified_at: string | null;
}

export interface CajaOutcome { state: CajaState; reason: string; balance: string | null }

export interface CajaCreateBody {
  student: number;
  amount: string;
  desk_method: DeskMethod;
  reference?: string;
  note?: string;
  idempotency_key: string;
  confirm_duplicate?: boolean;
}

export const cajaApi = {
  lookup: (code: string) => api.get<{ results: CajaAccount[] }>(`${BASE}/lookup/`, { params: { code } }),
  today: (mine?: boolean) => api.get<{ results: CajaTopUp[] }>(`${BASE}/topups/`, { params: mine ? { mine: 1 } : {} }),
  create: (body: CajaCreateBody) =>
    api.post<{ topup: CajaTopUp; outcome: CajaOutcome; created: boolean }>(`${BASE}/topups/`, body),
  get: (id: number | string) =>
    api.get<{ topup: CajaTopUp; details: [string, string][] }>(`${BASE}/topups/${id}/`),
  void: (id: number, reason: string) =>
    api.post<{ result: { state: string; balance: string | null }; topup: CajaTopUp }>(`${BASE}/topups/${id}/void/`, { reason }),
  verify: (id: number) => api.post<{ topup: CajaTopUp }>(`${BASE}/topups/${id}/verify/`, {}),
};

// ── Corte de caja (Part 2) ────────────────────────────────────────────────
export type Money3 = Record<DeskMethod, string | null>;

export interface CorteRow {
  id: number;
  folio: string;
  time: string;
  student: string;
  amount: string;
  desk_method: DeskMethod;
  desk_method_label: string;
  reference: string;
  loaded: boolean;
  voided: boolean;
  void_reason: string;
  voided_by: string;
  needs_verification: boolean;
}

export interface CorteClose {
  id: number;
  closed: boolean;
  closed_at: string | null;
  closed_by: string;
  expected: Money3;
  counted: Money3;
  difference: Money3;
  topups_count: number;
  note: string;
  reopened_at: string | null;
  reopened_by: string;
  reopen_reason: string;
}

export interface CorteSummary {
  day: string;
  user: { id: number; name: string };
  expected: Record<DeskMethod, string>;
  expected_total: string;
  count: number;
  pending_load: { count: number; amount: string };
  topups: CorteRow[];
  voids: CorteRow[];
  duplicates: { first: string; second: string; student: string; amount: string }[];
  close: CorteClose | null;
  is_today: boolean;
}

export interface CortePerson { user: { id: number; name: string }; expected_total: string; count: number; closed: boolean }

export interface CorteCloseBody {
  day: string;
  user?: number;
  counted_cash: string;
  counted_card?: string;
  counted_link?: string;
  note?: string;
}

export const corteApi = {
  get: (params: { day?: string; user?: number } = {}) => api.get<CorteSummary>(`${BASE}/corte/`, { params }),
  people: (day: string) => api.get<{ day: string; people: CortePerson[] }>(`${BASE}/cortes/`, { params: { day } }),
  close: (body: CorteCloseBody) => api.post<CorteSummary>(`${BASE}/corte/close/`, body),
  reopen: (id: number, reason: string) => api.post<CorteSummary>(`${BASE}/corte/${id}/reopen/`, { reason }),
};

/** A key per form submission: a double click never records two top-ups. */
export function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}
