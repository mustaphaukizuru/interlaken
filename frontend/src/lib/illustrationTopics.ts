/**
 * Picks an illustration from a title, for sections whose stored CMS content
 * predates the «Ilustración» field (level texts, values, pillars, platforms).
 */
import { isIllustration, type IllustrationName } from './illustrations';

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Title keywords → illustration, most specific first. */
const BY_TOPIC: [RegExp, IllustrationName][] = [
  [/money|finanz|emprend|dinero|prepararse para la vida/, 'finanzas'],
  [/herramient/, 'ideas'],
  [/salir del salon|campament|excursion/, 'campamento'],
  [/desenvolver/, 'brujula'],
  [/mundo global|preparados para un mundo|internacional/, 'mundo'],
  [/biling|ingles|idioma/, 'bilingue'],
  [/tarea/, 'tareas'],
  [/tecnolog|ipad|digital/, 'tecnologia'],
  [/lectura|lee y produce|redacci/, 'lectura'],
  [/oral|comunicar|expres/, 'oral'],
  [/matemat|singapur/, 'matematicas'],
  [/arte|creando|musica|teatro/, 'arte'],
  [/moverse|calma|deport/, 'crear'],
  [/convivir|convivencia/, 'convivir'],
  [/ritmo/, 'ritmo'],
  [/yo puedo|lograr|logro/, 'logro'],
  [/memoriz|experiment|descubr|pregunt|haciendo|ciencia/, 'experimentar'],
  [/cada alumno importa|acompan|comunidad|felices/, 'comunidad'],
  [/excelencia|academic|calidad/, 'academico'],
  [/valor|humano/, 'valores'],
  [/ecolog|ambient/, 'ecologia'],
  [/formacion para la vida|escuela\./, 'mochila'],
  [/proposito|meta/, 'proposito'],
  [/idea|pensar|innovac/, 'ideas'],
];

/** The illustration that fits a title, or undefined. */
export function illustrationFor(title: string | undefined): IllustrationName | undefined {
  if (!title) return undefined;
  const t = fold(title);
  return BY_TOPIC.find(([re]) => re.test(t))?.[1];
}

/**
 * The illustration a section shows: the one chosen in the editor; «none» hides
 * it; nothing chosen (content saved before the field existed) falls back to
 * the title.
 */
export function resolveIllustration(chosen: unknown, title?: string): IllustrationName | undefined {
  if (chosen === 'none') return undefined;
  if (isIllustration(chosen)) return chosen;
  return illustrationFor(title);
}
