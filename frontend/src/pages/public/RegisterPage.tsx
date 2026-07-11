import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';

export default function RegisterPage() {
  return (
    <div>
      <section className="relative overflow-hidden bg-dark text-white py-10 sm:py-16">
        <img src="/assets/court-primaria.webp" alt="" className="absolute inset-0 h-full w-full object-cover opacity-25" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-r from-dark/90 via-dark/70 to-dark/45" />
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
          <span className="section-label-pink inline-flex">Admisiones</span>
          <h1 className="mt-3 text-fluid-4xl font-bold mb-2">Inscripción Formal</h1>
          <p className="text-brand-100 text-fluid-base">Complete su proceso de inscripción en línea</p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <div className="card text-center py-10 sm:py-12">
          <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <FileText className="w-8 h-8 text-brand-600" />
          </div>
          <h2 className="text-fluid-xl font-bold text-ink mb-3">Inscripción en línea</h2>
          <p className="text-muted text-sm mb-8 max-w-sm mx-auto">
            La inscripción formal requiere haber completado el pre-registro y haber sido contactado
            por el equipo de admisiones.
          </p>
          <div className="space-y-3 max-w-xs mx-auto">
            <Link
              to="/pre-registro"
              className="btn-primary w-full justify-center min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/40 focus-visible:ring-offset-2"
            >
              Inicie su pre-registro
            </Link>
            <Link
              to="/contacto"
              className="btn-secondary w-full justify-center min-h-[44px] focus-visible:ring-2 focus-visible:ring-purple/30 focus-visible:ring-offset-2"
            >
              Contactar admisiones
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
