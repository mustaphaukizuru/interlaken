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
import { defineModule, f, sectionsOf } from './kit';

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

/** Label, title and subtitle of one price card, in the card's field group. */
const card = (key: string, name: string, group: string): FieldSpec[] => [
  f.text(`${key}Label`, `${name}: etiqueta`, { group }),
  f.text(`${key}Title`, `${name}: título`, { group }),
  f.text(`${key}Subtitle`, `${name}: subtítulo`, { group }),
];

const G = {
  pay: 'Explicación del pago', fees: 'Inscripción y reinscripción', tuition: 'Colegiaturas', insurance: 'Seguros y credenciales',
  extras: 'Extraescolares', daycare: 'Estancia', policies: 'Políticas de pago', note: 'Nota y llamado final', empty: 'Sin precios o con error',
};

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
      f.text('structureTitle', 'Título de la explicación', { group: G.pay }),
      f.items('structure', 'Cómo se estructura el pago', [f.text('title', 'Concepto', { required: true }), f.text('text', 'Explicación')], { group: G.pay }),
      ...card('fees', 'Inscripción', G.fees),
      f.text('newTag', 'Pestaña de nuevo ingreso', { group: G.fees }),
      f.text('returningTag', 'Pestaña de reinscripción', { group: G.fees }),
      f.text('colLevel', 'Encabezado: nivel', { group: G.fees }),
      f.text('colAdmin', 'Encabezado: gastos administrativos', { group: G.fees }),
      f.text('colNew', 'Encabezado de la cuota (nuevo ingreso)', { group: G.fees }),
      f.text('colReturning', 'Encabezado de la cuota (reinscripción)', { group: G.fees }),
      ...card('tuition', 'Colegiaturas', G.tuition),
      f.text('perMonth', 'Texto después de cada colegiatura', { group: G.tuition }),
      ...card('insurance', 'Seguros', G.insurance),
      ...card('extras', 'Extraescolares', G.extras),
      f.text('perYear', 'Texto después de cada anualidad', { group: G.extras }),
      ...card('daycare', 'Estancia', G.daycare),
      f.text('daycareMonthly', 'Texto después de la tarifa mensual', { group: G.daycare }),
      f.text('policiesTitle', 'Título de las políticas', { group: G.policies }),
      f.text('policyHighlight', 'Destacar las políticas que mencionan', { group: G.policies, hint: 'Palabras separadas por comas; esas políticas se ven en negritas con el ícono ámbar.' }),
      f.textarea('noteText', 'Nota: texto', { group: G.note }),
      f.textarea('noteStrong', 'Nota: texto en negritas', { group: G.note }),
      f.text('noteLinkLead', 'Nota: texto antes del enlace', { group: G.note }),
      f.link('noteLink', 'Nota: enlace', { group: G.note }),
      f.text('ctaTitle', 'Llamado final: título', { group: G.note }),
      f.textarea('ctaText', 'Llamado final: texto', { group: G.note, hint: 'Puede usar {{ciclo}}.' }),
      f.link('ctaPrimary', 'Llamado final: botón principal', { group: G.note }),
      f.link('ctaSecondary', 'Llamado final: botón secundario', { group: G.note }),
      f.text('emptyTitle', 'Sin precios publicados: título', { group: G.empty }),
      f.textarea('emptyText', 'Sin precios publicados: texto', { group: G.empty }),
      f.link('emptyPrimary', 'Sin precios publicados: botón principal', { group: G.empty }),
      f.link('emptySecondary', 'Sin precios publicados: botón secundario', { group: G.empty }),
      f.text('errorTitle', 'Si no cargan los precios: título', { group: G.empty }),
      f.textarea('errorText', 'Si no cargan los precios: texto', { group: G.empty }),
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
