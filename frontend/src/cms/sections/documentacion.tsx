/**
 * Documentación (/admisiones/documentacion): designed sections
 * (docs/CMS-COMPLETION-PLAN.md). The document list is the one Admisiones
 * edits (Admin → Admisiones → Documentos requeridos, Fase 4), read from
 * /admissions/required-documents/ with a tab per level; the headings, the
 * summary and the call to action are CMS copy.
 */
import { useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, CheckCircle, FileText, FolderOpen, Package, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { usePublicRequiredDocs, type LevelCode } from '@/hooks/queries/requiredDocsPublic';
import { LEVELS, docsForLevel, docsSummary, levelLabel } from '@/lib/requiredDocs';
import { imageSrc, imageSrcSet, useTokens, type CmsLink } from '../runtime';
import { asLink, CmsAnchor, defineModule, f, sectionsOf, VISIT_CTA } from './kit';

const section = sectionsOf('documentacion');

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; title?: string; subtitle?: string; image?: number | string }
function DocsHeroView(p: HeroProps) {
  const t = useTokens();
  return (
    <section className="relative overflow-hidden bg-dark text-white">
      {p.image && <img src={imageSrc(p.image)} srcSet={imageSrcSet(p.image, { full: true })} sizes="100vw" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />}
      <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
      <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        {p.label && <span className="section-label-pink inline-flex">{t(p.label)}</span>}
        <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">{t(p.title)}</h1>
        {p.subtitle && <p className="mt-3 max-w-2xl text-[15.5px] text-white/80">{t(p.subtitle)}</p>}
      </div>
    </section>
  );
}

/* ── Lista de documentos por nivel y llamado ────────────────────────────── */
interface ListProps {
  title?: string; summary?: string; tabsLabel?: string; physicalLabel?: string; emptyText?: string;
  errorTitle?: string; errorText?: string; retryLabel?: string;
  ctaTitle?: string; ctaText?: string; cta?: CmsLink;
}

const isLevel = (v: string | null): v is LevelCode => LEVELS.some((l) => l.value === v);

function DocsListView(p: ListProps) {
  const t = useTokens();
  const [params] = useSearchParams();
  const fromUrl = params.get('nivel');
  const [level, setLevel] = useState<LevelCode>(isLevel(fromUrl) ? fromUrl : 'preescolar');
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const { data, isLoading, isError, refetch, isFetching } = usePublicRequiredDocs();
  const docs = docsForLevel(data?.results ?? [], level);
  const cta = asLink(p.cta);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = LEVELS.length - 1;
    const next = e.key === 'ArrowRight' ? (i === last ? 0 : i + 1)
      : e.key === 'ArrowLeft' ? (i === 0 ? last : i - 1)
      : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    setLevel(LEVELS[next].value);
    tabs.current[next]?.focus();
  };

  return (
    <section className="bg-cream-2 py-10 sm:py-14">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-xl2 border border-ink/10 bg-white shadow-card">
          <div className="flex items-center gap-3 border-b border-ink/10 bg-green/5 px-5 py-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green/15 text-green-dark">
              <FolderOpen className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="font-head text-lg font-bold text-ink">{t(p.title)}</h2>
              {p.summary && data && <p className="text-xs text-muted">{docsSummary(t(p.summary), docs, levelLabel(level))}</p>}
            </div>
          </div>

          <div role="tablist" aria-label={t(p.tabsLabel) || 'Nivel educativo'} className="flex gap-1 overflow-x-auto border-b border-ink/10 px-3 pt-2 sm:px-4">
            {LEVELS.map((l, i) => {
              const on = l.value === level;
              return (
                <button
                  key={l.value}
                  ref={(el) => { tabs.current[i] = el; }}
                  type="button"
                  role="tab"
                  id={`docs-tab-${l.value}`}
                  aria-selected={on}
                  aria-controls="docs-tabpanel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => setLevel(l.value)}
                  onKeyDown={(e) => onKey(e, i)}
                  className={clsx(
                    '-mb-px inline-flex min-h-[44px] shrink-0 items-center border-b-2 px-3.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green/40',
                    on ? 'border-green-strong text-green-dark' : 'border-transparent text-muted hover:text-ink',
                  )}
                >
                  {l.label}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id="docs-tabpanel" aria-labelledby={`docs-tab-${level}`} aria-busy={isLoading || undefined}>
            {isError && !data ? (
              <div className="px-5 py-8 text-center" role="alert">
                <p className="font-semibold text-ink">{t(p.errorTitle)}</p>
                {p.errorText && <p className="mt-1 text-sm text-muted">{t(p.errorText)}</p>}
                <button type="button" onClick={() => refetch()} disabled={isFetching} className="btn-outline mt-4">
                  <RefreshCw className="h-4 w-4" aria-hidden="true" /> {t(p.retryLabel)}
                </button>
              </div>
            ) : isLoading || !data ? (
              <ul className="divide-y divide-ink/5" aria-hidden="true">
                {Array.from({ length: 10 }).map((_, i) => (
                  <li key={i} className="flex items-start gap-3 px-5 py-4">
                    <span className="skeleton mt-0.5 h-4 w-4 shrink-0 rounded-full" />
                    <span className="skeleton h-4 rounded" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
                  </li>
                ))}
              </ul>
            ) : docs.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">{t(p.emptyText)}</p>
            ) : (
              <ul className="divide-y divide-ink/5">
                {docs.map((d) => (
                  <li key={d.key} className="flex items-start gap-3 px-5 py-4">
                    <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">{d.name}</p>
                      {d.description && <p className="mt-0.5 text-sm text-muted">{d.description}</p>}
                      {d.physical_note && (
                        <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-subtle">
                          <Package className="h-3.5 w-3.5" aria-hidden="true" /> {t(p.physicalLabel)} <span className="text-ink/80">{d.physical_note}</span>
                        </p>
                      )}
                      {d.link_url && (
                        <a
                          href={d.link_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 flex w-fit items-center gap-1 text-sm font-semibold text-green-dark underline decoration-green/40 underline-offset-2 hover:decoration-green"
                        >
                          {d.link_label} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {(p.ctaTitle || p.ctaText || cta.href) && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-xl2 border border-green/25 bg-green/5 px-6 py-7 text-center">
            <FileText className="h-7 w-7 text-green-dark" aria-hidden="true" />
            {p.ctaTitle && <p className="font-head text-lg font-bold text-ink">{t(p.ctaTitle)}</p>}
            {p.ctaText && <p className="max-w-md text-sm text-muted">{t(p.ctaText)}</p>}
            <CmsAnchor link={cta} className="btn-pink mt-1">
              {t(cta.label)} <ArrowRight size={16} aria-hidden="true" />
            </CmsAnchor>
          </div>
        )}
      </div>
    </section>
  );
}

export const sections = [
  section({
    type: 'hero', label: 'Documentación · Portada', description: 'Foto con velo oscuro, etiqueta, título y texto de introducción.',
    component: DocsHeroView,
    fields: [
      f.text('label', 'Etiqueta superior'),
      f.text('title', 'Título', { required: true }),
      f.textarea('subtitle', 'Texto', { hint: '{{ciclo}} muestra el ciclo escolar vigente.' }),
      f.image('image', 'Foto'),
    ],
    defaults: {
      label: 'Admisiones', title: 'Documentación',
      subtitle: 'Todo lo que su familia necesita presentar para el Examen de Valoración del ciclo {{ciclo}}, según el nivel, con enlaces directos a los trámites oficiales.',
      image: '/assets/primaria-gate.webp',
    },
  }),
  section({
    type: 'list', label: 'Documentación · Documentos requeridos', description: 'La lista de documentos por nivel (Preescolar, Primaria, Secundaria) con lo que se entrega en físico y los enlaces a los trámites oficiales, y un llamado a agendar una visita. Los documentos se editan en Admisiones → Documentos requeridos: es la misma lista que ven las familias al subir sus documentos.',
    component: DocsListView,
    fields: [
      f.action('editList', 'Editar la lista de documentos', '/admin/admisiones/documentos', { hint: 'Los documentos, sus niveles y lo que se entrega en físico se editan en «Documentos requeridos». Aquí, los textos que los acompañan.' }),
      f.text('title', 'Título de la lista'),
      f.text('summary', 'Resumen', { hint: '{total} = documentos del nivel elegido; {nivel} = el nivel; {online} = cuántos tienen enlace a un trámite en línea.' }),
      f.text('tabsLabel', 'Pestañas de nivel (lectores de pantalla)'),
      f.text('physicalLabel', 'Antes de lo que se entrega en físico'),
      f.text('emptyText', 'Si un nivel no tiene documentos'),
      f.text('errorTitle', 'Si no carga la lista: título'),
      f.text('errorText', 'Si no carga la lista: texto'),
      f.text('retryLabel', 'Si no carga la lista: botón'),
      f.text('ctaTitle', 'Llamado: título'),
      f.textarea('ctaText', 'Llamado: texto'),
      f.link('cta', 'Llamado: botón'),
    ],
    defaults: {
      title: 'Documentos requeridos', summary: '{total} documentos para {nivel} · {online} con trámite oficial en línea',
      tabsLabel: 'Nivel educativo', physicalLabel: 'En físico:',
      emptyText: 'Por ahora no hay documentos publicados para este nivel. Consulte a admisiones.',
      errorTitle: 'No se pudo cargar la lista de documentos', errorText: 'Revise su conexión e intente de nuevo, o escríbanos.', retryLabel: 'Reintentar',
      ctaTitle: '¿Listo para conocernos?',
      ctaText: 'Agende una visita guiada. Después del examen de valoración, si su hijo/a es admitido, le enviamos su ficha de inscripción y coordinamos con usted la entrega de documentos.',
      cta: VISIT_CTA,
    },
  }),
];

export const templates = [{
  slug: 'documentacion', path: '/admisiones/documentacion', title: 'Documentación', group: 'documentacion',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['documentacion.hero', 'documentacion.list'],
}];

export default defineModule(sections, templates);
