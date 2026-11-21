/**
 * Documentación (/admisiones/documentacion): designed sections
 * (docs/CMS-COMPLETION-PLAN.md). The document list defaults to
 * lib/admisionesDocs, the same list Admisiones starts from.
 */
import { ArrowRight, ArrowUpRight, CheckCircle, FileText, FolderOpen } from 'lucide-react';
import { ADMISSION_DOC_ITEMS, docsSummary, type AdmissionDoc } from '@/lib/admisionesDocs';
import { imageSrc, imageSrcSet, useTokens, type CmsLink } from '../runtime';
import { asLink, asList, CmsAnchor, defineModule, f, sectionsOf } from './kit';

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

/* ── Lista de documentos y llamado ──────────────────────────────────────── */
interface ListProps { title?: string; summary?: string; items?: AdmissionDoc[]; ctaTitle?: string; ctaText?: string; cta?: CmsLink }
function DocsListView(p: ListProps) {
  const t = useTokens();
  const docs = asList<AdmissionDoc>(p.items);
  const cta = asLink(p.cta);
  return (
    <section className="bg-cream-2 py-10 sm:py-14">
      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-xl2 border border-ink/10 bg-white shadow-card">
          <div className="flex items-center gap-3 border-b border-ink/10 bg-green/5 px-5 py-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/15 text-green-dark">
              <FolderOpen className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-head text-lg font-bold text-ink">{t(p.title)}</h2>
              {p.summary && <p className="text-xs text-muted">{docsSummary(t(p.summary), docs)}</p>}
            </div>
          </div>
          <ul className="divide-y divide-ink/5">
            {docs.map((d, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-4">
                <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm text-ink">{t(d.label)}</p>
                  {d.href && (
                    <a
                      href={d.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-green-dark underline decoration-green/40 underline-offset-2 hover:decoration-green"
                    >
                      {t(d.linkLabel)} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
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
      subtitle: 'Todo lo que su familia necesita presentar para el Examen de Valoración del ciclo {{ciclo}} — con enlaces directos a los trámites oficiales.',
      image: '/assets/primaria-gate.webp',
    },
  }),
  section({
    type: 'list', label: 'Documentación · Documentos requeridos', description: 'Lista de documentos con enlaces a los trámites oficiales y un llamado a la ficha de inscripción. Esta lista es la única: Admisiones muestra la misma al publicar esta página.',
    component: DocsListView,
    fields: [
      f.text('title', 'Título de la lista'),
      f.text('summary', 'Resumen', { hint: '{total} = número de documentos; {online} = cuántos tienen enlace a un trámite en línea.' }),
      f.items('items', 'Documentos', [f.textarea('label', 'Documento', { required: true }), f.href('href', 'Enlace al trámite oficial'), f.text('linkLabel', 'Texto del enlace')]),
      f.text('ctaTitle', 'Llamado: título'),
      f.textarea('ctaText', 'Llamado: texto'),
      f.link('cta', 'Llamado: botón'),
    ],
    defaults: {
      title: 'Documentos requeridos', summary: '{total} documentos · {online} con trámite oficial en línea',
      items: ADMISSION_DOC_ITEMS,
      ctaTitle: '¿Documentos listos?',
      ctaText: 'Llene la ficha de inscripción y coordine la entrega de documentos con nuestro equipo de admisiones.',
      cta: { label: 'Llenar la ficha de inscripción', href: '/pre-registro' },
    },
  }),
];

export const templates = [{
  slug: 'documentacion', path: '/admisiones/documentacion', title: 'Documentación', group: 'documentacion',
  seo: {}, // title and description: lib/routeMeta.ts ROUTE_META
  sections: ['documentacion.hero', 'documentacion.list'],
}];

export default defineModule(sections, templates);
