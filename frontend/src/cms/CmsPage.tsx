import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CalendarDays, ShieldCheck } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { Section } from '@/components/ui/Section';
import { Reveal } from '@/components/ui/Reveal';
import { VideoEmbed } from '@/components/ui/VideoEmbed';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Testimonials } from '@/components/public/Testimonials';
import { HistoryTimeline } from '@/components/public/HistoryTimeline';
import { PricingSections } from '@/pages/public/CostosPage';
import { CmsForm } from './CmsForm';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { LEVELS } from '@/lib/levels';
import { useSep } from '@/hooks/useSep';
import { admissionsApi, contentApi, type SchoolEvent } from '@/services/api';
import { sanitizeHtml } from './sanitize';
import type { Block } from './blocks/registry';

export interface CmsPagePayload {
  slug: string;
  title: string;
  template: string;
  blocks: Block[];
  seo: { title?: string; description?: string; og_image?: string; noindex?: boolean };
  published_at: string | null;
}

const mediaUrl = (id: unknown, variant = 'lg') => (typeof id === 'number' ? `/api/v1/content/media/${id}/${variant}/` : '');

/** Renders a list of blocks. Unknown types render nothing (never crash the page). */
export function BlockRenderer({ blocks, editing = false, onSelect }: { blocks: Block[]; editing?: boolean; onSelect?: (id: string) => void }) {
  return (
    <>
      {blocks.map((b) => (
        <div
          key={b.id}
          data-block-id={b.id}
          data-block-type={b.type}
          role={editing ? 'button' : undefined}
          tabIndex={editing ? 0 : undefined}
          onClick={editing ? (e) => { e.preventDefault(); onSelect?.(b.id); } : undefined}
          onKeyDown={editing ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(b.id); } } : undefined}
          className={editing ? 'relative cursor-pointer outline-offset-2 hover:outline hover:outline-2 hover:outline-purple/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple' : undefined}
        >
          {editing && <span className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-purple px-2 py-0.5 text-[10px] font-bold text-white">{b.type}</span>}
          <BlockView block={b} />
        </div>
      ))}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  const p = block.props as Record<string, never>;
  switch (block.type) {
    case 'hero': return <HeroBlock {...(p as unknown as HeroProps)} />;
    case 'rich_text': return <RichText html={String(p.html ?? '')} />;
    case 'image': return (
      <Section bg="white" containerSize="md">
        <figure><img src={mediaUrl(p.image)} alt={String(p.alt ?? p.caption ?? '')} loading="lazy" className="w-full rounded-xl2" />
          {p.caption && <figcaption className="mt-2 text-center text-sm text-muted">{p.caption}</figcaption>}</figure>
      </Section>
    );
    case 'gallery': return (
      <Section bg="cream">
        <ul className="columns-1 gap-4 sm:columns-2 lg:columns-3">
          {((p.images as unknown as { image: number; caption?: string }[]) ?? []).map((im, i) => (
            <li key={i} className="mb-4 break-inside-avoid overflow-hidden rounded-2xl bg-white shadow-card">
              <img src={mediaUrl(im.image, 'md')} alt={im.caption ?? ''} loading="lazy" className="w-full object-cover" />
              {im.caption && <p className="px-3 py-2 text-xs text-muted">{im.caption}</p>}
            </li>
          ))}
        </ul>
      </Section>
    );
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
          {cta.href && <Link to={cta.href} className="btn btn-lg mt-7 bg-white text-purple">{cta.label ?? 'Más información'} <ArrowRight size={17} /></Link>}
        </div>
      </Section>
    ); }
    case 'faq': return (
      <Section bg="white" containerSize="md">
        <div className="divide-y divide-line rounded-xl2 border border-line bg-white">
          {((p.items as unknown as { q: string; a: string }[]) ?? []).map((f, i) => (
            <details key={i} className="group px-5 py-4"><summary className="cursor-pointer list-none font-semibold text-ink">{f.q}</summary><p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p></details>
          ))}
        </div>
      </Section>
    );
    case 'video': return <Section bg="white"><VideoEmbed url={String(p.url ?? '')} /></Section>;
    case 'timeline': return <Section bg="white"><div className="mx-auto max-w-3xl"><HistoryTimeline /></div></Section>;
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
    default: return null;
  }
}

interface HeroProps { title: string; subtitle?: string; image?: number; cta?: { label?: string; href?: string } }
function HeroBlock({ title, subtitle, image, cta }: HeroProps) {
  return (
    <section className="relative flex min-h-[60svh] items-end overflow-hidden bg-dark text-white">
      {image && <img src={mediaUrl(image)} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(8,5,22,0.35) 0%, rgba(8,5,22,0.92) 100%)' }} />
      <div className="relative mx-auto w-full max-w-6xl px-4 pb-12 pt-28 sm:px-6">
        <h1 className="font-head text-fluid-5xl font-black tracking-[-0.03em]">{title}</h1>
        {subtitle && <p className="mt-4 max-w-2xl text-fluid-lg text-white/80">{subtitle}</p>}
        {cta?.href && <Link to={cta.href} className="btn-pink mt-7">{cta.label ?? 'Conocer más'} <ArrowRight size={16} /></Link>}
      </div>
    </section>
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

/** Site-wide snippets usable inside rich text: {{direccion}}, {{horario}}, {{telefono}}, {{correo}}, {{whatsapp}}. */
export function applySnippets(html: string, s: Record<string, string | undefined>): string {
  const map: Record<string, string> = { direccion: s.address ?? '', horario: s.office_hours ?? '', telefono: s.phone_display ?? '', correo: s.contact_email ?? '', whatsapp: s.whatsapp_number ?? '' };
  return html.replace(/\{\{\s*(direccion|horario|telefono|correo|whatsapp)\s*\}\}/g, (_, k: string) => map[k]);
}

function RichText({ html }: { html: string }) {
  const settings = useSiteSettings();
  const safe = useMemo(() => sanitizeHtml(applySnippets(html, settings as unknown as Record<string, string | undefined>)), [html, settings]);
  return <Section bg="white" containerSize="md"><div className="prose prose-sm max-w-none text-ink sm:prose-base" dangerouslySetInnerHTML={{ __html: safe }} /></Section>;
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
      <ul className="divide-y divide-line rounded-xl2 border border-line bg-white">{next.map((e) => (
        <li key={e.id} className="flex justify-between gap-3 px-4 py-3 text-sm"><span className="text-ink">{e.title}</span><span className="text-muted">{e.start_date}</span></li>
      ))}</ul>
      <Link to="/calendario" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-purple">Ver calendario completo <ArrowRight size={14} /></Link>
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
        <ul className="divide-y divide-line rounded-xl2 border border-line bg-white">{events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm"><div><p className="font-semibold text-ink">{e.title}</p><p className="text-muted">{e.date}{e.description ? ` · ${e.description}` : ''}</p></div><span className="shrink-0 text-xs text-subtle">{e.spots_remaining} lugares</span></li>
        ))}</ul>
      )}
      <Link to="/agendar-visita" className="btn-pink mt-5">Agendar visita <ArrowRight size={16} /></Link>
    </Section>
  );
}

/** Form block: a CMS-built form by slug, or a link to one of the built-in (code) forms. */
const BUILTIN_FORMS: Record<string, { label: string; to: string }> = {
  'pre-registro': { label: 'Ir al pre-registro', to: '/pre-registro' },
  'contacto': { label: 'Escribirnos', to: '/contacto' },
  'facturacion': { label: 'Solicitar factura', to: '/comunidad/facturacion' },
  'agendar-visita': { label: 'Agendar visita', to: '/agendar-visita' },
};
function FormBlock({ slug }: { slug: string }) {
  const f = BUILTIN_FORMS[slug];
  if (f) return <Section bg="cream" containerSize="md"><div className="text-center"><Link to={f.to} className="btn-pink">{f.label} <ArrowRight size={16} /></Link></div></Section>;
  if (!slug) return null;
  return <Section bg="cream" containerSize="md"><div className="card"><CmsForm slug={slug} /></div></Section>;
}

/** Route element: renders a published CMS page by slug, or the draft when ?preview=<token>. */
export default function CmsPage({ slug: slugProp }: { slug?: string }) {
  const [params] = useSearchParams();
  const preview = params.get('preview');
  const slug = slugProp ?? window.location.pathname.replace(/^\//, '').replace(/\/$/, '');
  const { data, isLoading, isError } = useQuery({
    queryKey: ['cms-page', slug, preview],
    queryFn: async () => (preview
      ? (await contentApi.getPagePreviewBySlug(slug, preview)).data
      : (await contentApi.getPage(slug)).data) as CmsPagePayload,
    retry: false,
    staleTime: 60_000,
  });
  if (isLoading) return <div className="flex min-h-[50vh] items-center justify-center"><LoadingSpinner /></div>;
  if (isError || !data) return null;
  return (
    <div>
      <Seo title={data.seo?.title || data.title} description={data.seo?.description || ''} />
      {preview && <div className="sticky top-0 z-40 bg-amber px-4 py-2 text-center text-xs font-bold text-white">Vista previa del borrador: lo que ve aquí aún no está publicado.</div>}
      <BlockRenderer blocks={data.blocks} />
    </div>
  );
}
