import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';

export default function RegisterPage() {
  return (
    <div>
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-2">Inscripción Formal</h1>
          <p className="text-brand-100">Complete su proceso de inscripción en línea</p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-12">
        <div className="card text-center py-12">
          <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <FileText className="w-8 h-8 text-brand-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-3">Inscripción en línea</h2>
          <p className="text-slate-500 text-sm mb-8 max-w-sm mx-auto">
            La inscripción formal requiere haber completado el pre-registro y haber sido contactado
            por el equipo de admisiones.
          </p>
          <div className="space-y-3 max-w-xs mx-auto">
            <Link to="/pre-registro" className="btn-primary w-full justify-center">
              Comenzar Pre-Registro
            </Link>
            <Link to="/contacto" className="btn-secondary w-full justify-center">
              Contactar admisiones
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
