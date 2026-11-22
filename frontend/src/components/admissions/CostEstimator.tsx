import { useState } from 'react';
import { waHref } from '@/lib/siteContact';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Calculator, Info } from 'lucide-react';
import { ErrorState } from '@/components/ui/ErrorState';
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon';
import { useSiteSettings } from '@/hooks/useSiteSettings';
import { waSectionMessage } from '@/lib/whatsapp';
import { formatPrice } from '@/lib/format';
import { contentApi } from '@/services/api';
import { trackEvent, ConversionEvent } from '@/services/analytics';
import { useTokens } from '@/cms/runtime';
import { CmsAnchor } from '@/cms/sections/kit';
import { ESTIMATOR_COPY, type EstimatorCopy } from './estimatorCopy';

// Same /content/pricing/ bundle shapes CostosPage consumes.
interface EnrollmentFee {
  section: string;
  modality: 'nuevo_ingreso' | 'reinscripcion';
  gastos_administrativos: string;
  cuota: string;
  order: number;
}
interface TuitionRow { section: string; colegiatura: string; order: number }
interface FixedConcept { name: string; cost: string; mandatory: boolean; order: number }
interface PricingBundle {
  enrollment_fees: EnrollmentFee[];
  tuition: TuitionRow[];
  fixed_concepts: FixedConcept[];
}

type Modality = 'nuevo_ingreso' | 'reinscripcion';

const mxn = formatPrice;

/** Accent/case-insensitive needle for matching backend section names. */
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/**
 * Backend rows name sections loosely ('Sección Maternal', '1° a 3° de
 * Preescolar', …) — match by inclusion, like the backend's own
 * `section__icontains` seed updates do.
 */
const matchesSection = (rowName: string, label: string) =>
  norm(rowName).includes(norm(label));

function ResultRow({ label, sub, value, muted }: {
  label: string; sub?: string; value: string; muted?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink/5 px-5 py-3.5 last:border-0">
      <dt className="min-w-0 text-sm text-ink">
        {label}
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </dt>
      <dd className="shrink-0 text-sm font-bold text-ink">
        {value}
        {muted && <span className="font-normal text-muted"> {muted}</span>}
      </dd>
    </div>
  );
}

/**
 * Estimador de costos — compact per-section quote on /admisiones (linkable as
 * /admisiones#estimador). Every figure comes from /content/pricing/ (console
 * «Costos y precios»); nothing hardcoded. Sections without an enrollment fee
 * row (e.g. Maternal) show "SIN COSTO", matching CostosPage. The labels are
 * CMS copy (`copy`, defaults in ./estimatorCopy); the arithmetic stays here.
 */
export function CostEstimator({ copy }: { copy?: Partial<EstimatorCopy> } = {}) {
  const t = useTokens();
  const c: EstimatorCopy = { ...ESTIMATOR_COPY, ...(copy ?? {}) };
  const listed = (Array.isArray(c.sections) ? c.sections : []).map((s) => t(s?.label).trim()).filter(Boolean);
  const sections = listed.length ? listed : ESTIMATOR_COPY.sections.map((s) => s.label as string);
  const [section, setSection] = useState<string>(() => (sections.includes(t(c.startSection)) ? t(c.startSection) : sections[0]));
  const [modality, setModality] = useState<Modality>('nuevo_ingreso');
  const { whatsapp_number } = useSiteSettings();
  const notes = Array.isArray(c.notes) ? c.notes.filter((n) => n?.text) : [];

  const { data, isLoading, isError, refetch } = useQuery<PricingBundle>({
    queryKey: ['pricing-bundle'],
    queryFn: async () => (await contentApi.getPricing()).data,
    staleTime: 5 * 60 * 1000,
  });

  const pickSection = (s: string) => {
    setSection(s);
    trackEvent(ConversionEvent.EstimatorUsed, { section: s, modality });
  };
  const pickModality = (m: Modality) => {
    setModality(m);
    trackEvent(ConversionEvent.EstimatorUsed, { section, modality: m });
  };

  if (isError) {
    return (
      <div className="rounded-md bg-white shadow-card">
        <ErrorState
          title={t(c.errorTitle)}
          description={t(c.errorText)}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div aria-busy="true" aria-label="Cargando estimador de costos">
        <div className="skeleton h-[420px] rounded-md" aria-hidden="true" />
      </div>
    );
  }

  const fee = (data.enrollment_fees ?? []).find(
    (f) => f.modality === modality && matchesSection(f.section, section),
  );
  const tuitionRow = (data.tuition ?? []).find((t) => matchesSection(t.section, section));
  const seguros = data.fixed_concepts ?? [];
  const segurosTotal = seguros.reduce((sum, c) => sum + Number(c.cost), 0);

  return (
    <div className="overflow-hidden rounded-md bg-white shadow-card">
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-ink/10 bg-purple-light/60 px-5 py-4 sm:px-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-purple/15 text-purple">
          <Calculator className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-purple">{t(c.cardEyebrow)}</p>
          <h3 className="font-head text-lg font-bold text-ink">{t(c.cardTitle)}</h3>
        </div>
      </div>

      {/* Selectors */}
      <div className="space-y-3 border-b border-ink/5 px-5 py-4 sm:px-6">
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">{t(c.sectionLabel)}</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t(c.sectionLabel)}>
            {sections.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={section === s}
                onClick={() => pickSection(s)}
                className={`min-h-[44px] rounded-sm px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 ${
                  section === s ? 'bg-purple text-white' : 'bg-cream text-muted hover:text-ink'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-subtle">{t(c.modalityLabel)}</p>
          <div className="flex gap-2" role="group" aria-label="Modalidad de inscripción">
            {([['nuevo_ingreso', t(c.newTag)], ['reinscripcion', t(c.returningTag)]] as const).map(
              ([key, tag]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={modality === key}
                  onClick={() => pickModality(key)}
                  className={`min-h-[44px] flex-1 rounded-sm px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:flex-none ${
                    modality === key ? 'bg-purple text-white' : 'bg-cream text-muted hover:text-ink'
                  }`}
                >
                  {tag}
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      {/* Results — keyed remount so each selection change re-runs the subtle
          entrance (0.16s; reduced-motion guard lives in index.css). */}
      <dl key={`${section}-${modality}`} className="m-0 animate-[dropdown-in_0.16s_ease-out]">
        <ResultRow
          label={t(c.adminLabel)}
          sub={t(c.adminSub) || undefined}
          value={fee ? mxn(fee.gastos_administrativos) : t(c.noCost)}
        />
        <ResultRow
          label={modality === 'nuevo_ingreso' ? t(c.newFeeLabel) : t(c.returningFeeLabel)}
          sub={t(c.feeSub) || undefined}
          value={fee ? mxn(fee.cuota) : t(c.noCost)}
        />
        <ResultRow
          label={t(c.tuitionLabel)}
          sub={tuitionRow?.section}
          value={tuitionRow ? mxn(tuitionRow.colegiatura) : t(c.tuitionMissing)}
          muted={tuitionRow ? t(c.perMonth) || undefined : undefined}
        />
        {seguros.length > 0 && (
          <ResultRow
            label={t(c.insuranceLabel)}
            sub={t(c.insuranceSub) || undefined}
            value={mxn(segurosTotal)}
          />
        )}
      </dl>

      {/* Payment notes (CMS copy) */}
      {notes.length > 0 && (
        <ul className="space-y-1.5 border-t border-ink/5 bg-cream-2/60 px-5 py-3.5 text-xs leading-relaxed text-muted sm:px-6">
          {notes.map((n, i) => (
            <li key={i} className="flex items-start gap-2">
              <Info className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${n.tone === 'amber' ? 'text-amber' : 'text-purple'}`} aria-hidden="true" />
              {t(n.text)}
            </li>
          ))}
        </ul>
      )}

      {/* CTAs — WhatsApp with per-section prefilled message (hidden without number) */}
      <div className="flex flex-col gap-3 border-t border-ink/10 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
        {whatsapp_number && (
          <a
            href={waHref(whatsapp_number, waSectionMessage(section))}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() =>
              trackEvent(ConversionEvent.WhatsappCta, { context: 'estimador', section })
            }
            className="btn-green justify-center sm:flex-none"
          >
            <WhatsAppIcon className="h-4 w-4" /> {t(c.waLabel)}
          </a>
        )}
        <CmsAnchor
          link={{ href: c.allHref }}
          className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-sm px-4 text-sm font-semibold text-purple transition-colors hover:bg-purple/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40"
        >
          {t(c.allLabel)} <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </CmsAnchor>
      </div>
    </div>
  );
}

export default CostEstimator;
