/**
 * Costos (/admisiones/costos): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * Every figure comes from the price list, edited in the console «Costos y
 * precios» (/admin/costos, docs/cms/price-tables.md); the hero, the copy
 * around the price tables and their column headers and labels are props.
 */
import { CalendarDays } from 'lucide-react';
import { PricingSections, PRICING_COPY, type PricingCopy } from '@/components/public/PricingSections';
import type { FieldSpec } from '../blocks/registry';
import { imageSrc, imageSrcSet, useTokens } from '../runtime';
import { defineModule, f, grouped, sectionsOf } from './kit';

const section = sectionsOf('costos');

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; badge?: string; image?: number | string }
function CostosHeroView(p: HeroProps) {
  const t = useTokens();
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {p.image && <img src={imageSrc(p.image)} srcSet={imageSrcSet(p.image, { full: true })} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        {p.label && <span className="section-label-pink inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">{t(p.title)}</h1>
        {p.badge && (
          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            {t(p.badge)}
          </p>
        )}
      </div>
    </section>
  );
}

/* ── Tablas de precios ──────────────────────────────────────────────────── */
function CostosPricesView(p: Partial<PricingCopy>) {
  return <PricingSections copy={p} />;
}

/** Label, title, year badge and subtitle of one price card, with the card's other texts, as one group in the editor. */
const card = (key: string, name: string, group: string, extra: FieldSpec[] = []): FieldSpec[] => grouped(group, [
  f.text(`${key}Label`, `${name}: etiqueta`),
  f.text(`${key}Title`, `${name}: título`),
  f.text(`${key}Year`, `${name}: año de los precios`, { hint: 'Insignia junto al título, por ejemplo «Precios 2027». Déjelo vacío para ocultarla.' }),
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
      f.text('badge', 'Insignia', { hint: '{{ciclo}} muestra el ciclo escolar vigente.' }),
      f.image('image', 'Foto'),
    ],
    defaults: { label: 'Admisiones', title: 'Costos', badge: 'Ciclo Escolar {{ciclo}}', image: '/assets/facade.webp' },
  }),
  section({
    type: 'prices', label: 'Costos · Tablas de precios', description: 'Cuotas, colegiaturas, seguros, extraescolares, estancia y políticas. Las cifras se editan en «Costos y precios»; aquí, los textos, encabezados y etiquetas que las acompañan.',
    component: CostosPricesView,
    fields: [
      // Where the figures are edited: the console screen, in another tab (the draft stays open).
      f.action('editPrices', 'Editar precios', '/admin/costos', { hint: 'Las cifras, los niveles y las políticas se editan en «Costos y precios». Aquí, los textos que los acompañan.' }),
      ...grouped('Cómo se paga', [
        f.text('structureTitle', 'Título de la explicación'),
        f.items('structure', 'Cómo se estructura el pago', [f.text('title', 'Concepto', { required: true }), f.text('text', 'Explicación')]),
      ]),
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
      ...grouped('Llamado final', [
        f.text('ctaTitle', 'Llamado final: título'),
        f.textarea('ctaText', 'Llamado final: texto'),
        f.link('ctaPrimary', 'Llamado final: botón principal'),
        f.link('ctaSecondary', 'Llamado final: botón secundario'),
      ]),
      ...grouped('Si no hay precios o no cargan', [
        f.text('emptyTitle', 'Sin precios publicados: título'),
        f.textarea('emptyText', 'Sin precios publicados: texto'),
        f.link('emptyPrimary', 'Sin precios publicados: botón principal'),
        f.link('emptySecondary', 'Sin precios publicados: botón secundario'),
        f.text('errorTitle', 'Si no cargan los precios: título'),
        f.textarea('errorText', 'Si no cargan los precios: texto'),
      ]),
    ],
    defaults: { ...PRICING_COPY },
  }),
];

export const templates = [{
  slug: 'costos', path: '/admisiones/costos', title: 'Costos', group: 'costos',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['costos.hero', 'costos.prices'],
}];

export default defineModule(sections, templates);
