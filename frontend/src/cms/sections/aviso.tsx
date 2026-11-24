/**
 * Aviso de privacidad (/aviso-de-privacidad): designed sections
 * (docs/CMS-COMPLETION-PLAN.md). The legal text comes from legalApi, versioned
 * for consent, and is never edited here: the notice renderer is a locked
 * section. Only the hero and the frame copy around the notice are props.
 *
 * Media round (owner 2026-11-22), light touch for a legal page: one quiet
 * illustration beside the introduction on computers; the text is unchanged.
 */
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  BellRing, Building2, ChevronDown, ExternalLink, FileText, Phone,
  Share2, ShieldCheck, SlidersHorizontal, Target, Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { legalApi } from '@/services/api';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { Section } from '@/components/ui/Section';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { PhotoHero } from '@/components/public/PhotoHero';
import { Illustration } from '@/components/ui/Illustration';
import { isIllustration } from '@/lib/illustrations';
import { iconResolver } from '../iconRuntime';
import { useTokens } from '../runtime';
import { asList, defineModule, f, sectionsOf } from './kit';
import { displayTitle, parseNotice } from '@/lib/noticeText';

export { parseNotice };

/** The icons this module's defaults use; any other curated icon loads on demand. */
const cmsIcon = iconResolver({ Building2, Phone, ShieldCheck });

const section = sectionsOf('aviso');

export interface PrivacyNotice {
  version: string;
  title: string;
  body: string;
  integral_notice_url: string;
  effective_date: string;
}

/** Both sections read the same query, so the notice is fetched once. */
function useNotice() {
  return useQuery<PrivacyNotice>({
    queryKey: ['legal-notice'],
    queryFn: async () => {
      const { data } = await legalApi.getNotice();
      return data as PrivacyNotice;
    },
    staleTime: 60 * 60 * 1000,
  });
}

/** The icon the page shows next to a part of the notice (also used by the console editor). */
export function sectionIcon(title: string): LucideIcon {
  const t = title.toUpperCase();
  if (t.includes('FINES')) return Target;
  if (t.includes('QUÉ DATOS')) return FileText;
  if (t.includes('COMPARTIMOS')) return Share2;
  if (t.includes('ACCEDER')) return ShieldCheck;
  if (t.includes('REVOCAR')) return Undo2;
  if (t.includes('LIMITAR')) return SlidersHorizontal;
  if (t.includes('CAMBIOS')) return BellRing;
  return FileText;
}

/* ── Portada ────────────────────────────────────────────────────────────── */
interface HeroProps { label?: string; labelClass?: string; title?: string; image?: number | string; opacity?: number; dateLabel?: string; versionLabel?: string }
function AvisoHeroView(p: HeroProps) {
  const { data } = useNotice();
  return <AvisoHero {...p} data={data} />;
}

/** The hero for a given notice: the public page, and the console preview of a draft. */
export function AvisoHero({ data, ...p }: HeroProps & { data?: PrivacyNotice }) {
  const t = useTokens();
  return (
    <PhotoHero
      label={t(p.label)}
      labelClass={p.labelClass || 'section-label-pink'}
      image={p.image ?? ''}
      opacity={typeof p.opacity === 'number' ? p.opacity : 0.25}
      title={data?.title ?? t(p.title)}
    >
        {data?.effective_date && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/60">
            <ShieldCheck size={16} aria-hidden="true" />
            {t(p.dateLabel)}{' '}
            {(() => {
              try {
                return format(parseISO(data.effective_date), "d 'de' MMMM 'de' yyyy", { locale: es });
              } catch {
                return data.effective_date;
              }
            })()}
            {data.version && ` · ${t(p.versionLabel)} ${data.version}`}
          </p>
        )}
    </PhotoHero>
  );
}

/* ── Texto oficial (bloqueado) ──────────────────────────────────────────── */
interface CardItem { icon?: string; label?: string; value?: string }
interface NoticeProps { cards?: CardItem[]; note?: string; integralLabel?: string; errorTitle?: string; errorText?: string; illustration?: string }
/** Drops the empty parts of a «a · b» line (e.g. a phone or email not set in Ajustes). */
const joinParts = (v: string) => v.split(' · ').filter((s) => s.trim()).join(' · ');

function AvisoNoticeView(p: NoticeProps) {
  const { data, isLoading, isError } = useNotice();
  return <AvisoNoticeBody {...p} data={data} isLoading={isLoading} isError={isError} />;
}

/** The summary cards and the official text of a given notice (public page and console preview). */
export function AvisoNoticeBody({ data, isLoading = false, isError = false, ...p }: NoticeProps & { data?: PrivacyNotice; isLoading?: boolean; isError?: boolean }) {
  // Contact data comes from the admin-editable site settings (CMS Phase 1) —
  // never hardcoded, so the page always matches the site chrome.
  const t = useTokens();
  const settings = useSiteSettings();
  const cards = asList<CardItem>(p.cards);

  const parsed = data?.body ? parseNotice(data.body) : null;
  const structured = (parsed?.sections.length ?? 0) >= 3;
  // «none» hides it; content saved before the field existed shows the padlock.
  const art = p.illustration === 'none' ? undefined : isIllustration(p.illustration) ? p.illustration : 'acceso';

  return (
    <Section bg="white" container={false}>
      {/* Ancho de contenido igual al del pie de página y la barra de navegación (max-w-6xl). */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {isLoading ? (
        <div className="py-10">
          <LoadingSpinner />
        </div>
      ) : isError || !data?.body ? (
        <EmptyState
          title={t(p.errorTitle) || 'Aviso no disponible'}
          description={p.errorText ? t(p.errorText) : `No fue posible cargar el Aviso de Privacidad en este momento. Intente de nuevo más tarde${settings.contact_email ? ` o escríbanos a ${settings.contact_email}` : ''}.`}
        />
      ) : (
        <div>
          {/* Resumen rápido — informativo; el texto oficial rige abajo */}
          {cards.length > 0 && (
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
              {cards.map((c, i) => {
                const Icon = cmsIcon(c.icon, FileText);
                return (
                  <div key={i} className="rounded-md bg-cream-2 p-4">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-subtle">
                      <Icon className="h-3.5 w-3.5 text-green-dark" aria-hidden="true" /> {t(c.label)}
                    </p>
                    <p className="mt-1.5 text-sm font-medium leading-snug text-ink">{joinParts(t(c.value))}</p>
                  </div>
                );
              })}
            </div>
          )}

          {p.note && (
            <p className="mb-6 text-xs text-muted print:hidden">
              {t(p.note)}
            </p>
          )}

          {structured && parsed ? (
            <>
              <div className="lg:grid lg:grid-cols-12 lg:items-center lg:gap-10">
                <div className="lg:col-span-8">
                  {parsed.intro.map((para) => (
                    <p key={para.slice(0, 40)} className="mb-4 whitespace-pre-line text-[15px] leading-relaxed text-ink/90">
                      {para}
                    </p>
                  ))}
                </div>
                {art && (
                  <div className="hidden justify-center lg:col-span-4 lg:flex print:hidden">
                    <div className="flex h-52 w-52 items-center justify-center rounded-full bg-cream-2">
                      <Illustration name={art} size={150} />
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-6 space-y-3">
                {parsed.sections.map((s, i) => {
                  const Icon = sectionIcon(s.title);
                  return (
                    <details
                      key={s.title}
                      open={i === 0}
                      className="group rounded-md bg-white open:shadow-card shadow-card"
                    >
                      <summary className="flex min-h-[52px] cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm bg-green/10 text-green-dark">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="flex-1 text-sm font-semibold normal-case text-ink">
                          {displayTitle(s.title)}
                        </span>
                        <ChevronDown
                          className="h-4 w-4 flex-shrink-0 text-subtle transition-transform group-open:rotate-180 motion-reduce:transition-none"
                          aria-hidden="true"
                        />
                      </summary>
                      <div className="border-t border-ink/5 px-4 py-4 sm:px-[60px]">
                        {s.paragraphs.map((para) => (
                          <p key={para.slice(0, 40)} className="mb-3 whitespace-pre-line text-[15px] leading-relaxed text-ink/90 last:mb-0">
                            {para}
                          </p>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="whitespace-pre-line text-[15px] leading-relaxed text-ink/90">
              {data.body}
            </div>
          )}

          {data.integral_notice_url && (
            <a
              href={data.integral_notice_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-outline mt-8 focus-visible:ring-2 focus-visible:ring-purple focus-visible:ring-offset-2"
            >
              {t(p.integralLabel) || 'Consultar el aviso integral'} <ExternalLink size={16} />
            </a>
          )}
        </div>
      )}
      </div>
    </Section>
  );
}

const LABEL_STYLES = [
  { value: 'section-label-pink', label: 'Rosa' },
  { value: 'section-label-purple', label: 'Morado' },
  { value: 'section-label-green', label: 'Verde' },
];

export const sections = [
  section({
    type: 'hero', label: 'Aviso de privacidad · Portada',
    description: 'Foto con velo oscuro y etiqueta. El título y la fecha de vigencia salen del aviso oficial; el título de aquí solo se usa si el aviso no tiene.',
    component: AvisoHeroView,
    fields: [
      f.text('label', 'Etiqueta superior'),
      f.select('labelClass', 'Color de la etiqueta', LABEL_STYLES),
      f.text('title', 'Título de respaldo', { hint: 'Solo se ve si el aviso oficial no trae título.' }),
      f.image('image', 'Foto'),
      f.number('opacity', 'Visibilidad de la foto (0 a 1)'),
      f.text('dateLabel', 'Texto antes de la fecha'),
      f.text('versionLabel', 'Texto antes de la versión'),
    ],
    defaults: {
      label: 'Legal', labelClass: 'section-label-pink', title: 'Aviso de Privacidad', image: '/assets/facade.webp', opacity: 0.25,
      dateLabel: 'Vigente desde el', versionLabel: 'Versión',
    },
  }),
  section({
    type: 'notice', label: 'Aviso de privacidad · Texto oficial', locked: true,
    description: 'Resumen y texto oficial del aviso. El texto legal se edita en «Aviso de privacidad» (menú Contenido del sitio): cada versión publicada queda guardada con los consentimientos que recibió.',
    component: AvisoNoticeView,
    fields: [
      f.items('cards', 'Tarjetas de resumen', [f.icon('icon'), f.text('label', 'Etiqueta', { required: true }), f.text('value', 'Texto', { hint: 'Puede usar {{telefono}} y {{correo}}.' })]),
      f.text('note', 'Nota sobre el resumen'),
      f.text('integralLabel', 'Botón del aviso integral'),
      f.text('errorTitle', 'Título si el aviso no carga'),
      f.textarea('errorText', 'Texto si el aviso no carga'),
      f.illustration('illustration', 'Ilustración', { hint: 'Junto a la introducción, solo en computadora. Sin elegir, el candado con llave.' }),
    ],
    defaults: {
      cards: [
        { icon: 'Building2', label: 'Responsable', value: 'ADCE EDUCACIÓN, A.C. (Colegio Interlaken)' },
        { icon: 'ShieldCheck', label: 'Sus derechos', value: 'Acceso · Rectificación · Cancelación · Oposición (ARCO)' },
        { icon: 'Phone', label: 'Ejercerlos', value: '{{telefono}} · {{correo}}' },
      ],
      note: 'Resumen informativo: el texto oficial completo es el siguiente.',
      integralLabel: 'Consultar el aviso integral',
      errorTitle: 'Aviso no disponible',
      errorText: '',
      illustration: 'acceso',
    },
  }),
];

export const templates = [{
  slug: 'aviso-de-privacidad', path: '/aviso-de-privacidad', title: 'Aviso de privacidad', group: 'aviso',
  seo: {},
  sections: ['aviso.hero', 'aviso.notice'],
}];

export default defineModule(sections, templates);
