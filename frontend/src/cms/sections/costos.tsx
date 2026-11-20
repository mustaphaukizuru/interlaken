/**
 * Costos (/admisiones/costos): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * Every figure comes from the price list (Ajustes, Costos); the hero and the
 * copy around the price tables are props.
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

/** Label, title and subtitle of one price card. */
const card = (key: string, name: string): FieldSpec[] => [
  f.text(`${key}Label`, `${name}: etiqueta`),
  f.text(`${key}Title`, `${name}: título`),
  f.text(`${key}Subtitle`, `${name}: subtítulo`),
];

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
    type: 'prices', label: 'Costos · Tablas de precios', description: 'Cuotas, colegiaturas, seguros, extraescolares y estancia. Los precios se editan en Ajustes, Costos; aquí solo los textos que los acompañan.',
    component: CostosPricesView,
    fields: [
      f.text('structureTitle', 'Título de la explicación del pago'),
      f.items('structure', 'Cómo se estructura el pago', [f.text('title', 'Concepto', { required: true }), f.text('text', 'Explicación')]),
      ...card('fees', 'Inscripción'),
      f.text('newTag', 'Pestaña de nuevo ingreso'),
      f.text('returningTag', 'Pestaña de reinscripción'),
      ...card('tuition', 'Colegiaturas'),
      ...card('insurance', 'Seguros'),
      ...card('extras', 'Extraescolares'),
      ...card('daycare', 'Estancia'),
      f.text('policiesTitle', 'Título de las políticas de pago'),
      f.textarea('noteText', 'Nota: texto'),
      f.textarea('noteStrong', 'Nota: texto en negritas'),
      f.text('noteLinkLead', 'Nota: texto antes del enlace'),
      f.link('noteLink', 'Nota: enlace'),
      f.text('ctaTitle', 'Llamado final: título'),
      f.textarea('ctaText', 'Llamado final: texto', { hint: 'Puede usar {{ciclo}}.' }),
      f.link('ctaPrimary', 'Llamado final: botón principal'),
      f.link('ctaSecondary', 'Llamado final: botón secundario'),
      f.text('emptyTitle', 'Sin precios publicados: título'),
      f.textarea('emptyText', 'Sin precios publicados: texto'),
      f.link('emptyPrimary', 'Sin precios publicados: botón principal'),
      f.link('emptySecondary', 'Sin precios publicados: botón secundario'),
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
