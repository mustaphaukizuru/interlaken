/**
 * «Revisión antes de publicar»: what backend/apps/content/publish_checks.py
 * answers (GET/POST /content/admin/pages/<id>/checks/, the 409 bodies of
 * /publish/ and GET /content/admin/pages/checks-summary/).
 */

/** One-click correction: the field's new value (a link object, a text…). */
export interface ReviewFix {
  kind: 'replace_link' | 'unlink' | 'remove_token' | 'add_space' | 'replace_token' | 'clear' | 'restore' | 'show_section' | string;
  /** Button text, e.g. «Cambiar por «Agendar visita»», «Quitar {{anio}}», «Vaciar». */
  label: string;
  value: unknown;
  /** What visitors would read after the fix. */
  preview: string;
}

export interface ReviewIssue {
  level: 'error' | 'warning';
  code: string;
  /** Stable id (code, section, field): what «Entiendo las advertencias» acknowledges. */
  key: string;
  /** Whole sentence naming the section and the field. */
  message: string;
  block_index: number | null;
  block_id: string | null;
  block_label: string;
  /** Editor field path (`items.2.title`), or `seo.title` / `seo.description`. */
  field: string;
  field_label: string;
  /** Short text shown under the field. */
  field_message: string;
  value: unknown;
  /** What visitors would read today. */
  preview: string;
  fix: ReviewFix | null;
  /** A warning that needs «Entiendo las advertencias» (false for suggestions). */
  acknowledge?: boolean;
}

export interface ReviewChange {
  kind: 'added' | 'removed' | 'hidden' | 'shown' | 'changed' | 'moved' | 'more';
  block_index: number | null;
  block_id: string | null;
  block_label: string;
  field: string;
  field_label: string;
  /** As visitors read it (tokens resolved, no HTML). */
  before: string;
  after: string;
  /** The stored text when it holds tokens («Precios 2026{{anio}}»). */
  before_code: string;
  after_code: string;
}

export interface ReviewReport {
  ok: boolean;
  errors: ReviewIssue[];
  warnings: ReviewIssue[];
  suggestions: ReviewIssue[];
  issues: ReviewIssue[];
  changes: ReviewChange[];
  /** What «Qué cambia» compares with: the published version, the page's design, or nothing (first publication). */
  baseline: 'published' | 'design' | 'none';
}

export interface CheckCounts {
  errors: number;
  warnings: number;
  first_error: { code: string; label: string } | null;
  first_warning: { code: string; label: string } | null;
}

/** One page of GET /content/admin/pages/checks-summary/. */
export interface PageCheckSummary {
  id: number;
  slug: string;
  has_unpublished_changes: boolean;
  unpublished_since: string | null;
  /** The draft (null when it equals what is published: then `live` tells). */
  draft: CheckCounts | null;
  /** What the site shows (published pages only). */
  live: CheckCounts | null;
}
