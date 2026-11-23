/**
 * The generic CMS blocks (CMS-PLAN phase 2): hero, text, image, gallery, FAQ,
 * video, form... Loaded on demand by BlockRenderer only when a page uses one,
 * so the designed public pages never download them.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, ShieldCheck } from 'lucide-react';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { VideoEmbed } from '@/components/ui/VideoEmbed';
import { Testimonials } from '@/components/public/Testimonials';
import { HistoryTimeline, type Milestone } from '@/components/public/HistoryTimeline';
import { PricingSections } from '@/components/public/PricingSections';
import { CmsForm } from '../CmsForm';
import { TableBlock, type TableBlockProps } from './TableBlock';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { LEVELS } from '@/lib/levels';
import { useSep } from '@/hooks/useSep';
import { admissionsApi, contentApi, type SchoolEvent } from '@/services/api';
import { sanitizeHtml } from '../sanitize';
import { applyTokens, imageSrc, imageSrcSet, useMediaAlt } from '../runtime';
import type { Block } from './registry';

const mediaUrl = (ref: unknown, variant: 'thumb' | 'md' | 'lg' = 'lg') => imageSrc(ref, variant);
/** srcset over the library variants (320 / 960 / 1600 px) so phones download the small file (BACKLOG P2-20). */
export const mediaSrcSet = (ref: unknown) => imageSrcSet(ref, { full: true });

/** «5 de diciembre de 2026» from an ISO date (YYYY-MM-DD), read at noon so no time zone moves the day. */
export function formatDateMx(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** One generic block (CMS-PLAN phase 2). Unknown types render nothing. */
export default function GenericBlockView({ block }: { block: Block }) {
  const p = block.props as Record<string, never>;
  switch (block.type) {
    case 'hero': return <HeroBlock {...(p as unknown as HeroProps)} />;
    case 'rich_text': return <RichText html={String(p.html ?? '')} />;
    case 'image': return (
      <Section bg="white" containerSize="md">
        <figure><img src={mediaUrl(p.image)} srcSet={mediaSrcSet(p.image)} sizes="(min-width: 768px) 768px, 100vw" alt={String(p.alt ?? p.caption ?? '')} loading="lazy" decoding="async" className="w-full rounded-md" />
          {p.caption && <figcaption className="mt-2 text-center text-sm text-muted">{p.caption}</figcaption>}</figure>
      </Section>
    );
    case 'gallery': return <GalleryBlock images={(p.images as unknown as { image: number | string; caption?: string }[]) ?? []} />;
    case 'feature_grid': return (
      <Section bg="white">
        {p.title && <Reveal className="mb-8 text-center"><h2 className="font-head text-fluid-3xl font-extrabold tracking-[-0.025em] text-ink">{p.title}</h2></Reveal>}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {((p.items as unknown as { title: string; text?: string }[]) ?? []).map((it, i) => (
            <Reveal key={i} delay={i * 60}><div className="card h-full"><h3 className="font-head text-[17px] font-bold text-ink">{it.title}</h3>{it.text && <p className="mt-2 text-sm leading-relaxed text-muted">{it.text}</p>}</div></Reveal>
          ))}
        </div>
      </Section>
    );
    case 'stats': return (
      <section className="bg-dark-2 py-10 text-white">
        <div className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-4 sm:px-6 lg:grid-cols-4">
          {((p.items as unknown as { value: string; label: string }[]) ?? []).map((s, i) => (
            <div key={i} className="text-center"><div className="font-head text-3xl font-extrabold">{s.value}</div><div className="text-xs uppercase tracking-wider text-white/60">{s.label}</div></div>
          ))}
        </div>
      </section>
    );
    case 'cta_band': { const cta = (p.cta as unknown as { label?: string; href?: string }) ?? {}; return (
      <Section bg="gradient">
        <div className="text-center text-white">
          <h2 className="font-head text-fluid-3xl font-black tracking-[-0.025em]">{p.title}</h2>
          {p.text && <p className="mx-auto mt-3 max-w-xl opacity-90">{p.text}</p>}
          {cta.href && <Link to={cta.href} className="btn btn-lg mt-7 bg-white text-purple">{cta.label ?? 'Más información'} <ArrowRight size={16} aria-hidden="true" /></Link>}
        </div>
      </Section>
    ); }
    case 'faq': return (
      <Section bg="white" containerSize="md">
        <div className="divide-y divide-line rounded-md bg-white shadow-card">
          {((p.items as unknown as { q: string; a: string }[]) ?? []).map((f, i) => (
            <details key={i} className="group px-5 py-4"><summary className="cursor-pointer list-none font-semibold text-ink">{f.q}</summary><p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p></details>
          ))}
        </div>
      </Section>
    );
    case 'video': return <Section bg="white"><VideoEmbed url={String(p.url ?? '')} /></Section>;
    case 'timeline': {
      const items = ((p.items as unknown as { year: string; title: string; text?: string }[]) ?? []).filter((it) => it.year || it.title);
      return <Section bg="white"><div className="mx-auto max-w-3xl"><HistoryTimeline items={items.map((it): Milestone => ({ year: it.year, title: it.title, desc: it.text }))} /></div></Section>;
    }
    case 'levels_cards': return (
      <Section bg="white">
        <div className="grid gap-5 sm:grid-cols-3">
          {LEVELS.map((l) => (
            <Link key={l.slug} to={`/niveles/${l.slug}`} className="card hover-lift block" style={{ borderTop: `4px solid ${l.color}` }}>
              <h3 className="font-head text-lg font-bold text-ink">{l.name}</h3><p className="mt-1 text-sm text-muted">{l.intro}</p>
            </Link>
          ))}
        </div>
      </Section>
    );
    case 'testimonials': return <Section bg="cream"><Testimonials /></Section>;
    case 'map_contact': return <MapContactBlock />;
    case 'calendar': return <CalendarBlock />;
    case 'pricing_table': return <PricingSections />;
    case 'open_school_events': return <OpenSchoolBlock />;
    case 'form': return <FormBlock slug={String(p.form ?? '')} />;
    case 'sep_incorporation': return <SepBlock />;
    case 'table': return <TableBlock {...(p as unknown as TableBlockProps)} />;
    default: return null;
  }
}

interface HeroProps { title: string; subtitle?: string; image?: number; cta?: { label?: string; href?: string } }
/**
 * The page's h1, once: a second hero on the same page (or a hero under a
 * designed section that already has the h1) titles itself with an h2.
 * Decided before paint, from the headings already on the page.
 */
function useFirstH1(ref: React.RefObject<HTMLHeadingElement>): boolean {
  const [first, setFirst] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const earlier = Array.from(document.querySelectorAll('h1')).some(
      (h) => h !== el && !!(h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING),
    );
    if (earlier) setFirst(false);
  }, [ref]);
  return first;
}
function HeroBlock({ title, subtitle, image, cta }: HeroProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const H = useFirstH1(headingRef) ? 'h1' : 'h2';
  return (
    <section className="relative flex min-h-[60svh] items-end overflow-hidden bg-dark text-white">
      {image && <img src={mediaUrl(image)} srcSet={mediaSrcSet(image)} sizes="100vw" alt="" fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(8,5,22,0.35) 0%, rgba(8,5,22,0.92) 100%)' }} />
      <div className="relative mx-auto w-full max-w-6xl px-4 pb-12 pt-28 sm:px-6">
        <H ref={headingRef} className="font-head text-fluid-5xl font-black tracking-[-0.03em]">{title}</H>
        {subtitle && <p className="mt-4 max-w-2xl text-fluid-lg text-white/80">{subtitle}</p>}
        {cta?.href && <Link to={cta.href} className="btn-pink mt-7">{cta.label ?? 'Conocer más'} <ArrowRight size={16} aria-hidden="true" /></Link>}
      </div>
    </section>
  );
}

function GalleryBlock({ images }: { images: { image: number | string; caption?: string }[] }) {
  const altOf = useMediaAlt();
  return (
    // A row-ordered grid of 4:3 tiles: the space is reserved before each photo
    // loads (no layout shift) and the reading and Tab order runs by row.
    <Section bg="cream">
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {images.filter((im) => im.image).map((im, i) => (
          <li key={i} className="overflow-hidden rounded-md bg-white shadow-card">
            <div className="aspect-[4/3] bg-cream-2">
              <img src={mediaUrl(im.image, 'md')} srcSet={mediaSrcSet(im.image)} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" alt={altOf(im.image, im.caption ?? '')} loading="lazy" decoding="async" width={960} height={720} className="h-full w-full object-cover" />
            </div>
            {im.caption && <p className="px-3 py-2 text-sm text-muted">{im.caption}</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function SepBlock() {
  const rows = useSep();
  return (
    <Section bg="cream" containerSize="md">
      <ul className="space-y-2">{rows.map((r) => (
        <li key={r.level} className="flex items-start gap-2 text-sm text-ink"><ShieldCheck size={16} className="mt-0.5 text-green-dark" aria-hidden="true" /> {r.label}</li>
      ))}</ul>
    </Section>
  );
}

/** Site-wide snippets usable inside rich text: {{direccion}}, {{horario}}, {{telefono}}, {{correo}}, {{whatsapp}}, {{ciclo}}, {{anios}}... */
export function applySnippets(html: string, s: Record<string, string | undefined>): string {
  return applyTokens(html, s);
}

function RichText({ html }: { html: string }) {
  const settings = useSiteSettings();
  const safe = useMemo(() => sanitizeHtml(applySnippets(html, settings as unknown as Record<string, string | undefined>)), [html, settings]);
  return <Section bg="white" containerSize="md"><div className="cms-rich prose prose-sm max-w-none text-ink sm:prose-base" dangerouslySetInnerHTML={{ __html: safe }} /></Section>;
}

function MapContactBlock() {
  const s = useSiteSettings();
  return (
    <Section bg="white" containerSize="md">
      <div className="card"><p className="font-semibold text-ink">{s.address}</p><p className="mt-1 text-sm text-muted">{s.phone_display} · {s.contact_email} · {s.office_hours}</p>
        {s.maps_url && <a href={s.maps_url} target="_blank" rel="noopener noreferrer" className="btn-outline mt-4">Cómo llegar</a>}</div>
    </Section>
  );
}

function CalendarBlock() {
  const { data } = useQuery({ queryKey: ['school-calendar', 'block'], queryFn: async () => (await contentApi.getCalendar()).data as SchoolEvent[], staleTime: 300_000 });
  const next = (data ?? []).slice(0, 5);
  if (!next.length) return null;
  return (
    <Section bg="cream" containerSize="md">
      <h2 className="mb-4 flex items-center gap-2 font-head text-xl font-bold text-ink"><CalendarDays size={20} className="text-purple" aria-hidden="true" /> Próximas fechas</h2>
      <ul className="divide-y divide-line rounded-md bg-white shadow-card">{next.map((e) => (
        <li key={e.id} className="flex justify-between gap-3 px-4 py-3 text-base"><span className="text-ink">{e.title}</span><time dateTime={e.start_date} className="shrink-0 text-sm text-muted">{formatDateMx(e.start_date)}</time></li>
      ))}</ul>
    </Section>
  );
}

interface OpenClassEvent { id: number; date: string; title: string; description?: string; spots_remaining: number }
function OpenSchoolBlock() {
  const { data } = useQuery({ queryKey: ['open-school-events', 'block'], queryFn: async () => (await admissionsApi.getOpenSchoolEvents()).data as OpenClassEvent[], staleTime: 300_000 });
  const events = data ?? [];
  return (
    <Section bg="white" containerSize="md">
      <h2 className="mb-4 font-head text-xl font-bold text-ink">Clases abiertas</h2>
      {events.length === 0 ? <p className="text-sm text-muted">Por ahora no hay clases abiertas programadas. Puede agendar una visita individual.</p> : (
        <ul className="divide-y divide-line rounded-md bg-white shadow-card">{events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="text-base font-semibold text-ink">{e.title}</p><p className="text-muted"><time dateTime={e.date}>{formatDateMx(e.date)}</time>{e.description ? ` · ${e.description}` : ''}</p></div><span className="shrink-0 text-sm text-subtle">{e.spots_remaining} lugares</span></li>
        ))}</ul>
      )}
      <Link to="/agendar-visita" className="btn-pink mt-5">Agendar visita <ArrowRight size={16} aria-hidden="true" /></Link>
    </Section>
  );
}

/**
 * Form block: a CMS-built form by slug, or a link to one of the built-in (code) forms.
 * 'pre-registro' is no longer offered (the ficha is private, sent by the school
 * after admission): a block that still names it shows «Agendar visita».
 */
const BUILTIN_FORMS: Record<string, { label: string; to: string }> = {
  'pre-registro': { label: 'Agendar visita', to: '/agendar-visita' },
  'contacto': { label: 'Escribirnos', to: '/contacto' },
  'facturacion': { label: 'Solicitar factura', to: '/comunidad/facturacion' },
  'agendar-visita': { label: 'Agendar visita', to: '/agendar-visita' },
};
function FormBlock({ slug }: { slug: string }) {
  const f = BUILTIN_FORMS[slug];
  if (f) return <Section bg="cream" containerSize="md"><div className="text-center"><Link to={f.to} className="btn-pink">{f.label} <ArrowRight size={16} aria-hidden="true" /></Link></div></Section>;
  if (!slug) return null;
  return <Section bg="cream" containerSize="md"><div className="card"><CmsForm slug={slug} /></div></Section>;
}

