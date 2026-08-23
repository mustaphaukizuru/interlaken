import { CalendarDays } from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { PricingSections } from '@/components/public/PricingSections';
import { CURRENT_CYCLE } from '@/lib/siteMeta';

/**
 * Admisiones → Costos, ciclo 2026-2027. Todas las cifras vienen del paquete
 * /content/pricing/ (editable en el admin: Contenido → precios); el ciclo
 * escolar se calcula solo.
 */
export default function CostosPage() {
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

      <PricingSections />
    </div>
  );
}
