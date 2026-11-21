/**
 * Choices and rules of the ficha, read from the schema the server sends
 * (ficha_schema.py). Mirrors of `condition_met`, `is_blank`, `section_missing`
 * and `global_missing`, so the form can name what is missing before it asks
 * the server, and in the same words.
 */
import { ageOnDec31, requiredAge } from '@/lib/eligibility';
import type { Choice, Condition, FichaField, FichaSchema, FichaStep, FieldErrors, Values } from './types';

export function conditionMet(cond: Condition | null | undefined, values: Values): boolean {
  if (!cond) return false;
  const value = values[cond.field];
  if ('equals' in cond) return value === cond.equals;
  if (cond.in) return cond.in.includes(value ?? '');
  if (cond.not_in) return !cond.not_in.includes(value ?? '');
  return !!value;
}

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return true;
  if (typeof value === 'string') return !value.trim();
  return false;
}

export function isRequired(field: FichaField, values: Values): boolean {
  if (field.read_only) return false;
  if (field.required) return true;
  return !!field.required_if && conditionMet(field.required_if, values);
}

/** DOM id of a field (the error summary links to it). */
export const fieldId = (section: string, name: string) => `ficha-${section}-${name}`;

/** Fields shown only while their own condition holds («¿Cuáles?» alergias, «¿Cuál ocupación?»). */
export const CONDITIONAL_FIELDS: ReadonlySet<string> = new Set(['allergies', 'occupation_other']);

/** True when a conditional field is not asked right now. */
export function isHidden(field: FichaField, values: Values): boolean {
  return CONDITIONAL_FIELDS.has(field.name) && !!field.required_if && !conditionMet(field.required_if, values);
}

export const stepField = (step: FichaStep | undefined, name: string): FichaField | undefined =>
  step?.fields.find((f) => f.name === name);

/** The options of a field (`ciclo`, `estados`, `ocupacion`…); empty when it has none. */
export function choicesFor(schema: FichaSchema, field: FichaField | undefined): Choice[] {
  if (!field?.choices) return [];
  return schema.choices[field.choices] ?? [];
}

export function choiceLabel(schema: FichaSchema, field: FichaField | undefined, value: unknown): string {
  const hit = choicesFor(schema, field).find((o) => o.value === value);
  return hit ? hit.label : String(value ?? '');
}

/** Lowercase, accents removed, single spaces (validators.fold_text). */
export function foldText(text: string): string {
  return String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** 'Primaria 1°', '1 primaria' → '1° Primaria'; 'maternal' → 'Maternal' (ficha_schema.normalize_grade). */
export function normalizeGrade(text: string, grades: Choice[]): string | null {
  const folded = foldText(text);
  if (!folded) return null;
  if (folded.includes('maternal')) return 'Maternal';
  const n = /([1-6])/.exec(folded)?.[1];
  for (const level of ['preescolar', 'primaria', 'secundaria']) {
    if (folded.includes(level) && n) {
      const candidate = `${n}° ${level[0].toUpperCase()}${level.slice(1)}`;
      if (grades.some((g) => g.value === candidate)) return candidate;
    }
  }
  return null;
}

/** Fields the family can type into (the computed «Nivel» is shown, never sent). */
export const editableFields = (step: FichaStep): FichaField[] => step.fields.filter((f) => !f.read_only);

/**
 * The values a step starts with: what is stored, the schema defaults for
 * blanks (México as the country) and, for the grade, the canonical spelling
 * of an old one («Primaria 2°» from a pre-registro).
 */
export function initialValues(schema: FichaSchema, step: FichaStep, stored: Values | undefined): Values {
  const out: Values = { ...(stored ?? {}) };
  for (const f of step.fields) {
    const stored = out[f.name];
    if (f.type === 'boolean') {
      out[f.name] = stored === true || ((stored === undefined || stored === null) && f.default === true);
      continue;
    }
    let v = stored === undefined || stored === null ? '' : stored;
    if (isBlank(v) && typeof f.default === 'string') v = f.default;
    if (f.type === 'grade' && typeof v === 'string' && v) {
      const grades = choicesFor(schema, f);
      if (!grades.some((g) => g.value === v)) v = normalizeGrade(v, grades) ?? v;
    }
    out[f.name] = v;
  }
  return out;
}

/** What a step sends: its editable fields, nothing else. */
export function bodyFor(step: FichaStep, values: Values): Values {
  return Object.fromEntries(editableFields(step).map((f) => [f.name, values[f.name] ?? (f.type === 'boolean' ? false : '')]));
}

/** `{field: message}` for what a step still needs (format aside), like `section_missing`. */
export function sectionMissing(step: FichaStep, values: Values, requiredMsg: string): FieldErrors {
  if (step.skip_if && conditionMet(step.skip_if, values)) return {};
  const out: FieldErrors = {};
  for (const f of step.fields) {
    if (isRequired(f, values) && isBlank(values[f.name])) out[f.name] = f.message || requiredMsg;
  }
  for (const rule of step.rules) {
    if (rule.rule === 'at_least_one' && rule.fields.every((n) => isBlank(values[n])) && !(rule.fields[0] in out)) {
      out[rule.fields[0]] = rule.message;
    }
  }
  return out;
}

/** Rules across sections (at least one of padre / madre applies), like `global_missing`. */
export function globalMissing(schema: FichaSchema, all: Record<string, Values>): Record<string, FieldErrors> {
  const out: Record<string, FieldErrors> = {};
  for (const rule of schema.rules) {
    if (rule.rule !== 'at_least_one_applies') continue;
    if (rule.sections.every((k) => all[k]?.[rule.field] === true)) {
      for (const k of rule.sections) out[k] = { ...(out[k] ?? {}), [rule.field]: rule.message };
    }
  }
  return out;
}

/** Everything a step misses, with the section rules and the cross-section ones. */
export function stepMissing(schema: FichaSchema, step: FichaStep, all: Record<string, Values>, requiredMsg: string): FieldErrors {
  const own = sectionMissing(step, all[step.key] ?? {}, requiredMsg);
  return { ...(globalMissing(schema, all)[step.key] ?? {}), ...own };
}

/** The server named these fields as missing: the same message the form would give. */
export function messagesFor(schema: FichaSchema, step: FichaStep, names: string[], all: Record<string, Values>, requiredMsg: string): FieldErrors {
  const known = stepMissing(schema, step, all, requiredMsg);
  return Object.fromEntries(names.map((n) => [n, known[n] ?? stepField(step, n)?.message ?? requiredMsg]));
}

/** The facts of the age hint, measured on 31 December of the cycle's first year; null when it fits. */
export function eligibilityGap(dob: string, grade: string, cycle: string): { grado: string; edad: number; anio: number; tiene: number } | null {
  const need = requiredAge(grade);
  const year = Number(/^(\d{4})-\d{4}$/.exec(cycle || '')?.[1]) || new Date().getFullYear();
  const have = ageOnDec31(dob, year);
  if (need === null || have === null || have === need) return null;
  return { grado: grade, edad: need, anio: year, tiene: have };
}

const isoToDate = (v: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
};

/** How an answer reads in a summary (null = left blank): option labels, dd/mm/aaaa, units, Sí / No. */
export function displayValue(schema: FichaSchema, field: FichaField, value: unknown, words: { yes: string; no: string }): string | null {
  if (field.type === 'boolean') return value === true ? words.yes : words.no;
  if (isBlank(value)) return null;
  if (field.choices) return choiceLabel(schema, field, value);
  if (field.type === 'date') return isoToDate(String(value));
  if (field.unit) return `${value} ${field.unit}`;
  return String(value);
}

/** Best-effort «Nombre(s) Paterno Materno» split (guardians.split_full_name). */
export function splitFullName(name: string): { given: string; paternal: string; maternal: string } {
  const words = String(name ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return { given: '', paternal: '', maternal: '' };
  if (words.length === 1) return { given: words[0], paternal: '', maternal: '' };
  if (words.length === 2) return { given: words[0], paternal: words[1], maternal: '' };
  return { given: words.slice(0, -2).join(' '), paternal: words[words.length - 2], maternal: words[words.length - 1] };
}
