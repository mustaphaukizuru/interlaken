/**
 * Field validation of the CMS editor (contract C3), run while editing so a
 * problem shows next to its field long before «Publicar». Mirrors what the
 * backend checks at publish (apps/content/checks.py): required fields,
 * library images without alt text or deleted, and links that cannot work.
 */
import type { BlockSpec, FieldSpec } from '../blocks/registry';
import { hrefProblem, htmlHrefs, MARK_LINK_RE } from './fields/links';

export type IssueCode = 'required' | 'alt' | 'missing_image' | 'link';

export interface FieldIssue {
  /** `title`, `items.2.title` (see fieldFocus.ts). */
  path: string;
  /** Spanish label chain, e.g. «Tarjetas › 3 › Título». */
  label: string;
  message: string;
  code: IssueCode;
}

/** Library image info: undefined while loading, null when the image no longer exists. */
export type MediaLookup = (id: number) => { alt: string } | null | undefined;

/** One structured error from the backend (save or publish) or a client check, located by block and field. */
export interface CmsFieldError {
  block_index?: number;
  block_id: string | null;
  block_label?: string;
  field: string;
  field_label?: string;
  message: string;
}

export const LABEL_SEP = ' › ';

const stripHtml = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

export function isEmptyValue(f: FieldSpec, v: unknown): boolean {
  switch (f.kind) {
    case 'toggle':
      return false;
    case 'number':
      return v === undefined || v === null || v === '' || Number.isNaN(v);
    case 'image':
      return v === undefined || v === null || v === '' || v === 0;
    case 'images':
    case 'items':
      return !Array.isArray(v) || v.length === 0;
    case 'link': {
      const l = (v ?? {}) as { href?: string; label?: string };
      return !String(l.href ?? '').trim();
    }
    case 'richtext':
      return !stripHtml(String(v ?? ''));
    default:
      return !String(v ?? '').trim();
  }
}

function requiredMessage(f: FieldSpec, v: unknown): string {
  switch (f.kind) {
    case 'image': return 'Elija una imagen: es obligatoria.';
    case 'images':
    case 'items': return 'Agregue al menos uno: es obligatorio.';
    case 'link': {
      const l = (v ?? {}) as { label?: string };
      return String(l.label ?? '').trim() ? 'Elija a dónde lleva el enlace.' : 'Escriba el texto y elija a dónde lleva el enlace.';
    }
    case 'select':
    case 'icon':
    case 'color':
    case 'form': return 'Elija una opción: es obligatoria.';
    case 'href': return 'Elija a dónde lleva el enlace.';
    default: return 'Este campo es obligatorio.';
  }
}

/** Library image ids used by these fields (top-level and inside lists). */
export function imageIdsIn(fields: FieldSpec[], props: Record<string, unknown>): number[] {
  const out: number[] = [];
  for (const f of fields) {
    const v = props[f.key];
    if (f.kind === 'image' && typeof v === 'number') out.push(v);
    else if (f.kind === 'images' && Array.isArray(v)) for (const it of v) { const id = (it as { image?: unknown })?.image; if (typeof id === 'number') out.push(id); }
    else if (f.kind === 'items' && Array.isArray(v)) for (const it of v) if (it && typeof it === 'object') out.push(...imageIdsIn(f.item ?? [], it as Record<string, unknown>));
  }
  return out;
}

function imageIssue(path: string, label: string, v: unknown, media?: MediaLookup): FieldIssue | null {
  if (typeof v !== 'number' || !media) return null;
  const info = media(v);
  if (info === null) return { path, label, code: 'missing_image', message: 'Esta imagen ya no existe en la biblioteca. Elija otra.' };
  if (info && !info.alt.trim()) return { path, label, code: 'alt', message: 'Falta la descripción de la imagen (texto alternativo). Sin ella no se puede publicar.' };
  return null;
}

/** Every problem in a set of fields, depth first, in form order. */
export function validateFields(fields: FieldSpec[], props: Record<string, unknown>, media?: MediaLookup, prefix = '', labelPrefix = ''): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const f of fields) {
    const path = `${prefix}${f.key}`;
    const label = `${labelPrefix}${f.label}`;
    const v = props[f.key];
    if (f.required && isEmptyValue(f, v)) {
      issues.push({ path, label, code: 'required', message: requiredMessage(f, v) });
      continue;
    }
    if (f.kind === 'link' && v && typeof v === 'object') {
      const l = v as { label?: string; href?: string };
      const problem = hrefProblem(l.href);
      if (problem) issues.push({ path, label, code: 'link', message: problem });
      else if (f.required && !String(l.label ?? '').trim()) issues.push({ path, label, code: 'required', message: 'Escriba el texto del enlace.' });
    } else if (f.kind === 'href') {
      const problem = hrefProblem(typeof v === 'string' ? v : '');
      if (problem) issues.push({ path, label, code: 'link', message: problem });
    } else if (f.kind === 'image') {
      const issue = imageIssue(path, label, v, media);
      if (issue) issues.push(issue);
    } else if (f.kind === 'images' && Array.isArray(v)) {
      v.forEach((it, i) => {
        const issue = imageIssue(`${path}.${i}.image`, `${label}${LABEL_SEP}${i + 1}`, (it as { image?: unknown })?.image, media);
        if (issue) issues.push(issue);
      });
    } else if (f.kind === 'items' && Array.isArray(v)) {
      v.forEach((it, i) => {
        if (it && typeof it === 'object') issues.push(...validateFields(f.item ?? [], it as Record<string, unknown>, media, `${path}.${i}.`, `${label}${LABEL_SEP}${i + 1}${LABEL_SEP}`));
      });
    } else if (typeof v === 'string' && v) {
      const hrefs = f.kind === 'richtext' ? htmlHrefs(v) : f.marks?.includes('link') ? Array.from(v.matchAll(MARK_LINK_RE), (m) => m[2]) : [];
      const bad = hrefs.map(hrefProblem).find(Boolean);
      if (bad) issues.push({ path, label, code: 'link', message: `Un enlace del texto no sirve: ${bad}` });
    }
  }
  return issues;
}

export function validateBlockProps(spec: BlockSpec | undefined, props: Record<string, unknown>, media?: MediaLookup): FieldIssue[] {
  return spec ? validateFields(spec.fields, props, media) : [];
}

/* ── Structured server errors (backend `errors` list, checks `issues`) ── */

interface IssueLike { level?: string; block_id?: string | null; field?: string; message?: string; field_message?: string; block_index?: number; block_label?: string; field_label?: string }

const asFieldError = (e: IssueLike): CmsFieldError => ({
  block_index: e.block_index,
  block_id: e.block_id ?? null,
  block_label: e.block_label,
  field: e.field ?? '',
  field_label: e.field_label,
  message: e.field_message ?? e.message ?? '',
});

/** `errors` of a failed save or publish (HTTP 400), or [] for any other failure. */
export function fieldErrorsFrom(err: unknown): CmsFieldError[] {
  const data = (err as { response?: { data?: { errors?: unknown } } } | undefined)?.response?.data;
  const list = data && Array.isArray(data.errors) ? (data.errors as IssueLike[]) : [];
  return list.filter((e) => e && typeof e === 'object' && typeof e.message === 'string').map(asFieldError);
}

/** Error-level issues of the pre-publish check that point at a field. */
export function fieldErrorsFromIssues(issues: IssueLike[] | undefined): CmsFieldError[] {
  return (issues ?? []).filter((i) => i.level === 'error' && i.block_id && i.field).map(asFieldError);
}
