/**
 * whatsapp.ts — WhatsApp conversion helpers for the admissions funnel.
 *
 * Central place for the wa.me deep link + the prefilled es-MX messages each
 * public CTA sends, so copy stays consistent and the school cycle rolls over
 * automatically (CURRENT_CYCLE — nothing hardcoded).
 *
 * The number always comes from useSiteSettings().whatsapp_number (admin
 * editable); per existing convention, callers hide the button entirely when
 * the number is empty.
 */
import { waHref } from './siteContact';
import { CURRENT_CYCLE } from './siteMeta';

/**
 * wa.me deep link: `https://wa.me/<digits>?text=<encoded message>`.
 * Alias of siteContact.waHref — single implementation, funnel-facing name.
 */
export const waLink: (number: string, message: string) => string = waHref;

/** Prefilled messages per conversion context (es-MX, cycle auto-computed). */
export const WA_MESSAGES = {
  /** Admissions general — "Informes" step and generic admissions CTAs. */
  admissionsInfo: `Hola, me gustaría recibir informes de admisión del Colegio Interlaken para el ciclo ${CURRENT_CYCLE}.`,
  /** Visit-oriented CTAs (sticky bar next to «Agendar visita»). */
  visit: 'Hola, quiero agendar una visita al colegio.',
} as const;

/** Per-section message from the cost estimator. */
export function waSectionMessage(section: string): string {
  return `Hola, me interesa información de ${section} para el ciclo ${CURRENT_CYCLE}.`;
}
