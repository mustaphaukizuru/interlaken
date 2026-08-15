import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarDays, CircleDollarSign, Clock, GraduationCap, Info,
  ShieldCheck, Sparkles, Wallet,
} from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi } from '@/services/api';
import { CURRENT_CYCLE } from '@/lib/siteMeta';

interface EnrollmentFee {
  section: string;
  modality: 'nuevo_ingreso' | 'reinscripcion';
  gastos_administrativos: string;
  cuota: string;
  order: number;
}
interface TuitionRow { section: string; inscripcion: string | null; colegiatura: string; order: number }
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

const mxn = (v: string | null) =>
  v === null
    ? 'SIN COSTO'
    : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/** Card shell shared by every pricing section. */
function PriceCard({ tone, icon: Icon, label, title, subtitle, children }: {
  tone: 'green' | 'purple' | 'coral' | 'pink';
  icon: any; label: string; title: string; subtitle?: string;
  children: React.ReactNode;
}) {
  const tones = {
    green:  { border: 'border-green/25',  bg: 'bg-green/5',        chip: 'bg-green/15 text-green-dark',  label: 'text-green-dark' },
    purple: { border: 'border-purple/20', bg: 'bg-purple-light/60', chip: 'bg-purple/15 text-purple',     label: 'text-purple' },
    coral:  { border: 'border-coral/25',  bg: 'bg-coral/5',        chip: 'bg-coral/15 text-coral-dark',  label: 'text-coral-dark' },
    pink:   { border: 'border-pink/25',   bg: 'bg-pink-light/60',  chip: 'bg-pink/15 text-pink-dark',    label: 'text-pink-dark' },
  }[tone];
  return (
    <div className={`overflow-hidden rounded-xl2 border ${tones.border} bg-white shadow-card`}>
      <div className={`flex items-start gap-3 border-b border-ink/10 ${tones.bg} px-5 py-4`}>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones.chip}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className={`text-[11px] font-bold uppercase tracking-wider ${tones.label}`}>{label}</p>
          <h2 className="font-head text-lg font-bold text-ink">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Row({ left, sub, right, rightMuted }: {
  left: string; sub?: string; right: string; rightMuted?: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-ink/5 px-5 py-3.5 last:border-0">
      <span className="min-w-0 text-sm text-ink">
        {left}
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </span>
      <span className="shrink-0 text-sm font-bold text-ink">
        {right}{rightMuted && <span className="font-normal text-muted"> {rightMuted}</span>}
      </span>
    </li>
  );
}

/**
 * Admisiones → Costos, ciclo 2026-2027. Todas las cifras vienen del paquete
 * /content/pricing/ (editable en el admin: Contenido → precios); el ciclo
 * escolar se calcula solo.
 */
export default function CostosPage() {
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

  return (
    <div>
      <Seo
        title={`Costos ${CURRENT_CYCLE}`}
        description={`Costos del Colegio Interlaken para el ciclo escolar ${CURRENT_CYCLE}: inscripción, colegiaturas, seguros, extraescolares y estancia para maternal, preescolar, primaria y secundaria.`}
      />

      {/* HERO con ciclo automático */}
      <section className="relative overflow-hidden bg-dark text-white">
        <img src="/assets/facade.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <span className="section-label-pink inline-flex">Admisiones</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">Costos</h1>
          <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-sm font-semibold">
            <CalendarDays className="h-4 w-4" aria-hidden="true" />
            Ciclo Escolar {CURRENT_CYCLE}
          </p>
        </div>
      </section>

      <section className="bg-cream-2 py-10 sm:py-14">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          {isError ? (
            <ErrorState
              title="No fue posible cargar los costos"
              description="Intente de nuevo más tarde o contáctenos para recibir la información del ciclo."
              onRetry={() => refetch()}
            />
          ) : isLoading ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-busy="true" aria-label="Cargando costos">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-[280px] rounded-xl2" aria-hidden="true" />
              ))}
            </div>
          ) : isEmpty ? (
            <EmptyState
              icon={CircleDollarSign}
              title="Costos próximamente"
              description={`El colegio publicará pronto las cuotas de inscripción y colegiatura para el ciclo ${CURRENT_CYCLE}. Mientras tanto, nuestro equipo de admisiones puede orientarle.`}
              action={
                <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <Link to="/contacto" className="btn-primary">
                    Contactar al colegio
                  </Link>
                  <Link to="/admisiones" className="btn-outline">
                    Ver admisiones
                  </Link>
                </div>
              }
            />
          ) : (
            <div className="space-y-6">
              {/* Estructura del pago — explicación breve */}
              <div className="space-y-2">
                <p className="font-head text-lg font-bold text-ink">¿Cómo se estructura el pago?</p>
                <ol className="grid gap-2 text-sm text-muted sm:grid-cols-3">
                  <li className="flex gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-strong text-[11px] font-bold text-white">1</span>
                    <span><strong className="text-ink">Inscripción</strong> — pago único al ingresar o reinscribirse.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple text-[11px] font-bold text-white">2</span>
                    <span><strong className="text-ink">Colegiatura</strong> — 11 mensualidades, de agosto a junio.</span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-coral text-[11px] font-bold text-white">3</span>
                    <span><strong className="text-ink">Seguros y credencial</strong> — conceptos anuales obligatorios.</span>
                  </li>
                </ol>
              </div>

              {/* Inscripción / reinscripción con selector de modalidad */}
              {fees.length > 0 && (
                <PriceCard
                  tone="green" icon={GraduationCap} label="Pago único"
                  title="Inscripción y reinscripción"
                  subtitle="Se divide en 4 parcialidades, de enero a abril"
                >
                  <div className="flex gap-2 border-b border-ink/5 px-5 py-3" role="group" aria-label="Modalidad de inscripción">
                    {([['nuevo_ingreso', 'Nuevo ingreso'], ['reinscripcion', 'Alumnos Interlaken']] as const).map(([key, tag]) => (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={modality === key}
                        onClick={() => setModality(key)}
                        className={`min-h-[44px] flex-1 rounded-full px-4 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple/40 sm:flex-none ${
                          modality === key ? 'bg-purple text-white' : 'bg-cream text-muted hover:text-ink'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                  <ul>
                    {fees.map((f) => (
                      <Row
                        key={`${f.section}-${f.modality}`}
                        left={f.section}
                        sub={`Gastos administrativos: ${mxn(f.gastos_administrativos)}`}
                        right={mxn(f.cuota)}
                      />
                    ))}
                  </ul>
                </PriceCard>
              )}

              {/* Colegiaturas + Seguros lado a lado en desktop */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <PriceCard
                  tone="purple" icon={Wallet} label="Mensual" title="Colegiaturas"
                  subtitle="11 mensualidades, de agosto a junio"
                >
                  <ul>
                    {tuition.map((r) => (
                      <Row key={r.section} left={r.section} right={mxn(r.colegiatura)} rightMuted="/ mes" />
                    ))}
                  </ul>
                </PriceCard>

                {seguros.length > 0 && (
                  <PriceCard
                    tone="coral" icon={ShieldCheck} label="Anual · obligatorio"
                    title="Seguros y credenciales"
                    subtitle="Contratación obligatoria para todos los alumnos"
                  >
                    <ul>
                      {seguros.map((c) => (
                        <Row key={c.name} left={c.name} right={mxn(c.cost)} />
                      ))}
                    </ul>
                  </PriceCard>
                )}
              </div>

              {/* Extraescolares + Estancia */}
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                {extras.length > 0 && (
                  <PriceCard
                    tone="pink" icon={Sparkles} label="Anualidad"
                    title="Extraescolares"
                    subtitle="10 parcialidades de septiembre a junio · se definen en agosto"
                  >
                    <ul>
                      {extras.map((e) => (
                        <Row key={e.name} left={e.name} sub={e.levels} right={mxn(e.annual_cost)} rightMuted="/ año" />
                      ))}
                    </ul>
                  </PriceCard>
                )}

                {estancia.length > 0 && (
                  <PriceCard
                    tone="purple" icon={Clock} label="Horario extendido"
                    title="Estancia"
                    subtitle="Costo diario, con tarifa mensual opcional"
                  >
                    <ul>
                      {estancia.map((d) => (
                        <Row
                          key={`${d.schedule}-${d.service}`}
                          left={d.schedule}
                          sub={d.service}
                          right={mxn(d.daily_cost)}
                          rightMuted={
                            d.monthly_cost
                              ? `· ${mxn(d.monthly_cost)} /mes${d.monthly_note ? ` (${d.monthly_note.toLowerCase()})` : ''}`
                              : d.monthly_note ? `· ${d.monthly_note}` : undefined
                          }
                        />
                      ))}
                    </ul>
                  </PriceCard>
                )}
              </div>

              {/* Políticas — letra chica visible, recargos/devoluciones destacados */}
              {policies.length > 0 && (
                <div className="rounded-xl2 border border-ink/10 bg-white p-5 shadow-card">
                  <h2 className="font-head text-lg font-bold text-ink">Políticas de pago</h2>
                  <ul className="mt-3 space-y-2.5">
                    {policies.map((p) => {
                      const highlighted = /recargo|devoluci/i.test(p.text);
                      return (
                        <li key={p.order} className="flex items-start gap-2.5 text-sm">
                          <Info
                            size={16}
                            className={`mt-0.5 flex-shrink-0 ${highlighted ? 'text-amber' : 'text-purple'}`}
                            aria-hidden="true"
                          />
                          <span className={highlighted ? 'font-medium text-ink' : 'text-muted'}>{p.text}</span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!isError && (
            <div className="mt-6 flex items-start gap-3 rounded-xl2 border border-ink/10 bg-white p-5 text-sm text-muted">
              <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
              <p>
                Los costos son publicados por la administración del colegio y pueden
                actualizarse cada ciclo escolar. Para becas, hermanos o planes de
                pago, <Link to="/contacto" className="font-medium text-green-dark underline">contáctenos</Link>.
              </p>
            </div>
          )}

          {/* Page CTA — Costos keeps in-page CTAs; sticky Agendar bar stays global */}
          <div className="mt-10 flex flex-col items-center gap-3 rounded-xl2 bg-dark px-6 py-8 text-center text-white sm:py-10">
            <CircleDollarSign className="h-8 w-8 text-green" aria-hidden="true" />
            <h2 className="font-head text-fluid-xl font-bold">Asegure el lugar de su hijo/a</h2>
            <p className="max-w-xl text-sm text-white/70">
              Inicie su pre-registro para el ciclo {CURRENT_CYCLE} — toma menos de
              5 minutos y un asesor le contactará.
            </p>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <Link to="/pre-registro" className="btn-pink">
                Iniciar pre-registro <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link to="/agendar-visita" className="btn-outline !border-white/40 !text-white hover:!bg-white/10">
                Agendar visita
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
