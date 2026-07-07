import { Link } from 'react-router-dom';
import { FileText, ClipboardList, CheckCircle, ArrowRight, CalendarDays } from 'lucide-react';

const STEPS = [
  {
    icon: FileText,
    step: '01',
    title: 'Pre-Registro',
    desc: 'Completa el formulario de pre-registro en línea. Recibirás confirmación inmediata por correo.',
  },
  {
    icon: CalendarDays,
    step: '02',
    title: 'Puertas Abiertas',
    desc: 'Asiste a nuestro día de puertas abiertas para conocer las instalaciones y al equipo docente.',
  },
  {
    icon: ClipboardList,
    step: '03',
    title: 'Inscripción formal',
    desc: 'Presenta los documentos requeridos y completa el proceso de inscripción con el personal administrativo.',
  },
  {
    icon: CheckCircle,
    step: '04',
    title: '¡Bienvenido!',
    desc: 'Recibirás tu kit de bienvenida, credencial escolar y acceso al portal de padres.',
  },
];

const DOCS = [
  'Acta de nacimiento (original y copia)',
  'CURP del alumno',
  'Fotografías (tamaño infantil)',
  'Boleta o certificado del ciclo anterior',
  'Cartilla de vacunación (preescolar)',
  'Comprobante de domicilio',
  'Identificación oficial del tutor',
];

export default function AdmissionsPage() {
  return (
    <div>
      <section className="bg-gradient-to-r from-brand-700 to-brand-600 text-white py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h1 className="text-4xl font-bold mb-4">Admisiones</h1>
          <p className="text-brand-100 text-lg max-w-xl">Ciclo Escolar 2025–2026 · Inscripciones abiertas</p>
        </div>
      </section>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        {/* Process */}
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-slate-900 mb-2 text-center">Proceso de admisión</h2>
          <p className="text-slate-500 text-center mb-10">Simple, transparente y completamente en línea.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {STEPS.map(({ icon: Icon, step, title, desc }) => (
              <div key={step} className="card text-center">
                <div className="w-12 h-12 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto mb-3">
                  <Icon className="w-6 h-6 text-brand-600" />
                </div>
                <span className="text-xs font-bold text-brand-400 tracking-wider">PASO {step}</span>
                <h3 className="font-semibold text-slate-900 mt-1 mb-2">{title}</h3>
                <p className="text-xs text-slate-500 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Documents & CTA */}
        <div className="grid md:grid-cols-2 gap-8">
          <div className="card">
            <h3 className="font-semibold text-slate-900 mb-4">Documentos requeridos</h3>
            <ul className="space-y-2.5">
              {DOCS.map((d) => (
                <li key={d} className="flex items-center gap-2.5 text-sm text-slate-600">
                  <CheckCircle className="w-4 h-4 text-brand-500 flex-shrink-0" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
          <div className="card bg-brand-50 border-brand-200 flex flex-col justify-between">
            <div>
              <h3 className="font-bold text-brand-800 text-xl mb-2">¿Listo para comenzar?</h3>
              <p className="text-brand-700 text-sm leading-relaxed mb-6">
                El proceso de pre-registro toma menos de 5 minutos. Recibirás confirmación inmediata
                y nos pondremos en contacto para coordinar los siguientes pasos.
              </p>
            </div>
            <div className="space-y-3">
              <Link to="/pre-registro" className="btn-primary w-full justify-center">
                Iniciar Pre-Registro <ArrowRight className="w-4 h-4" />
              </Link>
              <Link to="/puertas-abiertas" className="btn-secondary w-full justify-center">
                Ver fechas de Puertas Abiertas
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
