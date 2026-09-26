/**
 * apiErrors.ts — the one DRF error mapper (Data Ops round, C6).
 *
 * Every API failure the app shows a person goes through here, so the
 * payload shapes the backend emits read the same everywhere:
 *
 *   { detail: "…", code?: "…" }      DRF default (auth, permission, 404, throttle, 413 caps);
 *                                    `code` is a machine code (e.g. `not_invited`)
 *   { field: ["msg"], other: "msg" } serializer field errors
 *   { non_field_errors: ["msg"] }    serializer object-level errors
 *
 * The legacy `{ error: "…" }` body is gone since Data Ops Phase 10 (the backend
 * flag `LEGACY_ERROR_KEY` is off), and so are the two older mappers
 * (`cms/editor/helpers.ts apiErrors`, `StudentFormModal.tsx fieldErrorsFrom`).
 */

export type FieldErrorMap = Record<string, string>;

interface AxiosLikeError {
  response?: { status?: number; data?: unknown };
  code?: string;
  message?: string;
}

/** HTTP status of a failed request, or undefined for network/abort failures. */
export function apiErrorStatus(err: unknown): number | undefined {
  return (err as AxiosLikeError | undefined)?.response?.status;
}

/** True when the server refused the request for exceeding a size/row cap (HTTP 413). */
export function isOverCap(err: unknown): boolean {
  return apiErrorStatus(err) === 413;
}

function payload(err: unknown): Record<string, unknown> | null {
  const data = (err as AxiosLikeError | undefined)?.response?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return data as Record<string, unknown>;
}

function firstString(v: unknown): string {
  if (Array.isArray(v)) return v.length ? firstString(v[0]) : '';
  if (v && typeof v === 'object') {
    // Nested serializer: take the first leaf message.
    const first = Object.values(v as Record<string, unknown>)[0];
    return first === undefined ? '' : firstString(first);
  }
  return v === null || v === undefined ? '' : String(v);
}

/** Machine-readable `code` of a failure body (`{detail, code}`), if any. */
export function apiErrorCode(err: unknown): string | undefined {
  const code = payload(err)?.code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * Flat `{field: message}` map (first message wins per field). `non_field_errors`
 * is exposed under both its own key and `detail` so callers can show it as the
 * headline; the machine `code` is not a field (read it with `apiErrorCode`).
 * Empty when the failure carried no JSON body (network error, HTML 502, …).
 */
export function apiFieldErrors(err: unknown): FieldErrorMap {
  const data = payload(err);
  if (!data) return {};
  const out: FieldErrorMap = {};
  for (const [key, value] of Object.entries(data)) {
    const msg = firstString(value);
    if (!msg) continue;
    if (key === 'code') continue;
    out[key] = msg;
  }
  if (out.non_field_errors && !out.detail) out.detail = out.non_field_errors;
  return out;
}

/** Same map, as a nullable value for forms that distinguish "no field errors" from "network". */
export function fieldErrorsOrNull(err: unknown): FieldErrorMap | null {
  return payload(err) ? apiFieldErrors(err) : null;
}

/**
 * One es-MX sentence for a toast or inline error. Order of preference:
 * server `detail` (this is where the 413 "Acote los filtros…" text
 * arrives), the first field message, a status-based fallback, then `fallback`.
 */
export function apiErrorMessage(err: unknown, fallback = 'No se pudo completar la operación.'): string {
  const fields = apiFieldErrors(err);
  if (fields.detail) return fields.detail;
  const firstField = Object.entries(fields).find(([k]) => k !== 'non_field_errors');
  if (firstField) return firstField[1];
  const status = apiErrorStatus(err);
  if (status === 413) return 'El archivo o la selección supera el límite permitido. Acote los filtros.';
  if (status === 429) return 'Demasiadas solicitudes seguidas. Espere un momento e intente de nuevo.';
  if (status === 403) return 'No tiene permiso para realizar esta acción.';
  if (status === 404) return 'El recurso ya no existe.';
  if (status !== undefined && status >= 500) return 'El servidor no pudo procesar la solicitud. Intente más tarde.';
  const code = (err as AxiosLikeError | undefined)?.code;
  if (code === 'ERR_NETWORK' || code === 'ECONNABORTED') return 'Sin conexión con el servidor. Revise su red e intente de nuevo.';
  return fallback;
}
