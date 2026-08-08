import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarDays, CircleDollarSign, GraduationCap, Info, Wallet,
} from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentApi } from '@/services/api';
import { CURRENT_CYCLE } from '@/lib/siteMeta';

interface CostRow {
  section: string;
  inscripcion: string | null;
  colegiatura: string;
  order: number;
}

const mxn = (v: string | null) =>
  v === null
    ? 'SIN COSTO'
    : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

/**
 * Admisiones → Costos. Las cifras las publica el colegio y son editables en
 * el admin (Contenido → Costos por sección); el ciclo escolar se calcula solo.
 */
export default function CostosPage() {
  const { data, isLoading, isError, refetch } = useQuery<CostRow[]>({
    queryKey: ['tuition-costs'],
    queryFn: async () => (await contentApi.getCosts()).data,
    staleTime: 5 * 60 * 1000,
  });
  const rows = data ?? [];

  return (
    <div>
      <Seo
        title={`Costos ${CURRENT_CYCLE}`}
        description={`Costos de inscripción y colegiaturas del Colegio Interlaken para el ciclo escolar ${CURRENT_CYCLE}: maternal, preescolar, primaria y secundaria.`}
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
          {/* Mobile storytelling: two clear payment moments */}
          {!isLoading && !isError && rows.length > 0 && (
            <div className="mb-6 space-y-2 md:hidden">
              <p className="font-head text-lg font-bold text-ink">¿Cómo se estructura el pago?</p>
              <ol className="space-y-2 text-sm text-muted">
                <li className="flex gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green text-[11px] font-bold text-white">1</span>
                  <span><strong className="text-ink">Inscripción</strong> — pago único al ingresar o reinscribirse.</span>
                </li>
                <li className="flex gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-purple text-[11px] font-bold text-white">2</span>
                  <span><strong className="text-ink">Colegiatura</strong> — 11 mensualidades, de agosto a junio.</span>
                </li>
              </ol>
            </div>
          )}

          {isError ? (
            <ErrorState
              title="No fue posible cargar los costos"
              description="Intente de nuevo más tarde o contáctenos para recibir la información del ciclo."
              onRetry={() => refetch()}
            />
          ) : isLoading ? (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2" aria-busy="true" aria-label="Cargando costos">
              <div className="skeleton h-[320px] rounded-xl2" aria-hidden="true" />
              <div className="skeleton h-[320px] rounded-xl2" aria-hidden="true" />
            </div>
          ) : rows.length === 0 ? (
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
            <>
              {/* Mobile: stacked hierarchy cards with explicit labels */}
              <div className="space-y-5 md:hidden">
                <div className="overflow-hidden rounded-xl2 border border-green/25 bg-white shadow-card">
                  <div className="flex items-start gap-3 border-b border-ink/10 bg-green/5 px-5 py-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                      <GraduationCap className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-green-dark">Pago único</p>
                      <h2 className="font-head text-lg font-bold text-ink">Inscripción y reinscripción</h2>
                    </div>
                  </div>
                  <ul>
                    {rows.map((r) => (
                      <li key={`m-ins-${r.section}`} className="flex items-center justify-between gap-4 border-b border-ink/5 px-5 py-3.5 last:border-0">
                        <span className="text-sm text-ink">{r.section}</span>
                        <span className={`text-sm font-bold ${r.inscripcion === null ? 'text-green-dark' : 'text-ink'}`}>
                          {mxn(r.inscripcion)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="overflow-hidden rounded-xl2 border border-purple/20 bg-white shadow-card">
                  <div className="flex items-start gap-3 border-b border-ink/10 bg-purple-light/60 px-5 py-4">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple/15 text-purple">
                      <Wallet className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-purple">Mensual</p>
                      <h2 className="font-head text-lg font-bold text-ink">Colegiaturas</h2>
                      <p className="text-xs text-muted">11 mensualidades, de agosto a junio</p>
                    </div>
                  </div>
                  <ul>
                    {rows.map((r) => (
                      <li key={`m-col-${r.section}`} className="flex items-center justify-between gap-4 border-b border-ink/5 px-5 py-3.5 last:border-0">
                        <span className="text-sm text-ink">{r.section}</span>
                        <span className="text-sm font-bold text-ink">{mxn(r.colegiatura)} <span className="font-normal text-muted">/ mes</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Desktop / tablet: side-by-side */}
              <div className="hidden grid-cols-1 gap-6 md:grid md:grid-cols-2">
                <div className="overflow-hidden rounded-xl2 border border-ink/10 bg-white shadow-card">
                  <div className="flex items-center gap-3 border-b border-ink/10 bg-green/5 px-5 py-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                      <GraduationCap className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <h2 className="font-head text-lg font-bold text-ink">Inscripción y reinscripción</h2>
                  </div>
                  <ul>
                    {rows.map((r) => (
                      <li key={r.section} className="flex items-center justify-between gap-4 border-b border-ink/5 px-5 py-3.5 last:border-0">
                        <span className="text-sm text-ink">{r.section}</span>
                        <span className={`text-sm font-bold ${r.inscripcion === null ? 'text-green-dark' : 'text-ink'}`}>
                          {mxn(r.inscripcion)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="overflow-hidden rounded-xl2 border border-ink/10 bg-white shadow-card">
                  <div className="flex items-center gap-3 border-b border-ink/10 bg-purple-light/60 px-5 py-4">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple/15 text-purple">
                      <Wallet className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h2 className="font-head text-lg font-bold text-ink">Colegiaturas</h2>
                      <p className="text-xs text-muted">11 mensualidades, de agosto a junio</p>
                    </div>
                  </div>
                  <ul>
                    {rows.map((r) => (
                      <li key={r.section} className="flex items-center justify-between gap-4 border-b border-ink/5 px-5 py-3.5 last:border-0">
                        <span className="text-sm text-ink">{r.section}</span>
                        <span className="text-sm font-bold text-ink">{mxn(r.colegiatura)} <span className="font-normal text-muted">/ mes</span></span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </>
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
