/**
 * Test fixtures (synthetic data): the «costos» draft of 2026-11-21 as the
 * backend reviews it (backend/apps/content/test_publish_checks.py), with the
 * shapes publish_checks.py answers.
 */
import type { Block } from '../../blocks/registry';
import type { ReviewIssue, ReviewReport } from './types';

export const VISIT = { label: 'Agendar visita', href: '/agendar-visita' };
export const FICHA = { label: 'Llene la ficha de inscripción', href: '/pre-registro' };

export const COSTOS_BLOCKS: Block[] = [
  { id: 'costos-1', type: 'costos.hero', props: { title: 'Costos y colegiaturas' } },
  {
    id: 'costos-2', type: 'costos.prices',
    props: { ctaPrimary: FICHA, daycareYear: 'Precios 2026{{anio}}', tuitionPending: '{{ciclo}}', feesPending: '{{ciclo}}{{anio}}{{anios}}' },
  },
];

const base = { block_index: 1, block_id: 'costos-2', block_label: 'Costos · Tablas de precios' };

export const PRIVATE_LINK: ReviewIssue = {
  ...base, level: 'error', code: 'private_link', key: 'private_link:costos-2:ctaPrimary', acknowledge: false,
  message: 'Sección 2 (Costos · Tablas de precios), campo «Llamado final: botón principal»: la ficha de inscripción es personal.',
  field: 'ctaPrimary', field_label: 'Llamado final: botón principal',
  field_message: 'La ficha de inscripción es personal: el colegio envía el enlace a cada familia admitida. Use «Agendar visita» (/agendar-visita) o «Admisiones» (/admisiones).',
  value: FICHA, preview: 'Llene la ficha de inscripción → /pre-registro',
  fix: { kind: 'replace_link', label: 'Cambiar por «Agendar visita»', value: VISIT, preview: 'Agendar visita → /agendar-visita' },
};

export const GLUED: ReviewIssue = {
  ...base, level: 'warning', code: 'token_glued', key: 'token_glued:costos-2:daycareYear', acknowledge: true,
  message: 'Sección 2 (Costos · Tablas de precios), campo «Estancia: año de los precios»: {{anio}} quedó pegado al texto.',
  field: 'daycareYear', field_label: 'Estancia: año de los precios',
  field_message: '{{anio}} quedó pegado al texto: se verá «Precios 20262026».',
  value: 'Precios 2026{{anio}}', preview: 'Precios 20262026',
  fix: { kind: 'remove_token', label: 'Quitar {{anio}}', value: 'Precios 2026', preview: 'Precios 2026' },
};

export const ONLY_TUITION: ReviewIssue = {
  ...base, level: 'warning', code: 'token_only_label', key: 'token_only_label:costos-2:tuitionPending', acknowledge: true,
  message: 'Sección 2 (Costos · Tablas de precios), campo «Colegiaturas: aviso de precios pendientes»: solo tiene datos automáticos.',
  field: 'tuitionPending', field_label: 'Colegiaturas: aviso de precios pendientes',
  field_message: 'Solo tiene datos automáticos ({{ciclo}}): se verá «2026–2027». Parece que se insertaron por error.',
  value: '{{ciclo}}', preview: '2026–2027',
  fix: { kind: 'clear', label: 'Vaciar', value: '', preview: '' },
};

export const ONLY_FEES: ReviewIssue = {
  ...ONLY_TUITION, key: 'token_only_label:costos-2:feesPending', field: 'feesPending', field_label: 'Inscripción: aviso de precios pendientes',
  field_message: 'Solo tiene datos automáticos ({{ciclo}}{{anio}}{{anios}}): se verá «2026–2027202645». Parece que se insertaron por error.',
  value: '{{ciclo}}{{anio}}{{anios}}', preview: '2026–2027202645',
};

export const SEO_ADVICE: ReviewIssue = {
  level: 'warning', code: 'seo_long', key: 'seo_long:page:', acknowledge: false, block_index: null, block_id: null, block_label: '',
  message: 'SEO, campo «Descripción SEO»: tiene 170 caracteres; Google la recorta a partir de 160.', field: '', field_label: '',
  field_message: 'SEO, campo «Descripción SEO»: tiene 170 caracteres; Google la recorta a partir de 160.', value: null, preview: '', fix: null,
};

export function report(parts: Partial<ReviewReport> = {}): ReviewReport {
  const errors = parts.errors ?? [PRIVATE_LINK];
  const warnings = parts.warnings ?? [GLUED, ONLY_TUITION, ONLY_FEES];
  const suggestions = parts.suggestions ?? [];
  return {
    ok: errors.length === 0, errors, warnings, suggestions, issues: [...errors, ...warnings, ...suggestions], baseline: 'published',
    changes: parts.changes ?? [
      { kind: 'changed', ...base, field: 'daycareYear', field_label: 'Estancia: año de los precios', before: 'Precios 2026', after: 'Precios 20262026', before_code: '', after_code: 'Precios 2026{{anio}}' },
      { kind: 'changed', ...base, field: 'feesPending', field_label: 'Inscripción: aviso de precios pendientes', before: '', after: '2026–2027202645', before_code: '', after_code: '{{ciclo}}{{anio}}{{anios}}' },
    ],
    ...parts,
  };
}
