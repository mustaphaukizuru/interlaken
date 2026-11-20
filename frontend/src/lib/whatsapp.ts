/**
 * whatsapp.ts — WhatsApp conversion helpers for the admissions funnel.
 *
 * Central place for the wa.me deep link + the prefilled es-MX messages each
 * public CTA sends, so copy stays consistent and the school cycle rolls over
 * automatically ({{ciclo}} = CURRENT_CYCLE — nothing hardcoded).
 *
 * The messages are editable in Navegación → «Textos del sitio»
 * (SiteSettings.chrome wa_*); blank = the built-in text below.
 *
 * The number always comes from useSiteSettings().whatsapp_number (admin
 * editable); per existing convention, callers hide the button entirely when
 * the number is empty.
 */
import { CURRENT_CYCLE } from './siteMeta';
import { siteText } from './siteChrome';

/** Built-in prefilled messages ({{ciclo}} = the current school cycle). */
export const WA_DEFAULTS = {
  /** Admissions general — "Informes" step and generic admissions CTAs. */
  wa_admissions: 'Hola, me gustaría recibir informes de admisión del Colegio Interlaken para el ciclo {{ciclo}}.',
  /** Visit-oriented CTAs (sticky bar next to «Agendar visita»). */
  wa_visit: 'Hola, quiero agendar una visita al colegio.',
  /** The cost estimator, per section ({seccion} = the section chosen). */
  wa_estimator: 'Hola, me interesa información de {seccion} para el ciclo {{ciclo}}.',
} as const;

const withCycle = (text: string) => text.replace(/\{\{\s*ciclo\s*\}\}/g, CURRENT_CYCLE);

/** A prefilled message from SiteSettings.chrome, or its built-in text. */
export function waMessage(chrome: unknown, key: keyof typeof WA_DEFAULTS): string {
  return withCycle(siteText(chrome, key, WA_DEFAULTS[key]));
}

/** Prefilled messages per conversion context with the built-in copy. */
export const WA_MESSAGES = {
  admissionsInfo: waMessage(null, 'wa_admissions'),
  visit: waMessage(null, 'wa_visit'),
} as const;

/*
 * The estimator builds its link inside its own component, so the edited
 * template is handed over here when the site settings load (PublicLayout).
 */
let estimatorTemplate: string | null = null;
export function setWaEstimatorTemplate(chrome: unknown): void {
  estimatorTemplate = siteText(chrome, 'wa_estimator', '') || null;
}

/** Per-section message from the cost estimator. */
export function waSectionMessage(section: string): string {
  return withCycle(estimatorTemplate ?? WA_DEFAULTS.wa_estimator).replace(/\{seccion\}/g, section);
}
