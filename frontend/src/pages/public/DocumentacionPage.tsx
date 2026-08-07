import { Link } from 'react-router-dom';
import {
  ArrowRight, ArrowUpRight, CheckCircle, FileText, FolderOpen, Info,
} from 'lucide-react';
import { Seo } from '@/components/seo/Seo';
import { ADMISSION_DOCS } from '@/lib/admisionesDocs';
import { CURRENT_CYCLE } from '@/lib/siteMeta';

/** Admisiones → Documentación: lista completa con enlaces a trámites oficiales. */
export default function DocumentacionPage() {
  const withLink = ADMISSION_DOCS.filter((d) => d.href).length;

  return (
    <div>
      <Seo
        title="Documentación"
        description={`Documentos requeridos para el examen de valoración e inscripción al Colegio Interlaken (ciclo ${CURRENT_CYCLE}), con enlaces a los trámites oficiales de gob.mx e INE.`}
      />

      <section className="relative overflow-hidden bg-dark text-white">
        <img src="/assets/primaria-gate.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
          <span className="section-label-pink inline-flex">Admisiones</span>
          <h1 className="mt-3 font-head text-fluid-3xl font-black tracking-[-0.02em]">Documentación</h1>
          <p className="mt-3 max-w-2xl text-[15.5px] text-white/80">
            Todo lo que su familia necesita presentar para el Examen de Valoración
            del ciclo {CURRENT_CYCLE} — con enlaces directos a los trámites oficiales.
          </p>
        </div>
      </section>

      <section className="bg-cream-2 py-10 sm:py-14">
        <div className="mx-auto max-w-4xl px-4 sm:px-6">
          <div className="overflow-hidden rounded-xl2 border border-ink/10 bg-white shadow-card">
            <div className="flex items-center gap-3 border-b border-ink/10 bg-green/5 px-5 py-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green/15 text-green-dark">
                <FolderOpen className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-head text-lg font-bold text-ink">Documentos requeridos</h2>
                <p className="text-xs text-muted">
                  {ADMISSION_DOCS.length} documentos · {withLink} con trámite oficial en línea
                </p>
              </div>
            </div>
            <ul className="divide-y divide-ink/5">
              {ADMISSION_DOCS.map((d) => (
                <li key={d.label} className="flex items-start gap-3 px-5 py-4">
                  <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-sm text-ink">{d.label}</p>
                    {d.href && (
                      <a
                        href={d.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm font-semibold text-green-dark underline decoration-green/40 underline-offset-2 hover:decoration-green"
                      >
                        {d.linkLabel} <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-xl2 border border-ink/10 bg-white p-5 text-sm text-muted">
            <Info size={18} className="mt-0.5 flex-shrink-0 text-purple" aria-hidden="true" />
            <p>
              Los enlaces llevan a los portales oficiales del gobierno (gob.mx / INE)
              para obtener o consultar cada documento en línea. Si tiene dudas sobre
              algún requisito, <Link to="/contacto" className="font-medium text-green-dark underline">contáctenos</Link>.
            </p>
          </div>

          <div className="mt-8 flex flex-col items-center gap-3 rounded-xl2 border border-green/25 bg-green/5 px-6 py-7 text-center">
            <FileText className="h-7 w-7 text-green-dark" aria-hidden="true" />
            <p className="font-head text-lg font-bold text-ink">¿Documentos listos?</p>
            <p className="max-w-md text-sm text-muted">
              Inicie su pre-registro y coordine la entrega de documentos con
              nuestro equipo de admisiones.
            </p>
            <Link to="/pre-registro" className="btn-pink mt-1">
              Iniciar pre-registro <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
