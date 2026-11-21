/**
 * The ficha de inscripción as the API serves it (backend
 * apps/admissions/ficha_schema.py `schema_json` and ficha.py `ficha_payload`).
 * The form renders its steps, labels, options and required rules from the
 * schema: one source for the browser and the server.
 */

export type FieldType =
  | 'text' | 'textarea' | 'email' | 'phone' | 'extension' | 'postal_code' | 'curp' | 'date'
  | 'select' | 'grade' | 'cycle' | 'state' | 'country' | 'number' | 'boolean';

/** `{field, equals}` / `{field, in: [...]}` / `{field, not_in: [...]}`, evaluated like the server. */
export interface Condition {
  field: string;
  equals?: unknown;
  in?: unknown[];
  not_in?: unknown[];
}

export interface FichaField {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  required_if: Condition | null;
  choices: string | null;
  choices_if: Condition | null;
  max_length: number | null;
  help: string;
  default: unknown;
  read_only: boolean;
  medical: boolean;
  unit: string | null;
  min: number | null;
  max: number | null;
  /** Shown when it is required and missing (null: the generic message). */
  message?: string | null;
}

export interface SectionRule { rule: string; fields: string[]; message: string }
export interface GlobalRule { rule: string; sections: string[]; field: string; message: string }

export interface FichaStep {
  key: string;
  title: string;
  description: string;
  patchable: boolean;
  /** registration | guardian (PATCH …/ficha/<key>/) · start (POST register/) · submit (POST …/submit/) */
  target: string;
  skip_if: Condition | null;
  rules: SectionRule[];
  fields: FichaField[];
}

export interface Choice { value: string; label: string; level?: string; key?: string }

export interface FichaSchema {
  version: number;
  public_start_enabled: boolean;
  steps: FichaStep[];
  patch_sections: string[];
  rules: GlobalRule[];
  choices: Record<string, Choice[]>;
  medical_fields: string[];
}

export type Values = Record<string, unknown>;
/** field → message (the first one the server or the form gave). */
export type FieldErrors = Record<string, string>;

export interface Completeness {
  sections: Record<string, { complete: boolean; missing: string[] }>;
  complete: boolean;
}

export interface FichaFirma {
  privacy_accepted_at: string | null;
  privacy_notice_version: string;
  signed_name: string;
  signed_at: string | null;
  consent_photos_media: boolean;
  signed_ip?: string | null;
}

export interface FichaPayload {
  id: number;
  status: string;
  status_label: string;
  ficha_version: number;
  editable: boolean;
  child_name: string;
  level: string;
  level_label: string;
  cycle: string;
  pre_registration: number | null;
  sections: Record<string, Values>;
  medical_masked: boolean;
  firma: FichaFirma;
  completeness: Completeness;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StartResponse {
  id: number;
  session_token: string;
  session_expires_at: string;
  status: string;
  cycle: string;
  pre_registration: number;
  ficha: FichaPayload;
}

export interface SaveResponse {
  section: string;
  data: Values;
  completeness: Completeness;
  status: string;
  ficha_version: number;
  updated_at: string;
}
