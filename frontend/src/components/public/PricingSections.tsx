import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CircleDollarSign, Clock, GraduationCap, Hourglass, Info,
  ShieldCheck, Sparkles, Wallet,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi } from '@/services/api';
import { formatPrice } from '@/lib/format';
import { useTokens, type CmsLink } from '@/cms/runtime';
import { CmsAnchor, INFORMES_CTA, VISIT_CTA } from '@/cms/sections/kit';

interface EnrollmentFee {
  section: string;
  modality: 'nuevo_ingreso' | 'reinscripcion';
  gastos_administrativos: string;
  cuota: string;
  order: number;
}
interface TuitionRow { section: string; colegiatura: string; order: number }
interface FixedConcept { name: string; cost: string; mandatory: boolean; order: number }
interface Extracurricular { name: string; levels: string; annual_cost: string; order: number }
interface DaycareRate {
  schedule: string; service: string; daily_cost: string;
  monthly_cost: string | null; monthly_note: string; order: number;
}
interface PricingPolicy { text: string; order: number }
interface PricingBundle {
  enrollment_fees: EnrollmentFee[];
  tuition: TuitionRow[];
  fixed_concepts: FixedConcept[];
  extracurriculars: Extracurricular[];
  daycare: DaycareRate[];
  policies: PricingPolicy[];
}

const mxn = formatPrice;

/**
 * The copy around and inside the price tables: card titles, notes, column
 * headers and the fixed labels («/ mes», «/ año»...). The figures come from
 * the API (console «Costos y precios», /admin/costos); this text is editable
 * from the CMS `costos.prices` section. Any key left out keeps today's text,
 * so the generic `pricing_table` block renders exactly as before.
 */
export interface PricingCopy {
  emptyTitle: string; emptyText: string; emptyPrimary: CmsLink; emptySecondary: CmsLink;
  structureTitle: string; structure: { title?: string; text?: string }[];
  feesLabel: string; feesTitle: string; feesSubtitle: string; newTag: string; returningTag: string;
  colLevel: string; colAdmin: string; colNew: string; colReturning: string;
  tuitionLabel: string; tuitionTitle: string; tuitionSubtitle: string; perMonth: string; perYear: string; daycareMonthly: string;
  insuranceLabel: string; insuranceTitle: string; insuranceSubtitle: string;
  extrasLabel: string; extrasTitle: string; extrasSubtitle: string;
  daycareLabel: string; daycareTitle: string; daycareSubtitle: string;
  /** Small badge next to each card title saying which year's prices it shows («Precios 2027»); empty hides it. */
  feesYear: string; tuitionYear: string; insuranceYear: string; extrasYear: string; daycareYear: string;
  /** Amber «pending» status next to the year badge for a card whose next-year prices are not set yet; empty hides it. */
  feesPending: string; tuitionPending: string; insurancePending: string; extrasPending: string; daycarePending: string;
  policiesTitle: string;
  /** Policies that mention one of these words (comma separated, accents ignored) stand out. */
  policyHighlight: string;
  errorTitle: string; errorText: string;
  noteText: string; noteStrong: string; noteLinkLead: string; noteLink: CmsLink;
  ctaTitle: string; ctaText: string; ctaPrimary: CmsLink; ctaSecondary: CmsLink;
}

/** Today's copy; `{{ciclo}}` keeps the school cycle current. */
export const PRICING_COPY: PricingCopy = {
  emptyTitle: 'Costos próximamente',
  emptyText: 'El colegio publicará pronto las cuotas de inscripción y colegiatura para el ciclo {{ciclo}}. Mientras tanto, nuestro equipo de admisiones puede orientarle.',
  emptyPrimary: { label: 'Contactar al colegio', href: '/contacto' },
  emptySecondary: { label: 'Ver admisiones', href: '/admisiones' },
  structureTitle: '¿Cómo se estructura el pago?',
  structure: [
    { title: 'Inscripción', text: '— pago único al ingresar o reinscribirse.' },
    { title: 'Colegiatura', text: '— 11 mensualidades, de agosto a junio.' },
    { title: 'Seguros y credencial', text: '— conceptos anuales obligatorios.' },
  ],
  feesLabel: 'Pago único', feesTitle: 'Inscripción y reinscripción', feesSubtitle: 'Se divide en 4 parcialidades, de enero a abril',
  newTag: 'Nuevo ingreso', returningTag: 'Alumnos Interlaken',
  colLevel: 'Nivel', colAdmin: 'Gastos administrativos', colNew: 'Inscripción', colReturning: 'Reinscripción',
  tuitionLabel: 'Mensual', tuitionTitle: 'Colegiaturas', tuitionSubtitle: '11 mensualidades, de agosto a junio',
  perMonth: '/ mes', perYear: '/ año', daycareMonthly: '/mes',
  insuranceLabel: 'Anual · obligatorio', insuranceTitle: 'Seguros y credenciales', insuranceSubtitle: 'Contratación obligatoria para todos los alumnos',
  extrasLabel: 'Anualidad', extrasTitle: 'Extraescolares', extrasSubtitle: '10 parcialidades de septiembre a junio · se definen en agosto',
  daycareLabel: 'Horario extendido', daycareTitle: 'Estancia', daycareSubtitle: 'Costo diario, con tarifa mensual opcional',
  // The school's 2026-11 price sheet: inscripción and colegiaturas carry next
  // year's prices; seguros, extraescolares and estancia still this year's.
  feesYear: 'Precios 2027', tuitionYear: 'Precios 2027',
  insuranceYear: 'Precios 2026', extrasYear: 'Precios 2026', daycareYear: 'Precios 2026',
  // Seguros, extraescolares and estancia have no 2027 prices yet (price sheet: crossed out).
  feesPending: '', tuitionPending: '',
  insurancePending: 'Precios 2027: pendientes', extrasPending: 'Precios 2027: pendientes', daycarePending: 'Precios 2027: pendientes',
  policiesTitle: 'Políticas de pago',
  policyHighlight: 'recargo, devolución',
  errorTitle: 'No fue posible cargar los costos',
  errorText: 'Intente de nuevo más tarde o contáctenos para recibir la información del ciclo.',
  noteText: 'Información de referencia: los costos los publica la administración y pueden actualizarse cada ciclo escolar.',
  noteStrong: 'Inscripciones y colegiaturas se pagan directamente con el colegio, no en este sitio.',
  noteLinkLead: 'Para becas, hermanos o planes de pago,',
  noteLink: { label: 'contacte a admisiones', href: '/contacto' },
  ctaTitle: 'Asegure el lugar de su hijo/a',
  ctaText: 'Agende una visita para el ciclo {{ciclo}} o escríbanos para recibir informes. Después del examen de valoración, si su hijo/a es admitido, le enviamos su ficha de inscripción.',
  ctaPrimary: VISIT_CTA,
  ctaSecondary: INFORMES_CTA,
};

/** Lower case, accents removed: «Devolución» and «devolucion» match. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** `matches(text)`: does the policy mention one of the comma-separated words? */
export function policyMatcher(words: string): (text: string) => boolean {
  const list = fold(words).split(',').map((w) => w.trim()).filter(Boolean);
  return (text) => { const f = fold(text); return list.some((w) => f.includes(w)); };
}

/** Number badge colours of the «¿Cómo se estructura el pago?» steps, in order. */
const STEP_BG = ['bg-green-strong', 'bg-purple', 'bg-coral'];

/** Card shell shared by every pricing section (and the generic «Tabla» block's card style). */
export function PriceCard({ tone, icon: Icon, label, title, subtitle, badge, pending, children }: {
  tone: 'green' | 'purple' | 'coral' | 'pink';
  icon: any; label: string; title: string; subtitle?: string;
  /** Short pill next to the title, e.g. «Precios 2027». */
  badge?: string;
  /** Amber status pill after the badge, e.g. «Precios 2027: pendientes». */
  pending?: string;
  children: React.ReactNode;
}) {
  const tones = {
    green:  { border: 'border-green/25',  bg: 'bg-green/5',        chip: 'bg-green/15 text-green-dark',  label: 'text-green-dark' },
    purple: { border: 'border-purple/20', bg: 'bg-purple-light/60', chip: 'bg-purple/15 text-purple',     label: 'text-purple' },
    coral:  { border: 'border-coral/25',  bg: 'bg-coral/5',        chip: 'bg-coral/15 text-coral-dark',  label: 'text-coral-dark' },
    pink:   { border: 'border-pink/25',   bg: 'bg-pink-light/60',  chip: 'bg-pink/15 text-pink-dark',    label: 'text-pink-dark' },
  }[tone];
  return (
    <div className={`overflow-hidden rounded-md border ${tones.border} bg-white shadow-card`}>
      <div className={`flex items-start gap-3 border-b border-ink/10 ${tones.bg} px-5 py-4`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${tones.chip}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className={`text-[11px] font-bold uppercase tracking-wider ${tones.label}`}>{label}</p>
          {/* Without a badge the heading renders exactly as before (the generic «Tabla» block uses this card too). */}
          {badge || pending ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h2 className="font-head text-lg font-bold text-ink">{title}</h2>
              {badge && <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tones.chip}`}>{badge}</span>}
              {pending && (
                <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-amber/10 px-2.5 py-0.5 text-[11px] font-bold text-amber">
                  <Hourglass className="h-3 w-3" aria-hidden="true" />{pending}
                </span>
              )}
            </div>
          ) : (
            <h2 className="font-head text-lg font-bold text-ink">{title}</h2>
          )}
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * One price line. `rightMuted` sits next to the price («/ año»); `rightNote` goes on its own
 * line under it and may wrap, for long extras such as the daycare monthly rate: kept inline,
 * a long note squeezed the label column on phones until the schedule overlapped the price.
 */
function Row({ left, sub, right, rightMuted, rightNote }: {
  left: string; sub?: string; right: string; rightMuted?: string; rightNote?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-ink/5 px-5 py-3.5 last:border-0">
      <span className={`min-w-0 text-sm text-ink${rightNote ? ' flex-1' : ''}`}>
        {left}
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      <span className={rightNote ? 'max-w-[55%] text-right text-sm font-bold text-ink' : 'shrink-0 text-sm font-bold text-ink'}>
        {right}{rightMuted && <span className="font-normal text-muted"> {rightMuted}</span>}
        {rightNote && <span className="block text-xs font-normal text-muted">{rightNote}</span>}
      </span>
    </li>
  );
}

/** Pricing body (tabs, tables, policies); also rendered by the CMS `pricing_table` block. */
export function PricingSections({ copy }: { copy?: Partial<PricingCopy> } = {}) {
  const t = useTokens();
  const c: PricingCopy = { ...PRICING_COPY, ...(copy ?? {}) };
  const structure = Array.isArray(c.structure) ? c.structure : [];
  const link = (l: CmsLink | undefined): CmsLink => ({ label: t(l?.label), href: l?.href });
  const [modality, setModality] = useState<'nuevo_ingreso' | 'reinscripcion'>('nuevo_ingreso');
  const { data, isLoading, isError, refetch } = useQuery<PricingBundle>({
    queryKey: ['pricing-bundle'],
    queryFn: async () => (await contentApi.getPricing()).data,
    staleTime: 5 * 60 * 1000,
  });

  const fees = (data?.enrollment_fees ?? []).filter((f) => f.modality === modality);
  const tuition = data?.tuition ?? [];
  const seguros = data?.fixed_concepts ?? [];
  const extras = data?.extracurriculars ?? [];
  const estancia = data?.daycare ?? [];
  const policies = data?.policies ?? [];
  const isEmpty = tuition.length === 0 && (data?.enrollment_fees ?? []).length === 0;
  const highlighted = policyMatcher(t(c.policyHighlight));
  const feeCol = modality === 'nuevo_ingreso' ? t(c.colNew) : t(c.colReturning);

  return (
    <>
      <section className="bg-cream-2 py-10 sm:py-14">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          {isError || isLoading || isEmpty ? (
            // Loading, error and «próximamente» share ONE reserved height (two
            // skeleton rows), so swapping one for another never moves the rest
            // of the page: when the costs failed slowly, the short error used to
            // pull the section below up into view (Lighthouse CLS 0.44).
            <div className="flex min-h-[584px] flex-col justify-center">
            {isError ? (
              <ErrorState
                title={t(c.errorTitle)}
                description={t(c.errorText)}
                onRetry={() => refetch()}
              />
            ) : isLoading ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-busy="true" aria-label="Cargando costos">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={`skeleton h-[280px] rounded-md ${i > 1 ? 'hidden md:block' : ''}`} aria-hidden="true" />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={CircleDollarSign}
                title={t(c.emptyTitle)}
                description={t(c.emptyText)}
                action={
                  <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                    <CmsAnchor link={link(c.emptyPrimary)} className="btn-primary" />
                    <CmsAnchor link={link(c.emptySecondary)} className="btn-outline" />
                  </div>
                }
              />
            )}
            </div>
          ) : (
            <div className="space-y-6">
              {/* Estructura del pago — explicación breve */}
              {(c.structureTitle || structure.length > 0) && (
                <div className="space-y-2">
                  {c.structureTitle && <p className="font-head text-lg font-bold text-ink">{t(c.structureTitle)}</p>}
                  <ol className="grid gap-2 text-sm text-muted sm:grid-cols-3">
                    {structure.map((st, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${STEP_BG[i % STEP_BG.length]} text-[11px] font-bold text-white`}>{i + 1}</span>
                        <span><strong className="text-ink">{t(st.title)}</strong> {t(st.text)}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Inscripción / reinscripción con selector de modalidad */}
              {fees.length > 0 && (
                <PriceCard
                  tone="green" icon={GraduationCap} label={t(c.feesLabel)}
                  title={t(c.feesTitle)}
                  subtitle={t(c.feesSubtitle)}
                  badge={t(c.feesYear) || undefined}
                  pending={t(c.feesPending) || undefined}
                >
                  <div className="flex gap-2 border-b border-ink/5 px-5 py-3" role="group" aria-label="Modalidad de inscripción">
                    {([['nuevo_ingreso', t(c.newTag)], ['reinscripcion', t(c.returningTag)]] as const).map(([key, tag]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={modality === key}
                        onClick={() => setModality(key)}
                        className={`min-h-[44px] flex-1 rounded-sm px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:flex-none ${
                          modality === key ? 'bg-purple text-white' : 'bg-cream text-muted hover:text-ink'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  {/* Dos columnas con título (bitácora ref. 5): la familia ve qué paga en cada concepto.
                      En teléfono los encabezados van sin mayúsculas espaciadas y con menos margen
                      para que las tres columnas quepan en 390 px; el contenedor desplaza si aun así no caben. */}
                  <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <caption className="sr-only">
                      {modality === 'nuevo_ingreso' ? t(c.newTag) : t(c.returningTag)}: {t(c.colAdmin).toLowerCase()} y {feeCol.toLowerCase()} por {t(c.colLevel).toLowerCase()}
                    </caption>
                    <thead>
                      <tr className="border-b border-ink/5 text-[11px] text-muted sm:text-xs sm:uppercase sm:tracking-wide">
                        <th scope="col" className="px-3 py-2.5 text-left font-semibold sm:px-5">{t(c.colLevel)}</th>
                        <th scope="col" className="px-2 py-2.5 text-right font-semibold sm:px-3">{t(c.colAdmin)}</th>
                        <th scope="col" className="px-3 py-2.5 text-right font-semibold sm:px-5">
                          {feeCol}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {fees.map((f) => (
                        <tr key={`${f.section}-${f.modality}`} className="border-b border-ink/5 last:border-0">
                          <th scope="row" className="px-3 py-3.5 text-left font-normal text-ink sm:px-5">{f.section}</th>
                          <td className="whitespace-nowrap px-2 py-3.5 text-right text-ink sm:px-3">{mxn(f.gastos_administrativos)}</td>
                          <td className="whitespace-nowrap px-3 py-3.5 text-right font-bold text-ink sm:px-5">{mxn(f.cuota)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  </div>
                </PriceCard>
              )}

              {/* Colegiaturas + Seguros lado a lado en desktop */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <PriceCard
                  tone="purple" icon={Wallet} label={t(c.tuitionLabel)} title={t(c.tuitionTitle)}
                  subtitle={t(c.tuitionSubtitle)}
                  badge={t(c.tuitionYear) || undefined}
                  pending={t(c.tuitionPending) || undefined}
                >
                  <ul>
                    {tuition.map((r) => (
                      <Row key={r.section} left={r.section} right={mxn(r.colegiatura)} rightMuted={t(c.perMonth)} />
                    ))}
                  </ul>
                </PriceCard>

                {seguros.length > 0 && (
                  <PriceCard
                    tone="coral" icon={ShieldCheck} label={t(c.insuranceLabel)}
                    title={t(c.insuranceTitle)}
                    subtitle={t(c.insuranceSubtitle)}
                    badge={t(c.insuranceYear) || undefined}
                    pending={t(c.insurancePending) || undefined}
                  >
                    <ul>
                      {seguros.map((s) => (
                        <Row key={s.name} left={s.name} right={mxn(s.cost)} />
                      ))}
                    </ul>
                  </PriceCard>
                )}
              </div>

              {/* Extraescolares + Estancia */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {extras.length > 0 && (
                  <PriceCard
                    tone="pink" icon={Sparkles} label={t(c.extrasLabel)}
                    title={t(c.extrasTitle)}
                    subtitle={t(c.extrasSubtitle)}
                    badge={t(c.extrasYear) || undefined}
                    pending={t(c.extrasPending) || undefined}
                  >
                    <ul>
                      {extras.map((e) => (
                        <Row key={e.name} left={e.name} sub={e.levels} right={mxn(e.annual_cost)} rightMuted={t(c.perYear)} />
                      ))}
                    </ul>
                  </PriceCard>
                )}

                {estancia.length > 0 && (
                  <PriceCard
                    tone="purple" icon={Clock} label={t(c.daycareLabel)}
                    title={t(c.daycareTitle)}
                    subtitle={t(c.daycareSubtitle)}
                    badge={t(c.daycareYear) || undefined}
                    pending={t(c.daycarePending) || undefined}
                  >
                    <ul>
                      {estancia.map((d) => (
                        <Row
                          key={`${d.schedule}-${d.service}`}
                          left={d.schedule}
                          sub={d.service}
                          right={mxn(d.daily_cost)}
                          rightNote={
                            d.monthly_cost
                              ? `${mxn(d.monthly_cost)} ${t(c.daycareMonthly)}${d.monthly_note ? ` (${d.monthly_note.toLowerCase()})` : ''}`
                              : d.monthly_note || undefined
                          }
                        />
                      ))}
                    </ul>
                  </PriceCard>
                )}
              </div>

              {/* Políticas — letra chica visible, recargos/devoluciones destacados */}
              {policies.length > 0 && (
                <div className="rounded-md bg-white p-5 shadow-card">
                  {c.policiesTitle && <h2 className="font-head text-lg font-bold text-ink">{t(c.policiesTitle)}</h2>}
                  <ul className="mt-3 space-y-2.5">
                    {policies.map((p) => {
                      const strong = highlighted(p.text);
                      return (
                        <li key={p.order} className="flex items-start gap-2.5 text-sm">
                          <Info
                            size={16}
                            className={`mt-0.5 flex-shrink-0 ${strong ? 'text-amber' : 'text-purple'}`}
                            aria-hidden="true"
                          />
                          <span className={strong ? 'font-medium text-ink' : 'text-muted'}>{p.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Always shown (also with the error) so the page below never jumps. */}
          {(c.noteText || c.noteStrong || c.noteLinkLead || c.noteLink?.href) && (
            <div className="mt-6 flex items-start gap-3 rounded-md bg-white p-5 text-sm text-muted shadow-card">
              <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
              <p>
                {t(c.noteText)}{' '}
                {c.noteStrong && <strong className="text-ink">{t(c.noteStrong)}</strong>}{' '}
                {t(c.noteLinkLead)}{' '}
                <CmsAnchor link={link(c.noteLink)} className="font-medium text-green-dark underline" />{c.noteLink?.href ? '.' : ''}
              </p>
            </div>
          )}

          {/* Page CTA — Costos keeps in-page CTAs; sticky Agendar bar stays global */}
          {(c.ctaTitle || c.ctaText || c.ctaPrimary?.href || c.ctaSecondary?.href) && (
            <div className="mt-10 flex flex-col items-center gap-3 rounded-md bg-dark px-6 py-8 text-center text-white sm:py-10">
              <CircleDollarSign className="h-8 w-8 text-green" aria-hidden="true" />
              {c.ctaTitle && <h2 className="font-head text-fluid-xl font-bold">{t(c.ctaTitle)}</h2>}
              {c.ctaText && <p className="max-w-xl text-sm text-white/70">{t(c.ctaText)}</p>}
              <div className="mt-2 flex flex-col gap-3 sm:flex-row">
                <CmsAnchor link={link(c.ctaPrimary)} className="btn-pink">
                  {t(c.ctaPrimary?.label)} <ArrowRight size={16} aria-hidden="true" />
                </CmsAnchor>
                <CmsAnchor link={link(c.ctaSecondary)} className="btn-outline !border-white/40 !text-white hover:!bg-white/10" />
              </div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}
