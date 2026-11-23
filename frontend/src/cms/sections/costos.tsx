/**
 * Costos (/admisiones/costos): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * Every figure comes from the price list, edited in the console «Costos y
 * precios» (/admin/costos, docs/cms/price-tables.md); the hero, the copy
 * around the price tables and their column headers and labels are props.
 *
 * Media round (owner 2026-11-22): «¿Cómo se estructura el pago?» opens the
 * page beside its illustration, and the payment note and the closing call
 * carry theirs. Those three parts are drawn here (same words, same props);
 * the price tables between them stay the shared PricingSections.
 */
import { ArrowRight, CalendarDays, Info } from 'lucide-react';
import { PricingSections, PRICING_COPY, type PricingCopy } from '@/components/public/PricingSections';
import { Reveal } from '@/components/ui/Reveal';
import { Illustration, IllustrationPanel, wash } from '@/components/ui/Illustration';
import { isIllustration, type IllustrationName } from '@/lib/illustrations';
import { usePriceYears } from '@/lib/priceYears';
import type { FieldSpec } from '../blocks/registry';
import { imageSrc, imageSrcSet, useTokens, type CmsLink } from '../runtime';
import { CmsAnchor, defineModule, f, grouped, sectionsOf } from './kit';

const section = sectionsOf('costos');

/** The one chosen in the editor; «none» hides it; nothing chosen (saved before the field existed) keeps the built-in one. */
const artOf = (chosen: unknown, fallback: IllustrationName): IllustrationName | undefined =>
  chosen === 'none' ? undefined : isIllustration(chosen) ? chosen : fallback;
const artField = (key: string, label: string, group: string) =>
  f.illustration(key, label, { group, hint: 'Sin elegir, se muestra la de siempre. «Sin ilustración» la oculta.' });

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; badge?: string; image?: number | string }
function CostosHeroView(p: HeroProps) {
  // {{ciclo}} here is the cycle of the published prices, never the calendar's alone (lib/priceYears).
  const prices = usePriceYears();
  const t = useTokens({ ciclo: prices.cycle });
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {p.image && <img src={imageSrc(p.image)} srcSet={imageSrcSet(p.image, { full: true })} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        {p.label && <span className="section-label-pink inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">{t(p.title)}</h1>
        {p.badge && (
          // Hidden (space kept) until the published years arrive, so the cycle never flips in front of the visitor.
          <p className={`mt-3 inline-flex items-center gap-2 text-sm font-semibold text-white/85 ${prices.ready ? '' : 'invisible'}`}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {t(p.badge)}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Tablas de precios ──────────────────────────────────────────────────── */
type PricesProps = Partial<PricingCopy> & { structureIllustration?: string; noteIllustration?: string; ctaIllustration?: string };

/** Colours of the «¿Cómo se estructura el pago?» steps, in order (number, then the row's wash). */
const STEP_TONES = [
  { dot: 'bg-green-strong', wash: 'var(--green)' },
  { dot: 'bg-purple', wash: 'var(--purple)' },
  { dot: 'bg-coral', wash: 'var(--coral)' },
];

/** The stored texts start with a dash (a run-in after the concept); on their own line the dash goes and the sentence starts in capitals. */
const runIn = (text: string) => {
  const rest = text.replace(/^\s*[\u2014\u2013-]\s*/, '');
  return rest === text ? text : rest.charAt(0).toUpperCase() + rest.slice(1);
};

/** What PricingSections should leave out: this page draws the structure, the note and the call itself. */
const DRAWN_HERE: Partial<PricingCopy> = {
  structureTitle: '', structure: [],
  noteText: '', noteStrong: '', noteLinkLead: '', noteLink: {},
  ctaTitle: '', ctaText: '', ctaPrimary: {}, ctaSecondary: {},
};

function CostosPricesView({ structureIllustration, noteIllustration, ctaIllustration, ...copy }: PricesProps) {
  const t = useTokens({ ciclo: usePriceYears().cycle });
  // Stored content may predate a key: the built-in copy fills it, as in PricingSections.
  const c: PricingCopy = { ...PRICING_COPY, ...copy };
  const structure = Array.isArray(c.structure) ? c.structure : [];
  const link = (l: CmsLink | undefined): CmsLink => ({ label: t(l?.label), href: l?.href });
  const art = artOf(structureIllustration, 'costos');
  const noteArt = artOf(noteIllustration, 'pagos');
  const ctaArt = artOf(ctaIllustration, 'inscripcion');
  const hasStructure = !!c.structureTitle || structure.length > 0;
  const hasNote = !!(c.noteText || c.noteStrong || c.noteLinkLead || c.noteLink?.href);
  const hasCta = !!(c.ctaTitle || c.ctaText || c.ctaPrimary?.href || c.ctaSecondary?.href);

  return (
    <>
      {/* ¿Cómo se estructura el pago? beside its illustration (static copy: shown while the prices load too). */}
      {hasStructure && (
        <section className="bg-white py-12 sm:py-16">
          <div className="mx-auto grid max-w-5xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-12 lg:gap-12">
            {art && (
              <Reveal className="hidden lg:col-span-5 lg:block">
                <IllustrationPanel name={art} tint="var(--purple)" />
              </Reveal>
            )}
            <Reveal className={art ? 'lg:col-span-7' : 'lg:col-span-12'}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <span aria-hidden="true" className="mb-4 block h-1 w-10 rounded-full bg-purple" />
                  {c.structureTitle && <h2 className="text-balance font-head text-fluid-2xl font-bold leading-tight text-ink">{t(c.structureTitle)}</h2>}
                </div>
                {art && <Illustration name={art} size={96} fluid className="w-[80px] shrink-0 sm:w-[96px] lg:hidden" />}
              </div>
              <ol className="mt-6 space-y-3">
                {structure.map((st, i) => {
                  const tone = STEP_TONES[i % STEP_TONES.length];
                  return (
                    <li key={i} className="flex items-start gap-4 rounded-md px-4 py-4 sm:px-5" style={{ background: wash(tone.wash, 8) }}>
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.dot} font-head text-sm font-bold text-white`}>{i + 1}</span>
                      <span className="min-w-0 pt-0.5">
                        <strong className="block font-head text-lg font-bold leading-snug text-ink">{t(st.title)}</strong>
                        {st.text && <span className="mt-0.5 block text-base leading-relaxed text-ink/75">{runIn(t(st.text))}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </Reveal>
          </div>
        </section>
      )}

      <PricingSections copy={{ ...copy, ...DRAWN_HERE }} />

      {/* Always shown (also with the error), like the tables' own note, so the page below never jumps. */}
      {(hasNote || hasCta) && (
        <section className="-mt-4 bg-cream-2 pb-12 sm:-mt-6 sm:pb-16">
          <div className="mx-auto max-w-5xl space-y-10 px-4 sm:px-6">
            {hasNote && (
              <div className="flex flex-col items-start gap-3 rounded-md bg-white p-5 shadow-card sm:flex-row sm:items-center sm:gap-5 sm:p-6">
                {noteArt ? (
                  <Illustration name={noteArt} size={88} fluid className="w-[64px] shrink-0 sm:w-[88px]" />
                ) : (
                  <Info size={18} className="mt-0.5 flex-shrink-0 self-start text-purple" aria-hidden="true" />
                )}
                <p className="text-[15px] leading-relaxed text-muted">
                  {t(c.noteText)}{' '}
                  {c.noteStrong && <strong className="text-ink">{t(c.noteStrong)}</strong>}{' '}
                  {t(c.noteLinkLead)}{' '}
                  <CmsAnchor link={link(c.noteLink)} className="font-medium text-green-dark underline" />{c.noteLink?.href ? '.' : ''}
                </p>
              </div>
            )}

            {hasCta && (
              <Reveal>
                <div className="relative overflow-hidden rounded-md bg-dark px-6 py-9 text-white sm:px-10 sm:py-11">
                  <span aria-hidden="true" className="absolute -left-16 -top-20 h-56 w-56 rounded-full bg-purple/40 blur-3xl" />
                  <span aria-hidden="true" className="absolute -bottom-24 right-10 h-56 w-56 rounded-full bg-pink/25 blur-3xl" />
                  <div className="relative grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-10">
                    {ctaArt && (
                      <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full bg-white/[0.07] md:order-2 md:h-48 md:w-48">
                        <Illustration name={ctaArt} size={160} fluid className="w-[96px] md:w-[148px]" />
                      </div>
                    )}
                    <div className="text-center md:text-left">
                      {c.ctaTitle && <h2 className="font-head text-fluid-2xl font-bold leading-tight">{t(c.ctaTitle)}</h2>}
                      {c.ctaText && <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-white/75 md:mx-0">{t(c.ctaText)}</p>}
                      <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row md:justify-start">
                        <CmsAnchor link={link(c.ctaPrimary)} className="btn-pink">
                          {t(c.ctaPrimary?.label)} <ArrowRight size={16} aria-hidden="true" />
                        </CmsAnchor>
                        <CmsAnchor link={link(c.ctaSecondary)} className="btn-ghost" />
                      </div>
                    </div>
                  </div>
                </div>
              </Reveal>
            )}
          </div>
        </section>
      )}
    </>
  );
}

/**
 * Label, title and subtitle of one price card, with the card's other texts, as
 * one group in the editor. «Precios 2027» and «Precios 2028: pendientes» are
 * not texts any more: they follow the year published in «Costos y precios».
 */
const card = (key: string, name: string, group: string, extra: FieldSpec[] = []): FieldSpec[] => grouped(group, [
  f.text(`${key}Label`, `${name}: etiqueta`),
  f.text(`${key}Title`, `${name}: título`),
  f.text(`${key}Subtitle`, `${name}: subtítulo`),
  ...extra,
]);

export const sections = [
  section({
    type: 'hero', label: 'Costos · Portada', description: 'Foto con velo oscuro, etiqueta, título y la insignia del ciclo escolar.',
    component: CostosHeroView,
    fields: [
      f.text('label', 'Etiqueta superior'),
      f.text('title', 'Título', { required: true }),
      f.text('badge', 'Insignia', { hint: 'Aquí {{ciclo}} es el ciclo de los precios publicados en «Costos y precios», no cambia solo con el calendario.' }),
      f.image('image', 'Foto'),
    ],
    defaults: { label: 'Admisiones', title: 'Costos', badge: 'Ciclo Escolar {{ciclo}}', image: '/assets/facade.webp' },
  }),
  section({
    type: 'prices', label: 'Costos · Tablas de precios', description: 'Cómo se paga (con su ilustración), cuotas, colegiaturas, seguros, extraescolares, estancia, políticas, la nota y el llamado final. Las cifras se editan en «Costos y precios»; aquí, los textos, encabezados, etiquetas e ilustraciones que las acompañan.',
    component: CostosPricesView,
    fields: [
      // Where the figures are edited: the console screen, in another tab (the draft stays open).
      f.action('editPrices', 'Editar precios', '/admin/costos', { hint: 'Las cifras, los niveles, las políticas y el año de cada sección («Precios 2027», «pendientes») se editan en «Costos y precios». Aquí, los textos que los acompañan.' }),
      ...grouped('Cómo se paga', [
        f.text('structureTitle', 'Título de la explicación'),
        f.items('structure', 'Cómo se estructura el pago', [f.text('title', 'Concepto', { required: true }), f.text('text', 'Explicación')]),
      ]),
      artField('structureIllustration', 'Ilustración junto a la explicación', 'Cómo se paga'),
      ...card('fees', 'Inscripción', 'Inscripción y reinscripción', [
        f.text('newTag', 'Pestaña de nuevo ingreso'),
        f.text('returningTag', 'Pestaña de reinscripción'),
        f.text('colLevel', 'Encabezado: nivel'),
        f.text('colAdmin', 'Encabezado: gastos administrativos'),
        f.text('colNew', 'Encabezado de la cuota (nuevo ingreso)'),
        f.text('colReturning', 'Encabezado de la cuota (reinscripción)'),
      ]),
      ...card('tuition', 'Colegiaturas', 'Colegiaturas', [f.text('perMonth', 'Texto después de cada colegiatura')]),
      ...card('insurance', 'Seguros', 'Seguros y credenciales'),
      ...card('extras', 'Extraescolares', 'Extraescolares', [f.text('perYear', 'Texto después de cada anualidad')]),
      ...card('daycare', 'Estancia', 'Estancia', [f.text('daycareMonthly', 'Texto después de la tarifa mensual')]),
      ...grouped('Políticas de pago', [
        f.text('policiesTitle', 'Título de las políticas'),
        f.text('policyHighlight', 'Destacar las políticas que mencionan', { hint: 'Palabras separadas por comas; esas políticas se ven en negritas con el ícono ámbar.' }),
      ]),
      ...grouped('Nota al final de las tablas', [
        f.textarea('noteText', 'Nota: texto'),
        f.textarea('noteStrong', 'Nota: texto en negritas'),
        f.text('noteLinkLead', 'Nota: texto antes del enlace'),
        f.link('noteLink', 'Nota: enlace'),
      ]),
      artField('noteIllustration', 'Nota: ilustración', 'Nota al final de las tablas'),
      ...grouped('Llamado final', [
        f.text('ctaTitle', 'Llamado final: título'),
        f.textarea('ctaText', 'Llamado final: texto'),
        f.link('ctaPrimary', 'Llamado final: botón principal'),
        f.link('ctaSecondary', 'Llamado final: botón secundario'),
      ]),
      artField('ctaIllustration', 'Llamado final: ilustración', 'Llamado final'),
      ...grouped('Si no hay precios o no cargan', [
        f.text('emptyTitle', 'Sin precios publicados: título'),
        f.textarea('emptyText', 'Sin precios publicados: texto'),
        f.link('emptyPrimary', 'Sin precios publicados: botón principal'),
        f.link('emptySecondary', 'Sin precios publicados: botón secundario'),
        f.text('errorTitle', 'Si no cargan los precios: título'),
        f.textarea('errorText', 'Si no cargan los precios: texto'),
      ]),
    ],
    defaults: { ...PRICING_COPY, structureIllustration: 'costos', noteIllustration: 'pagos', ctaIllustration: 'inscripcion' },
  }),
];

export const templates = [{
  slug: 'costos', path: '/admisiones/costos', title: 'Costos', group: 'costos',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['costos.hero', 'costos.prices'],
}];

export default defineModule(sections, templates);
