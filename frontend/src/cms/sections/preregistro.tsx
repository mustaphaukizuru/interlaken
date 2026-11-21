/**
 * Ficha de inscripción (/pre-registro): designed sections (docs/CMS-COMPLETION-PLAN.md).
 * The school's 2021 Excel ficha as an online wizard (Fase 2); it replaced the
 * short pre-registro form and the old /inscripcion wizard (whose staff links
 * now open here). The wizard is a locked section that owns its state
 * (components/admissions/ficha); every word around the schema's fields is a
 * prop of it. The hero and the trust strip show only next to the start: the
 * wizard publishes a page-local view flag and they step aside on the other
 * screens (steps, confirmation, links), so a phone sees the form first.
 *
 * The ficha is private (2026-11-21): the school sends each admitted family
 * its personal link. Without one, «the start» is the panel «La ficha de
 * inscripción es personal» (PrivateFicha); the page is noindex and out of
 * the sitemap, and no public page links here.
 */
import { createElement, useMemo, useSyncExternalStore } from 'react';
import { CalendarDays, Clock } from 'lucide-react';
import { FunnelHero } from '@/components/admissions/FunnelHero';
import { FichaWizard, type FichaView } from '@/components/admissions/ficha/FichaWizard';
import { fichaPdfSlot } from '@/components/admissions/ficha/FichaPdfSlot';
import {
  BLANKABLE, FICHA_GROUPS, FICHA_LINKS, FICHA_LISTS, FICHA_TEXT, LONG_TEXTS,
  type FichaCopy, type TextKey,
} from '@/components/admissions/ficha/copy';
import { iconResolver } from '../iconRuntime';
import { useCmsImage, useTokens } from '../runtime';
import { asLink, asList, defineModule, f, grouped, sectionsOf } from './kit';

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ CalendarDays, Clock });

const section = sectionsOf('preregistro');

/* ── View flag shared by the sections of this page ──────────────────────── */
let view: FichaView = 'start';
const listeners = new Set<() => void>();
function setView(v: FichaView) {
  if (view === v) return;
  view = v;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const useView = () => useSyncExternalStore(subscribe, () => view, () => 'start' as FichaView);

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
function PreRegisterHeroView(p: HeroProps) {
  const t = useTokens();
  const img = useCmsImage(p.image);
  if (useView() !== 'start') return null;
  return (
    <FunnelHero
      step="pre-registro"
      label={t(p.label)}
      title={t(p.title)}
      subtitle={p.subtitle ? t(p.subtitle) : undefined}
      imageSrc={img.src || undefined}
    />
  );
}

/* ── Franja de confianza ────────────────────────────────────────────────── */
interface TrustProps { first?: string; firstIcon?: string; second?: string; secondIcon?: string }
function PreRegisterTrustView(p: TrustProps) {
  const t = useTokens();
  if (useView() !== 'start') return null;
  return (
    <section className="border-b border-line bg-cream-2">
      <div className="mx-auto flex max-w-2xl flex-col gap-2.5 px-4 py-4 text-sm text-ink sm:flex-row sm:items-center sm:justify-between sm:px-6">
        {p.first && (
          <span className="inline-flex items-center gap-2 font-medium">
            {createElement(cmsIcon(p.firstIcon), { className: 'h-4 w-4 shrink-0 text-green-dark', 'aria-hidden': true })}
            {t(p.first)}
          </span>
        )}
        {p.second && (
          <span className="inline-flex items-center gap-2 text-muted">
            {createElement(cmsIcon(p.secondIcon), { className: 'h-4 w-4 shrink-0 text-pink', 'aria-hidden': true })}
            {t(p.second)}
          </span>
        )}
      </div>
    </section>
  );
}

/* ── Ficha (bloqueada) ──────────────────────────────────────────────────── */
function FichaFormView(p: Record<string, unknown>) {
  const t = useTokens();
  const copy = useMemo<FichaCopy>(() => ({
    t: (key: TextKey) => {
      const own = t(p[key]);
      // A text left blank keeps its default, except the ones that may be left out (intros, hints).
      if (own || (BLANKABLE.has(key) && typeof p[key] === 'string')) return own;
      return t(FICHA_TEXT[key]);
    },
    link: (key) => {
      const l = asLink(p[key]);
      return { ...l, label: t(l.label) };
    },
    list: (key) => asList<{ text?: string }>(p[key]).map((item) => t(item?.text)).filter(Boolean),
  }), [p, t]);
  return <FichaWizard copy={copy} onView={setView} downloadSlot={fichaPdfSlot} />;
}

const formFields = FICHA_GROUPS.flatMap(({ group, texts, links = [], lists = [] }) => grouped(group, [
  ...texts.map(([key, label]) => (LONG_TEXTS.has(key) ? f.textarea(key, label) : f.text(key, label))),
  ...lists.map(([key, label]) => f.items(key, label, [f.text('text', 'Texto')])),
  ...links.map(([key, label]) => f.link(key, label)),
]));

export const sections = [
  section({
    type: 'hero', label: 'Ficha de inscripción · Portada', description: 'Portada oscura con foto, título, subtítulo y los pasos del proceso de admisión. Solo se ve sobre el aviso «La ficha de inscripción es personal» (sin enlace), no con el enlace del colegio.',
    component: PreRegisterHeroView,
    fields: [f.text('label', 'Etiqueta superior', { hint: 'Puede usar {{ciclo}}.' }), f.text('title', 'Título', { required: true }), f.textarea('subtitle', 'Subtítulo'), f.image('image', 'Foto de fondo')],
    defaults: {
      label: 'Ciclo Escolar {{ciclo}} · Admisiones', title: 'Ficha de inscripción',
      subtitle: 'Es el último paso de la admisión: el colegio envía a cada familia admitida su enlace personal para llenarla en línea.',
      image: '/assets/hopscotch.webp',
    },
  }),
  section({
    type: 'trust', label: 'Ficha de inscripción · Franja de confianza', description: 'Franja clara bajo la portada con dos datos breves (tiempo y ciclo escolar). Solo se ve sobre el aviso «La ficha de inscripción es personal» (sin enlace).',
    component: PreRegisterTrustView,
    fields: [f.text('first', 'Dato 1'), f.icon('firstIcon', 'Ícono del dato 1'), f.text('second', 'Dato 2', { hint: 'Puede usar {{ciclo}}.' }), f.icon('secondIcon', 'Ícono del dato 2')],
    defaults: { first: 'Unos 15 minutos, puede continuar después', firstIcon: 'Clock', second: 'Ciclo Escolar {{ciclo}} o el siguiente', secondIcon: 'CalendarDays' },
  }),
  section({
    type: 'form', label: 'Ficha de inscripción · Formulario', locked: true,
    description: 'La ficha de inscripción en línea que abre el enlace personal que Admisiones envía a cada familia admitida, y el aviso «La ficha de inscripción es personal» para quien llega sin enlace. Aquí se editan los textos de alrededor (títulos, explicaciones, botones, avisos, firma y confirmación); los campos, sus opciones y sus reglas vienen de la ficha del colegio y no cambian aquí.',
    component: FichaFormView,
    fields: formFields,
    defaults: {
      ...FICHA_TEXT,
      ...FICHA_LINKS,
      ...Object.fromEntries(Object.entries(FICHA_LISTS).map(([k, items]) => [k, items.map((text) => ({ text }))])),
    },
  }),
];

export const templates = [{
  slug: 'pre-registro', path: '/pre-registro', title: 'Ficha de inscripción', group: 'preregistro',
  // RouteSeo (siteMeta ROUTE_META '/pre-registro') serves title and description until the school writes its own SEO.
  seo: {},
  sections: ['preregistro.hero', 'preregistro.trust', 'preregistro.form'],
}];

export default defineModule(sections, templates);
