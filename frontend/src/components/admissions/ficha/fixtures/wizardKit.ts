/**
 * Builders shared by the wizard's tests (FichaWizard.test.tsx,
 * FichaSteps.test.tsx): the server's schema (schema.json, exported from
 * ficha_schema.schema_json), a ficha payload with its completeness map, and
 * synthetic people. The tests mock `@/services/api` themselves.
 */
import schemaJson from './schema.json';
import type { Completeness, FichaPayload, FichaSchema, Values } from '../types';

export const schema = schemaJson as unknown as FichaSchema;

export const CURP = 'LOHA200501MDFRRNA5'; // 2020-05-01 · femenino · Ciudad de México (backend-generated)
export const RID = 7;

export const SECTIONS = ['contacto', 'alumno', 'domicilio', 'salud', 'padre', 'madre', 'emergencia'];

export function blankSection(key: string): Values {
  const step = schema.steps.find((s) => s.key === key)!;
  return Object.fromEntries(step.fields.map((f) => [f.name, f.type === 'boolean' ? false : f.type === 'date' ? null : '']));
}

export function completeness(done: string[] = []): Completeness {
  return {
    sections: Object.fromEntries(SECTIONS.map((k) => [k, { complete: done.includes(k), missing: done.includes(k) ? [] : ['x'] }])),
    complete: done.length === SECTIONS.length,
  };
}

export function payload(sections: Record<string, Values> = {}, done: string[] = ['contacto']): FichaPayload {
  return {
    id: RID, status: 'draft', status_label: 'Borrador', ficha_version: 2, editable: true,
    child_name: 'Ana Sofía López Hernández', level: 'primaria', level_label: 'Primaria', cycle: '2026-2027',
    pre_registration: 3,
    sections: Object.fromEntries(SECTIONS.map((k) => [k, { ...blankSection(k), ...(sections[k] ?? {}) }])),
    medical_masked: false,
    firma: { privacy_accepted_at: null, privacy_notice_version: '', signed_name: '', signed_at: null, consent_photos_media: false },
    completeness: completeness(done),
    submitted_at: null, created_at: '2026-11-20T10:00:00Z', updated_at: '2026-11-20T10:00:00Z',
  };
}

export const CONTACT = {
  contact_name: 'Marta Hernández Gil', contact_email: 'marta.ficha@ejemplo.test', contact_phone: '5511112222', contact_relationship: 'Madre',
};
export const ALUMNO_START = { child_given_names: 'Ana Sofía', child_paternal_surname: 'López', child_maternal_surname: 'Hernández', grade_applying: '1° Primaria', cycle: '2026-2027' };

/** A rejected axios call as the API client throws it. */
export const fail = (status: number, data: unknown) => Promise.reject({ response: { status, data } });
